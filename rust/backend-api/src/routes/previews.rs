use axum::{
    extract::{Path as AxumPath, State},
    Json,
};
use base64::Engine;
use serde_json::Value;

use crate::{
    app::AppState,
    list_font_options, load_project_for_request, load_user_font_data,
    native_font_specimens::render_font_specimens_value,
    native_layout_preview::{try_render_layout_preview_value, unsupported_layout_preview_reason},
    native_theme_preview::render_theme_preview_value,
    services::{render_data::resolve_project_render_data_value, scheduler::render_assigned_live},
    ApiError, ApiResult,
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

pub(crate) async fn live_data_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let layout_id = body.get("layoutId").and_then(Value::as_str);
    Ok(Json(
        resolve_project_render_data_value(&state, &project, layout_id)
            .await?
            .0,
    ))
}

pub(crate) async fn layout_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let layout_id = body.get("layoutId").and_then(Value::as_str);
    let (data, _message) = resolve_project_render_data_value(&state, &project, layout_id).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let Some(native) = try_render_layout_preview_value(&project, &user_fonts, &body, &data)? else {
        let reason = unsupported_layout_preview_reason(&project, &body);
        let layout_id = body
            .get("layoutId")
            .and_then(Value::as_str)
            .unwrap_or("<missing>");
        let display_type_id = body
            .get("displayTypeId")
            .and_then(Value::as_str)
            .unwrap_or("<none>");
        println!(
            "[inkframe:preview] layout_preview unsupported project_id={project_id} layout_id={layout_id} display_type_id={display_type_id} reason={reason}"
        );
        return Err(ApiError::bad_request(format!(
            "Native renderer does not support requested layout preview: {reason}"
        )));
    };
    Ok(Json(native))
}

pub(crate) async fn device_preview(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let display_id = body
        .get("displayId")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("displayId missing"))?;
    let rendered = render_assigned_live(&state, &project_id, &project, display_id).await?;
    Ok(Json(serde_json::json!({
        "width": rendered.width,
        "height": rendered.height,
        "hash": rendered.hash,
        "activeScreenId": rendered.active_screen_id,
        "activeOverlayId": rendered.active_overlay_id,
        "dataSourceMessage": rendered.data_source_message,
        "scriptWarnings": rendered.script_warnings,
        "pngBase64": base64::engine::general_purpose::STANDARD.encode(&rendered.png_bytes),
    })))
}

pub(crate) async fn font_specimens(
    State(state): State<AppState>,
    AxumPath(project_id): AxumPath<String>,
    Json(body): Json<Value>,
) -> ApiResult<Value> {
    let project = load_project_for_request(&state, &project_id, Some(&body)).await?;
    let user_fonts = load_user_font_data(&state).await?;
    let fonts = list_font_options(&state).await?;
    let display_profile_id = body
        .get("displayProfileId")
        .and_then(Value::as_str)
        .unwrap_or("tri296x128-red");
    let profile = state
        .display_profiles
        .iter()
        .find(|entry| entry.id == display_profile_id)
        .or_else(|| state.display_profiles.first())
        .ok_or_else(|| ApiError::internal("No display profiles loaded"))?;
    let sample_text = body
        .get("sampleText")
        .and_then(Value::as_str)
        .unwrap_or("Ag 09:45 bdpq RH 21.5C");
    let min_size = body.get("minSize").and_then(Value::as_i64).unwrap_or(4) as i32;
    let max_size = body.get("maxSize").and_then(Value::as_i64).unwrap_or(36) as i32;
    let family_id = body.get("familyId").and_then(Value::as_str);
    let include_all_sizes = body
        .get("includeAllSizes")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(Json(render_font_specimens_value(
        &project,
        &user_fonts,
        profile,
        sample_text,
        min_size.max(1),
        max_size.max(min_size.max(1)),
        &fonts,
        family_id,
        include_all_sizes,
    )?))
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
