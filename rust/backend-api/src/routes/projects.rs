use axum::{
    extract::{Path as AxumPath, State},
    Json,
};
use serde_json::Value;
use tokio::fs;

use crate::{
    app::AppState, ensure_seeded, integer_field, project_file_path, projects_dir, read_json_file,
    string_field, write_json_file, ApiError, ApiResult, ProjectSummary,
};

pub(crate) async fn list_projects(State(state): State<AppState>) -> ApiResult<Vec<ProjectSummary>> {
    ensure_seeded(&state).await?;
    let mut entries = fs::read_dir(projects_dir(&state.data_dir))
        .await
        .map_err(crate::internal_error)?;
    let mut projects = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(crate::internal_error)? {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let value = read_json_file(&path).await?;
        let summary = ProjectSummary {
            id: string_field(&value, "id"),
            name: string_field(&value, "name"),
            version: integer_field(&value, "version"),
        };
        projects.push(summary);
    }
    projects.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(Json(projects))
}

pub(crate) async fn get_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    ensure_seeded(&state).await?;
    Ok(Json(
        read_json_file(&project_file_path(&state.data_dir, &id)).await?,
    ))
}

pub(crate) async fn save_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(mut project): Json<Value>,
) -> ApiResult<Value> {
    let object = project
        .as_object_mut()
        .ok_or_else(|| ApiError::bad_request("Project payload must be an object"))?;
    let payload_id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("Project id missing"))?;
    if payload_id != id {
        return Err(ApiError::bad_request("Project id does not match route"));
    }
    let next_version = object.get("version").and_then(Value::as_i64).unwrap_or(0) + 1;
    object.insert("version".into(), Value::from(next_version));
    ensure_seeded(&state).await?;
    write_json_file(&project_file_path(&state.data_dir, &id), &project).await?;
    Ok(Json(project))
}
