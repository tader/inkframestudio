use axum::Json;
use base64::Engine;
use serde_json::{json, Value};
use tokio::fs;
use tokio::time::{sleep, Duration};

use crate::{
    app::AppState, display_provider, find_provider_instance, load_user_font_data,
    native_layout_preview::try_render_assigned_preview, now_ms,
    openepaperlink_settings_from_instance, png_to_jpeg, project_file_path, read_json_file,
    read_settings, routes::projects::list_projects,
    services::render_data::resolve_project_render_data_value, update_log_file_path,
    upload_image_to_access_point, write_json_file, ApiError, AssignmentConfig,
    AssignmentForceUpdateResponse, AssignmentScheduleStatusResponse, AssignmentUpdateLogEntry,
    ProjectSummary, SchedulerState, StoredSettings,
};

#[derive(Clone)]
pub(crate) struct RenderedPreviewOutput {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) hash: String,
    pub(crate) active_screen_id: String,
    pub(crate) active_overlay_id: Option<String>,
    pub(crate) data_source_message: Option<String>,
    pub(crate) script_warnings: Option<Vec<String>>,
    pub(crate) png_bytes: Vec<u8>,
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(ToString::to_string)
}

fn bool_at(value: &Value, path: &[&str]) -> Option<bool> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_bool()
}

fn u64_at(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_u64()
}

fn iso_string(timestamp_ms: Option<u64>) -> Option<String> {
    timestamp_ms.map(|value| {
        let secs = (value / 1000) as i64;
        let millis = (value % 1000) as u32;
        let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, millis * 1_000_000)
            .unwrap_or_else(chrono::Utc::now);
        datetime.to_rfc3339()
    })
}

fn iso_string_required(timestamp_ms: u64) -> String {
    iso_string(Some(timestamp_ms)).unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

pub(crate) fn schedule_update_log_retention_days(settings: &StoredSettings) -> u64 {
    settings
        .schedule_update_log_retention_days
        .unwrap_or(7)
        .max(1)
}

pub(crate) async fn read_assignment_update_log(
    state: &AppState,
) -> Result<Vec<AssignmentUpdateLogEntry>, ApiError> {
    match fs::read_to_string(update_log_file_path(&state.data_dir)).await {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|error| ApiError::internal(error.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(crate::internal_error(error)),
    }
}

async fn write_assignment_update_log(
    state: &AppState,
    entries: &[AssignmentUpdateLogEntry],
) -> Result<(), ApiError> {
    let value =
        serde_json::to_value(entries).map_err(|error| ApiError::internal(error.to_string()))?;
    write_json_file(&update_log_file_path(&state.data_dir), &value).await
}

async fn append_assignment_update_log(
    state: &AppState,
    settings: &StoredSettings,
    entry: AssignmentUpdateLogEntry,
) -> Result<(), ApiError> {
    let cutoff = now_ms().saturating_sub(
        schedule_update_log_retention_days(settings).saturating_mul(24 * 60 * 60 * 1000),
    );
    let mut entries = read_assignment_update_log(state).await.unwrap_or_default();
    entries.retain(|candidate| candidate.timestamp_ms >= cutoff);
    entries.push(entry);
    write_assignment_update_log(state, &entries).await
}

fn assignment_configs(project: &Value, settings: Option<&StoredSettings>) -> Vec<AssignmentConfig> {
    let devices = project
        .get("devices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    project
        .get("deviceAssignments")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|assignment| {
            let assignment_id = assignment.get("id")?.as_str()?.to_string();
            let display_id = assignment.get("displayId")?.as_str()?.to_string();
            let display = devices.iter().find(|entry| {
                entry.get("id").and_then(Value::as_str) == Some(display_id.as_str())
            })?;
            let enabled = bool_at(&assignment, &["schedule", "enabled"]).unwrap_or(false);
            let interval_minutes = u64_at(&assignment, &["schedule", "intervalMinutes"])
                .unwrap_or(15)
                .max(1);
            let managed = display
                .get("managed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let provider_kind = display
                .get("displayProviderInstanceId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let legacy_provider_kind = display
                .get("providerKind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let provider_instance_id = if provider_kind.is_empty() {
                if legacy_provider_kind == "openepaperlink-ap" {
                    "openepaperlink-ap-default".to_string()
                } else if display
                    .get("virtual")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    "virtual-default".to_string()
                } else {
                    String::new()
                }
            } else {
                provider_kind
            };
            let provider_device_ref = display
                .get("providerDeviceRef")
                .or_else(|| display.get("providerRef"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mac = string_at(display, &["metadata", "mac"])
                .unwrap_or_else(|| provider_device_ref.clone());
            let provider_supports_scheduling = settings
                .and_then(|document| find_provider_instance(document, &provider_instance_id))
                .and_then(|instance| {
                    display_provider(&instance.provider_id)
                        .map(|provider| provider.supports_scheduling())
                })
                .unwrap_or(
                    legacy_provider_kind == "openepaperlink-ap"
                        || provider_instance_id == "openepaperlink-ap-default"
                        || provider_instance_id.contains("openepaperlink-ap"),
                );
            Some(AssignmentConfig {
                assignment_id,
                display_id,
                enabled,
                interval_minutes,
                schedulable: managed && provider_supports_scheduling,
                provider_instance_id,
                provider_device_ref,
                mac,
            })
        })
        .collect()
}

fn assignment_key(project_id: &str, assignment_id: &str) -> String {
    format!("{project_id}:{assignment_id}")
}

fn build_assignment_status(
    state: &AppState,
    project_id: &str,
    config: &AssignmentConfig,
) -> AssignmentScheduleStatusResponse {
    let key = assignment_key(project_id, &config.assignment_id);
    let states = state
        .assignment_states
        .lock()
        .expect("assignment state mutex poisoned");
    let scheduler_state = states.get(&key).cloned().unwrap_or(SchedulerState {
        config_signature: None,
        next_run_at: None,
        last_run_at: None,
        last_completed_at: None,
        last_result: None,
        last_error: None,
        last_hash: None,
        running: false,
    });
    AssignmentScheduleStatusResponse {
        assignment_id: config.assignment_id.clone(),
        display_id: config.display_id.clone(),
        enabled: config.enabled,
        interval_minutes: config.interval_minutes,
        schedulable: config.schedulable,
        running: scheduler_state.running,
        next_run_at: iso_string(scheduler_state.next_run_at),
        last_run_at: iso_string(scheduler_state.last_run_at),
        last_completed_at: iso_string(scheduler_state.last_completed_at),
        last_result: scheduler_state.last_result,
        last_error: scheduler_state.last_error,
        last_hash: scheduler_state.last_hash,
    }
}

pub(crate) async fn render_assigned_live(
    state: &AppState,
    _project_id: &str,
    project: &Value,
    display_id: &str,
) -> Result<RenderedPreviewOutput, ApiError> {
    let (data, message) = resolve_project_render_data_value(state, project, None).await?;
    let user_fonts = load_user_font_data(state).await?;
    let Some(rendered) =
        try_render_assigned_preview(project, &user_fonts, &data, display_id, message.clone())?
    else {
        return Err(ApiError::bad_request(
            "Native renderer does not support requested assignment render",
        ));
    };
    Ok(RenderedPreviewOutput {
        width: rendered.width,
        height: rendered.height,
        hash: rendered.hash,
        active_screen_id: rendered.active_screen_id,
        active_overlay_id: rendered.active_overlay_id,
        data_source_message: rendered.data_source_message,
        script_warnings: rendered.script_warnings,
        png_bytes: rendered.png_bytes,
    })
}

pub(crate) async fn run_assignment_update(
    state: &AppState,
    project_id: &str,
    project: &Value,
    assignment_id: &str,
    force: bool,
) -> Result<AssignmentForceUpdateResponse, ApiError> {
    let settings_doc = read_settings(state).await?;
    let config = assignment_configs(project, Some(&settings_doc))
        .into_iter()
        .find(|entry| entry.assignment_id == assignment_id)
        .ok_or_else(|| ApiError::not_found(format!("Unknown assignment {assignment_id}")))?;
    let key = assignment_key(project_id, assignment_id);
    {
        let mut states = state
            .assignment_states
            .lock()
            .expect("assignment state mutex poisoned");
        let entry = states.entry(key.clone()).or_insert(SchedulerState {
            config_signature: None,
            next_run_at: None,
            last_run_at: None,
            last_completed_at: None,
            last_result: None,
            last_error: None,
            last_hash: None,
            running: false,
        });
        entry.running = true;
        entry.last_run_at = Some(now_ms());
    }

    let started_at = now_ms();
    let mut log_rendered: Option<RenderedPreviewOutput> = None;
    let mut log_desired = true;
    let result = async {
        if !config.schedulable {
            return Err(ApiError::bad_request(
                "Scheduling requires a managed OpenEPaperLink AP display.",
            ));
        }
        let rendered = render_assigned_live(state, project_id, project, &config.display_id).await?;
        let state_previous_hash = {
            let states = state
                .assignment_states
                .lock()
                .expect("assignment state mutex poisoned");
            states.get(&key).and_then(|entry| entry.last_hash.clone())
        };
        let previous_hash = match state_previous_hash {
            Some(hash) => Some(hash),
            None => read_assignment_update_log(state)
                .await
                .ok()
                .and_then(|entries| {
                    entries
                        .into_iter()
                        .filter(|entry| {
                            entry.project_id == project_id
                                && entry.assignment_id == assignment_id
                                && entry.succeeded
                                && entry.hash.is_some()
                        })
                        .max_by_key(|entry| entry.timestamp_ms)
                        .and_then(|entry| entry.hash)
                }),
        };
        log_desired = previous_hash.as_deref() != Some(rendered.hash.as_str());
        log_rendered = Some(rendered.clone());
        let provider_instance = find_provider_instance(&settings_doc, &config.provider_instance_id)
            .ok_or_else(|| ApiError::bad_request("Display provider instance is not configured."))?;
        let settings = openepaperlink_settings_from_instance(&provider_instance);
        if settings.url.trim().is_empty() {
            return Err(ApiError::bad_request(
                "OpenEPaperLink access point URL is not configured.",
            ));
        }
        if !force && previous_hash.as_deref() == Some(rendered.hash.as_str()) {
            let mut states = state
                .assignment_states
                .lock()
                .expect("assignment state mutex poisoned");
            if let Some(entry) = states.get_mut(&key) {
                entry.last_completed_at = Some(now_ms());
                entry.last_result = Some("skipped_unchanged".into());
                entry.last_error = None;
                entry.next_run_at = if config.enabled {
                    Some(now_ms() + config.interval_minutes * 60_000)
                } else {
                    None
                };
                entry.running = false;
            }
            return Ok(AssignmentForceUpdateResponse {
                assignment_id: config.assignment_id.clone(),
                display_id: config.display_id.clone(),
                updated: false,
                skipped: true,
                hash: Some(rendered.hash),
                active_screen_id: Some(rendered.active_screen_id),
                active_overlay_id: rendered.active_overlay_id,
                message: "Skipped unchanged image.".into(),
            });
        }
        let jpeg = png_to_jpeg(&rendered.png_bytes)?;
        upload_image_to_access_point(
            &state.http,
            &settings,
            &config.mac,
            jpeg,
            format!("{}.jpg", config.provider_device_ref),
        )
        .await?;
        let mut states = state
            .assignment_states
            .lock()
            .expect("assignment state mutex poisoned");
        if let Some(entry) = states.get_mut(&key) {
            entry.last_hash = Some(rendered.hash.clone());
            entry.last_completed_at = Some(now_ms());
            entry.last_result = Some("updated".into());
            entry.last_error = None;
            entry.next_run_at = if config.enabled {
                Some(now_ms() + config.interval_minutes * 60_000)
            } else {
                None
            };
            entry.running = false;
        }
        Ok(AssignmentForceUpdateResponse {
            assignment_id: config.assignment_id.clone(),
            display_id: config.display_id.clone(),
            updated: true,
            skipped: false,
            hash: Some(rendered.hash),
            active_screen_id: Some(rendered.active_screen_id),
            active_overlay_id: rendered.active_overlay_id,
            message: if force {
                "Forced update uploaded.".into()
            } else {
                "Scheduled update uploaded.".into()
            },
        })
    }
    .await;

    if let Err(error) = &result {
        let mut states = state
            .assignment_states
            .lock()
            .expect("assignment state mutex poisoned");
        if let Some(entry) = states.get_mut(&key) {
            entry.last_completed_at = Some(now_ms());
            entry.last_result = Some("error".into());
            entry.last_error = Some(error.message.clone());
            entry.next_run_at = if config.enabled && !force {
                Some(now_ms() + config.interval_minutes * 60_000)
            } else {
                None
            };
            entry.running = false;
        }
    }
    let (succeeded, message, error) = match &result {
        Ok(response) => (true, Some(response.message.clone()), None),
        Err(error) => (false, None, Some(error.message.clone())),
    };
    let log_entry = AssignmentUpdateLogEntry {
        timestamp_ms: started_at,
        timestamp: iso_string_required(started_at),
        project_id: project_id.to_string(),
        assignment_id: config.assignment_id.clone(),
        display_id: config.display_id.clone(),
        desired: log_desired,
        succeeded,
        hash: log_rendered.as_ref().map(|rendered| rendered.hash.clone()),
        width: log_rendered.as_ref().map(|rendered| rendered.width),
        height: log_rendered.as_ref().map(|rendered| rendered.height),
        image_png_base64: log_rendered
            .as_ref()
            .map(|rendered| base64::engine::general_purpose::STANDARD.encode(&rendered.png_bytes)),
        message,
        error,
    };
    let _ = append_assignment_update_log(state, &settings_doc, log_entry).await;
    result
}

pub(crate) async fn list_assignment_schedule_statuses(
    state: &AppState,
    project_id: &str,
) -> Result<Vec<AssignmentScheduleStatusResponse>, ApiError> {
    let project = read_json_file(&project_file_path(&state.data_dir, project_id)).await?;
    let settings = read_settings(state).await?;
    Ok(assignment_configs(&project, Some(&settings))
        .iter()
        .map(|entry| build_assignment_status(state, project_id, entry))
        .collect())
}

pub(crate) async fn upload_device_image_for_display(
    state: &AppState,
    project_id: &str,
    project: &Value,
    display_id: &str,
) -> Result<Value, ApiError> {
    let display = project
        .get("devices")
        .and_then(Value::as_array)
        .and_then(|devices| {
            devices
                .iter()
                .find(|entry| entry.get("id").and_then(Value::as_str) == Some(display_id))
                .cloned()
        })
        .ok_or_else(|| ApiError::not_found(format!("Unknown display {display_id}")))?;
    if display.get("providerKind").and_then(Value::as_str) != Some("openepaperlink-ap") {
        return Err(ApiError::bad_request(
            "Display is not managed by an OpenEPaperLink access point",
        ));
    }
    let provider_instance_id = display
        .get("displayProviderInstanceId")
        .and_then(Value::as_str)
        .or_else(|| {
            (display.get("providerKind").and_then(Value::as_str) == Some("openepaperlink-ap"))
                .then_some("openepaperlink-ap-default")
        })
        .unwrap_or("openepaperlink-ap-default");
    let settings_store = read_settings(state).await?;
    let provider_instance = find_provider_instance(&settings_store, provider_instance_id)
        .ok_or_else(|| {
            ApiError::bad_request("OpenEPaperLink provider instance is not configured")
        })?;
    let settings = openepaperlink_settings_from_instance(&provider_instance);
    if settings.url.trim().is_empty() {
        return Err(ApiError::bad_request(
            "OpenEPaperLink access point URL is not configured",
        ));
    }
    let rendered = render_assigned_live(state, project_id, project, display_id).await?;
    let jpeg = png_to_jpeg(&rendered.png_bytes)?;
    let provider_ref = display
        .get("providerDeviceRef")
        .or_else(|| display.get("providerRef"))
        .and_then(Value::as_str)
        .unwrap_or(display_id);
    let mac = string_at(&display, &["metadata", "mac"]).unwrap_or_else(|| provider_ref.to_string());
    upload_image_to_access_point(
        &state.http,
        &settings,
        &mac,
        jpeg,
        format!("{provider_ref}.jpg"),
    )
    .await?;
    Ok(json!({
        "uploaded": true,
        "hash": rendered.hash,
        "width": rendered.width,
        "height": rendered.height,
        "dataSourceMessage": rendered.data_source_message,
        "scriptWarnings": rendered.script_warnings
    }))
}

pub(crate) async fn tick_assignment_scheduler(state: AppState) {
    let mut valid_keys = Vec::new();
    let settings = read_settings(&state).await.ok();
    let projects: Vec<ProjectSummary> =
        if let Ok(Json(projects)) = list_projects(axum::extract::State(state.clone())).await {
            projects
        } else {
            Vec::new()
        };
    for project in projects {
        if let Ok(project_value) =
            read_json_file(&project_file_path(&state.data_dir, &project.id)).await
        {
            for config in assignment_configs(&project_value, settings.as_ref()) {
                let key = assignment_key(&project.id, &config.assignment_id);
                valid_keys.push(key.clone());
                let signature = format!(
                    "{}:{}:{}:{}",
                    config.enabled, config.interval_minutes, config.display_id, config.schedulable
                );
                let mut should_run = false;
                {
                    let mut states = state
                        .assignment_states
                        .lock()
                        .expect("assignment state mutex poisoned");
                    let entry = states.entry(key.clone()).or_insert(SchedulerState {
                        config_signature: None,
                        next_run_at: None,
                        last_run_at: None,
                        last_completed_at: None,
                        last_result: None,
                        last_error: None,
                        last_hash: None,
                        running: false,
                    });
                    if entry.config_signature.as_deref() != Some(signature.as_str()) {
                        entry.config_signature = Some(signature.clone());
                        entry.next_run_at = if config.enabled && config.schedulable {
                            Some(now_ms() + config.interval_minutes * 60_000)
                        } else {
                            None
                        };
                        if !config.enabled {
                            if !matches!(
                                entry.last_result.as_deref(),
                                Some("updated" | "skipped_unchanged")
                            ) {
                                entry.last_result = Some("disabled".into());
                            }
                        } else if !config.schedulable {
                            entry.last_result = Some("error".into());
                            entry.last_error = Some(
                                "Scheduling requires a managed OpenEPaperLink AP display.".into(),
                            );
                        }
                    }
                    if config.enabled
                        && config.schedulable
                        && !entry.running
                        && entry.next_run_at.is_some_and(|value| value <= now_ms())
                    {
                        should_run = true;
                    }
                }
                if should_run {
                    let _ = run_assignment_update(
                        &state,
                        &project.id,
                        &project_value,
                        &config.assignment_id,
                        false,
                    )
                    .await;
                }
            }
        }
    }
    let mut states = state
        .assignment_states
        .lock()
        .expect("assignment state mutex poisoned");
    states.retain(|key, _| valid_keys.iter().any(|candidate| candidate == key));
}

pub(crate) fn spawn_assignment_scheduler(state: AppState) {
    tokio::spawn(async move {
        loop {
            tick_assignment_scheduler(state.clone()).await;
            sleep(Duration::from_secs(30)).await;
        }
    });
}
