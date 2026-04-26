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
    println!(
        "[inkframe:projects] list start data_dir={} projects_dir={}",
        state.data_dir.display(),
        projects_dir(&state.data_dir).display()
    );
    ensure_seeded(&state).await?;
    let mut entries = fs::read_dir(projects_dir(&state.data_dir))
        .await
        .map_err(|error| {
            println!(
                "[inkframe:projects] list read_dir failed path={} error={}",
                projects_dir(&state.data_dir).display(),
                error
            );
            crate::internal_error(error)
        })?;
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
        println!(
            "[inkframe:projects] list found id={} name={:?} version={} path={}",
            summary.id,
            summary.name,
            summary.version,
            path.display()
        );
        projects.push(summary);
    }
    projects.sort_by(|left, right| left.name.cmp(&right.name));
    println!("[inkframe:projects] list ok count={}", projects.len());
    Ok(Json(projects))
}

pub(crate) async fn get_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Value> {
    ensure_seeded(&state).await?;
    let path = project_file_path(&state.data_dir, &id);
    println!("[inkframe:projects] get id={} path={}", id, path.display());
    match read_json_file(&path).await {
        Ok(project) => {
            println!("[inkframe:projects] get ok id={}", id);
            Ok(Json(project))
        }
        Err(error) => {
            println!(
                "[inkframe:projects] get failed id={} status={} error={}",
                id, error.status, error.message
            );
            Err(error)
        }
    }
}

pub(crate) async fn save_project(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(mut project): Json<Value>,
) -> ApiResult<Value> {
    println!(
        "[inkframe:projects] save start route_id={} data_dir={}",
        id,
        state.data_dir.display()
    );
    let object = project
        .as_object_mut()
        .ok_or_else(|| ApiError::bad_request("Project payload must be an object"))?;
    let payload_id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("Project id missing"))?;
    println!(
        "[inkframe:projects] save payload route_id={} payload_id={} current_version={}",
        id,
        payload_id,
        object.get("version").and_then(Value::as_i64).unwrap_or(0)
    );
    if payload_id != id {
        println!(
            "[inkframe:projects] save id mismatch route_id={} payload_id={}",
            id, payload_id
        );
        return Err(ApiError::bad_request("Project id does not match route"));
    }
    let next_version = object.get("version").and_then(Value::as_i64).unwrap_or(0) + 1;
    object.insert("version".into(), Value::from(next_version));
    ensure_seeded(&state).await?;
    let path = project_file_path(&state.data_dir, &id);
    println!(
        "[inkframe:projects] save writing route_id={} next_version={} path={}",
        id,
        next_version,
        path.display()
    );
    write_json_file(&path, &project).await?;
    println!(
        "[inkframe:projects] save ok route_id={} next_version={}",
        id, next_version
    );
    Ok(Json(project))
}
