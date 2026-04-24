use axum::{
    extract::{Path as AxumPath, State},
    Json,
};
use serde_json::{json, Value};

use crate::{
    app::AppState, bridge_json_response, bridge_render_preview_value, built_in_font_options,
    list_font_options, load_project_for_request, load_user_font_data,
    native_theme_preview::render_theme_preview_value, run_bridge_value,
    services::render_data::resolve_project_render_data_value, ApiError, ApiResult,
    BridgeRenderResponse,
};

pub(crate) async fn live_data(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
) -> ApiResult<Value> {
    let project =
        crate::read_json_file(&crate::project_file_path(&state.data_dir, &project_id)).await?;
    Ok(Json(
        resolve_project_render_data_value(&state, &project, None)
            .await?
            .0,
    ))
}

fn inject_live_render_context(
    mut body: Value,
    project: Value,
    data: Value,
    user_fonts: Value,
    message: Option<String>,
) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.insert("project".into(), project);
        object.insert("data".into(), data);
        object.insert("userFonts".into(), user_fonts);
        if let Some(message) = message {
            object.insert("dataSourceMessage".into(), Value::from(message));
        }
    }
    body
}

pub(crate) async fn preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let (data, message) = resolve_project_render_data_value(&state, &project, None).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let body = inject_live_render_context(body, project, data, user_fonts, message);
    let rendered: BridgeRenderResponse = serde_json::from_value(
        run_bridge_value(
            &state,
            json!({ "op": "preview", "projectId": project_id, "body": body }),
        )
        .await?,
    )
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(bridge_render_preview_value(&rendered)?))
}

pub(crate) async fn layout_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let layout_id = body.get("layoutId").and_then(Value::as_str);
    let (data, message) = resolve_project_render_data_value(&state, &project, layout_id).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let body = inject_live_render_context(body, project, data, user_fonts, message);
    let response = run_bridge_value(
        &state,
        json!({ "op": "layout-preview", "projectId": project_id, "body": body }),
    )
    .await?;
    if let Some(preview_value) = response.get("preview") {
        let rendered: BridgeRenderResponse = serde_json::from_value(preview_value.clone())
            .map_err(|error| ApiError::internal(error.to_string()))?;
        let inspection = response.get("inspection").cloned();
        return Ok(Json(json!({
            "preview": bridge_render_preview_value(&rendered)?,
            "inspection": inspection
        })));
    }
    let rendered: BridgeRenderResponse =
        serde_json::from_value(response).map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(bridge_render_preview_value(&rendered)?))
}

pub(crate) async fn device_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let (data, message) = resolve_project_render_data_value(&state, &project, None).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let body = inject_live_render_context(body, project, data, user_fonts, message);
    let rendered: BridgeRenderResponse = serde_json::from_value(
        run_bridge_value(
            &state,
            json!({ "op": "device-preview", "projectId": project_id, "body": body }),
        )
        .await?,
    )
    .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(Json(bridge_render_preview_value(&rendered)?))
}

pub(crate) async fn font_specimens(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let available_fonts = list_font_options(&state).await?;
    let fonts = if available_fonts.is_empty() {
        built_in_font_options()
    } else {
        available_fonts
    };
    let mut body = body;
    if let Some(object) = body.as_object_mut() {
        object.insert("project".into(), project);
        object.insert("userFonts".into(), user_fonts);
        object.insert(
            "fonts".into(),
            serde_json::to_value(fonts).map_err(|error| ApiError::internal(error.to_string()))?,
        );
    }
    bridge_json_response(
        &state,
        json!({ "op": "font-specimens", "projectId": project_id, "body": body }),
    )
    .await
}

pub(crate) async fn theme_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let theme_id = body
        .get("themeId")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("themeId missing"))?;
    let display_type_id = body
        .get("displayTypeId")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("displayTypeId missing"))?;
    Ok(Json(render_theme_preview_value(
        &project,
        &user_fonts,
        theme_id,
        display_type_id,
    )?))
}
