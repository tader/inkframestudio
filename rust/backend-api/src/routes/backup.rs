use axum::{extract::State, Json};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;

use crate::{
    app::AppState, font_index_file_path, fonts_dir, projects_dir, read_json_file,
    storage::settings_file_path, write_json_file, ApiError, ApiResult,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupArchive {
    version: u32,
    exported_at: String,
    settings: Option<Value>,
    font_index: Option<Value>,
    fonts: Vec<BackupFontFile>,
    projects: Vec<BackupProject>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFontFile {
    filename: String,
    base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BackupProject {
    id: String,
    value: Value,
}

fn clean_filename(value: &str) -> Result<&str, ApiError> {
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
    {
        return Err(ApiError::bad_request("Invalid backup filename"));
    }
    Ok(value)
}

fn clean_project_id(value: &str) -> Result<&str, ApiError> {
    if value.is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
    {
        return Err(ApiError::bad_request("Invalid backup project id"));
    }
    Ok(value)
}

pub(crate) async fn export_backup(State(state): State<AppState>) -> ApiResult<BackupArchive> {
    let settings = match read_json_file(&settings_file_path(&state.data_dir)).await {
        Ok(value) => Some(value),
        Err(error) if error.status == axum::http::StatusCode::NOT_FOUND => None,
        Err(error) => return Err(error),
    };
    let font_index = match read_json_file(&font_index_file_path(&state.data_dir)).await {
        Ok(value) => Some(value),
        Err(error) if error.status == axum::http::StatusCode::NOT_FOUND => None,
        Err(error) => return Err(error),
    };

    let mut fonts = Vec::new();
    if let Ok(mut entries) = fs::read_dir(fonts_dir(&state.data_dir)).await {
        while let Some(entry) = entries.next_entry().await.map_err(crate::internal_error)? {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(filename) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            clean_filename(filename)?;
            let bytes = fs::read(&path).await.map_err(crate::internal_error)?;
            fonts.push(BackupFontFile {
                filename: filename.into(),
                base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            });
        }
    }
    fonts.sort_by(|left, right| left.filename.cmp(&right.filename));

    let mut projects = Vec::new();
    if let Ok(mut entries) = fs::read_dir(projects_dir(&state.data_dir)).await {
        while let Some(entry) = entries.next_entry().await.map_err(crate::internal_error)? {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let value = read_json_file(&path).await?;
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| ApiError::internal("Project missing id"))?;
            clean_project_id(id)?;
            projects.push(BackupProject {
                id: id.into(),
                value,
            });
        }
    }
    projects.sort_by(|left, right| left.id.cmp(&right.id));

    Ok(Json(BackupArchive {
        version: 1,
        exported_at: chrono::Utc::now().to_rfc3339(),
        settings,
        font_index,
        fonts,
        projects,
    }))
}

pub(crate) async fn restore_backup(
    State(state): State<AppState>,
    Json(archive): Json<BackupArchive>,
) -> ApiResult<BackupArchive> {
    if archive.version != 1 {
        return Err(ApiError::bad_request("Unsupported backup version"));
    }
    for project in &archive.projects {
        clean_project_id(&project.id)?;
        let payload_id = project
            .value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| ApiError::bad_request("Backup project missing id"))?;
        if payload_id != project.id {
            return Err(ApiError::bad_request("Backup project id mismatch"));
        }
    }
    for font in &archive.fonts {
        clean_filename(&font.filename)?;
        base64::engine::general_purpose::STANDARD
            .decode(font.base64.as_bytes())
            .map_err(|error| ApiError::bad_request(format!("Invalid font base64: {error}")))?;
    }

    fs::remove_dir_all(projects_dir(&state.data_dir)).await.ok();
    fs::create_dir_all(projects_dir(&state.data_dir))
        .await
        .map_err(crate::internal_error)?;
    for project in &archive.projects {
        write_json_file(
            &projects_dir(&state.data_dir).join(format!("{}.json", project.id)),
            &project.value,
        )
        .await?;
    }

    fs::remove_dir_all(fonts_dir(&state.data_dir)).await.ok();
    fs::create_dir_all(fonts_dir(&state.data_dir))
        .await
        .map_err(crate::internal_error)?;
    for font in &archive.fonts {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(font.base64.as_bytes())
            .map_err(|error| ApiError::bad_request(format!("Invalid font base64: {error}")))?;
        fs::write(fonts_dir(&state.data_dir).join(&font.filename), bytes)
            .await
            .map_err(crate::internal_error)?;
    }

    if let Some(font_index) = &archive.font_index {
        write_json_file(&font_index_file_path(&state.data_dir), font_index).await?;
    } else {
        fs::remove_file(font_index_file_path(&state.data_dir))
            .await
            .ok();
    }

    if let Some(settings) = &archive.settings {
        write_json_file(&settings_file_path(&state.data_dir), settings).await?;
    } else {
        fs::remove_file(settings_file_path(&state.data_dir))
            .await
            .ok();
    }

    Ok(Json(archive))
}
