use axum::{
    extract::{Path as AxumPath, State},
    Json,
};
use serde_json::{json, Value};

use crate::{
    app::AppState, load_project_for_request, load_user_font_data,
    run_bridge_value, services::{render_data::resolve_project_render_data_value, scheduler::{
        list_assignment_schedule_statuses, run_assignment_update, upload_device_image_for_display,
    }}, ApiError, ApiResult, AssignmentForceUpdateResponse, AssignmentScheduleStatusResponse,
    BridgeRenderResponse,
};

pub(crate) async fn list_assignment_schedules(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Vec<AssignmentScheduleStatusResponse>> {
    Ok(Json(
        list_assignment_schedule_statuses(&state, &project_id).await?,
    ))
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
    let (data, message) = resolve_project_render_data_value(&state, &project, None).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let mut render_body = body.clone();
    if let Some(object) = render_body.as_object_mut() {
        object.insert("project".into(), project);
        object.insert("data".into(), data);
        object.insert("userFonts".into(), user_fonts);
        if let Some(message) = message {
            object.insert("dataSourceMessage".into(), Value::from(message));
        }
    }
    let rendered: BridgeRenderResponse = serde_json::from_value(
        run_bridge_value(
            &state,
            json!({ "op": "preview", "projectId": project_id, "body": render_body }),
        )
        .await?,
    )
    .map_err(|error| ApiError::internal(error.to_string()))?;
    let display_profile_id = body
        .get("displayProfileId")
        .and_then(Value::as_str)
        .unwrap_or("tri296x128-red");
    let scenario_id = body.get("scenarioId").and_then(Value::as_str).unwrap_or("");
    let key = format!("{project_id}:{display_profile_id}:{scenario_id}");
    let previous = {
        let hashes = state.publish_hashes.lock().expect("publish hash mutex poisoned");
        hashes.get(&key).cloned()
    };
    let published = previous.as_deref() != Some(rendered.hash.as_str());
    if published {
        let mut hashes = state.publish_hashes.lock().expect("publish hash mutex poisoned");
        hashes.insert(key, rendered.hash.clone());
    }
    Ok(Json(json!({
        "published": published,
        "hash": rendered.hash,
        "activeScreenId": rendered.active_screen_id,
        "activeOverlayId": rendered.active_overlay_id,
        "scriptWarnings": rendered.script_warnings,
        "dataSourceMessage": rendered.data_source_message
    })))
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
