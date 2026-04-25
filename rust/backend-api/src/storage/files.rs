use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tokio::fs;

use crate::{app::AppState, internal_error, string_field, ApiError, SEEDED_PROJECT_JSON};

pub(crate) fn projects_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("projects")
}

pub(crate) fn fonts_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("fonts")
}

pub(crate) fn font_index_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("fonts.json")
}

pub(crate) fn settings_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

pub(crate) fn update_log_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join("update-log.json")
}

pub(crate) fn project_file_path(data_dir: &Path, id: &str) -> PathBuf {
    projects_dir(data_dir).join(format!("{id}.json"))
}

pub(crate) async fn ensure_seeded(state: &AppState) -> Result<(), ApiError> {
    fs::create_dir_all(projects_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    fs::create_dir_all(fonts_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    let mut entries = fs::read_dir(projects_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    if entries
        .next_entry()
        .await
        .map_err(internal_error)?
        .is_none()
    {
        let seeded: Value = serde_json::from_str(SEEDED_PROJECT_JSON)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        let project_id = string_field(&seeded, "id");
        write_json_file(&project_file_path(&state.data_dir, &project_id), &seeded).await?;
    }
    Ok(())
}

pub(crate) async fn read_json_file(path: &Path) -> Result<Value, ApiError> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => {
                ApiError::not_found(format!("Missing {}", path.display()))
            }
            _ => internal_error(error),
        })?;
    serde_json::from_str(&content).map_err(|error| ApiError::internal(error.to_string()))
}

pub(crate) async fn write_json_file(path: &Path, value: &Value) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await.map_err(internal_error)?;
    }
    let temp_path = path.with_extension(format!(
        "{}.tmp",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| ApiError::internal(error.to_string()))?
            .as_nanos()
    ));
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| ApiError::internal(error.to_string()))?;
    fs::write(&temp_path, [&bytes[..], b"\n"].concat())
        .await
        .map_err(internal_error)?;
    fs::rename(&temp_path, path).await.map_err(internal_error)?;
    Ok(())
}
