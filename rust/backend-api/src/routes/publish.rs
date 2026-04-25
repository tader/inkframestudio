use axum::{
    extract::{Path as AxumPath, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    app::AppState,
    load_project_for_request, load_user_font_data,
    native_layout_preview::try_render_layout_preview_value,
    read_settings,
    services::{
        render_data::resolve_project_render_data_value,
        scheduler::{
            list_assignment_schedule_statuses, read_assignment_update_log, run_assignment_update,
            schedule_update_log_retention_days, upload_device_image_for_display,
        },
    },
    write_settings, ApiError, ApiResult, AssignmentForceUpdateResponse,
    AssignmentScheduleStatusResponse, AssignmentUpdateLogEntry, ScheduleUpdateLogSettings,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateLogQuery {
    since_ms: Option<u64>,
}

pub(crate) async fn list_assignment_schedules(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Vec<AssignmentScheduleStatusResponse>> {
    Ok(Json(
        list_assignment_schedule_statuses(&state, &project_id).await?,
    ))
}

pub(crate) async fn list_display_update_log(
    State(state): State<AppState>,
    AxumPath((project_id, display_id)): AxumPath<(String, String)>,
    Query(query): Query<UpdateLogQuery>,
) -> ApiResult<Vec<AssignmentUpdateLogEntry>> {
    let since_ms = query.since_ms.unwrap_or(0);
    let mut entries = read_assignment_update_log(&state).await?;
    entries.retain(|entry| {
        entry.project_id == project_id
            && entry.display_id == display_id
            && entry.timestamp_ms >= since_ms
    });
    entries.sort_by(|left, right| right.timestamp_ms.cmp(&left.timestamp_ms));
    Ok(Json(entries))
}

pub(crate) async fn get_schedule_update_log_settings(
    State(state): State<AppState>,
) -> ApiResult<ScheduleUpdateLogSettings> {
    let settings = read_settings(&state).await?;
    Ok(Json(ScheduleUpdateLogSettings {
        retention_days: schedule_update_log_retention_days(&settings),
    }))
}

pub(crate) async fn save_schedule_update_log_settings(
    State(state): State<AppState>,
    Json(input): Json<ScheduleUpdateLogSettings>,
) -> ApiResult<ScheduleUpdateLogSettings> {
    let mut settings = read_settings(&state).await?;
    settings.schedule_update_log_retention_days = Some(input.retention_days.max(1));
    write_settings(&state, &settings).await?;
    Ok(Json(ScheduleUpdateLogSettings {
        retention_days: schedule_update_log_retention_days(&settings),
    }))
}

pub(crate) async fn force_assignment_update(
    State(state): State<AppState>,
    AxumPath((project_id, assignment_id)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<AssignmentForceUpdateResponse> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    Ok(Json(
        run_assignment_update(&state, &project_id, &project, &assignment_id, true).await?,
    ))
}

pub(crate) async fn publish_project(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let (data, _message) = resolve_project_render_data_value(&state, &project, None).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let layout_id = body
        .get("layoutId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            body.get("displayProfileId")
                .and_then(Value::as_str)
                .and_then(|display_profile_id| {
                    render_body_layout_id_from_profile(&project, display_profile_id)
                })
        });
    let render_body = json!({
        "project": project.clone(),
        "layoutId": layout_id,
        "popupLayoutId": body.get("popupLayoutId").cloned().unwrap_or(Value::Null),
    });
    let rendered = try_render_layout_preview_value(
        render_body.get("project").unwrap_or(&Value::Null),
        &user_fonts,
        &render_body,
        &data,
    )?
    .ok_or_else(|| {
        ApiError::bad_request("Native renderer does not support requested publish render")
    })?;
    let hash = rendered
        .get("hash")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let active_screen_id = rendered
        .get("activeScreenId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let active_overlay_id = rendered
        .get("activeOverlayId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let script_warnings = rendered
        .get("scriptWarnings")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        });
    let data_source_message = rendered
        .get("dataSourceMessage")
        .and_then(Value::as_str)
        .map(str::to_string);
    let display_profile_id = body
        .get("displayProfileId")
        .and_then(Value::as_str)
        .unwrap_or("tri296x128-red");
    let scenario_id = body.get("scenarioId").and_then(Value::as_str).unwrap_or("");
    let key = format!("{project_id}:{display_profile_id}:{scenario_id}");
    let previous = {
        let hashes = state
            .publish_hashes
            .lock()
            .expect("publish hash mutex poisoned");
        hashes.get(&key).cloned()
    };
    let published = previous.as_deref() != Some(hash.as_str());
    if published {
        let mut hashes = state
            .publish_hashes
            .lock()
            .expect("publish hash mutex poisoned");
        hashes.insert(key, hash.clone());
    }
    Ok(Json(json!({
        "published": published,
        "hash": hash,
        "activeScreenId": active_screen_id,
        "activeOverlayId": active_overlay_id,
        "scriptWarnings": script_warnings,
        "dataSourceMessage": data_source_message
    })))
}

fn render_body_layout_id_from_profile(project: &Value, display_profile_id: &str) -> Option<String> {
    let layouts = project.get("layoutDefinitions")?.as_array()?;
    layouts
        .iter()
        .find(|layout| {
            layout.get("displayTypeId").and_then(Value::as_str) == Some(display_profile_id)
                || layout.get("kind").and_then(Value::as_str) == Some("fullscreen")
        })
        .and_then(|layout| layout.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub(crate) async fn upload_device_image(
    State(state): State<AppState>,
    AxumPath((project_id, display_id)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    Ok(Json(
        upload_device_image_for_display(&state, &project_id, &project, &display_id).await?,
    ))
}
