use std::path::Path;

use axum::{
    extract::{Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use base64::Engine;
use regex::Regex;
use tokio::fs;
use zip::ZipArchive;

use crate::{
    absolute_dafont_url, app::AppState, assert_dafont_url, build_allowed_sizes,
    built_in_font_options, choose_best_family, choose_best_variants, detect_font_variant_from_name,
    extract_font_names, fetch_dafont_page_native, font_files, fonts_dir, internal_error,
    list_font_options, read_font_index, slugify_font_id, to_font_option, write_font_index, ApiError,
    ApiResult, DaFontEntry, DaFontPageQuery, DaFontPageResponse, FontImportRequest,
    FontImportResponse, FontMetadataPatch, FontOption, StoredFontFamily, StoredFontsIndex,
};

pub(crate) async fn list_fonts(State(state): State<AppState>) -> ApiResult<Vec<FontOption>> {
    let fonts = list_font_options(&state).await?;
    Ok(Json(if fonts.is_empty() {
        built_in_font_options()
    } else {
        fonts
    }))
}

pub(crate) async fn delete_font(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let mut index = read_font_index(&state).await?;
    let removed = index.fonts.iter().find(|entry| entry.id == id).cloned();
    index.fonts.retain(|entry| entry.id != id);
    if let Some(font) = removed {
        for (_, filename) in font_files(&font) {
            let _ = fs::remove_file(fonts_dir(&state.data_dir).join(filename)).await;
        }
        write_font_index(&state, &index).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn update_font_metadata(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<String>,
    Json(patch): Json<FontMetadataPatch>,
) -> ApiResult<Option<FontOption>> {
    let mut index = read_font_index(&state).await?;
    let mut updated = None;
    for font in &mut index.fonts {
        if font.id != id {
            continue;
        }
        font.allowed_pixel_sizes = patch.allowed_pixel_sizes.as_ref().and_then(|values| {
            let mut next = values
                .iter()
                .copied()
                .filter(|value| *value >= 4)
                .collect::<Vec<_>>();
            next.sort();
            next.dedup();
            if next.is_empty() { None } else { Some(next) }
        });
        updated = Some(to_font_option(font));
        break;
    }
    write_font_index(&state, &index).await?;
    Ok(Json(updated))
}

pub(crate) async fn import_font(
    State(state): State<AppState>,
    Json(payload): Json<FontImportRequest>,
) -> ApiResult<FontImportResponse> {
    let filename = payload.filename.trim();
    if filename.is_empty() {
        return Err(ApiError::bad_request("Filename missing"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.base64.as_bytes())
        .map_err(|error| ApiError::bad_request(format!("Invalid base64: {error}")))?;
    let extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("ttf");
    let label = filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename)
        .replace(['_', '-'], " ")
        .trim()
        .to_string();
    let family_id = slugify_font_id(&label);
    let variant = detect_font_variant_from_name(filename);
    let stored_filename = format!("{family_id}-{variant}.{extension}");

    fs::create_dir_all(fonts_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    fs::write(fonts_dir(&state.data_dir).join(&stored_filename), bytes)
        .await
        .map_err(internal_error)?;

    let mut index = read_font_index(&state).await?;
    if let Some(existing) = index.fonts.iter_mut().find(|font| font.id == family_id) {
        existing.label = label.clone();
        let files = existing
            .files
            .as_object_mut()
            .ok_or_else(|| ApiError::internal("Invalid fonts index"))?;
        files.insert(variant.clone(), serde_json::Value::from(stored_filename));
        existing.import_source = Some("upload".into());
    } else {
        index.fonts.push(StoredFontFamily {
            id: family_id.clone(),
            label: label.clone(),
            files: serde_json::json!({ variant.clone(): stored_filename }),
            allowed_pixel_sizes: None,
            import_source: Some("upload".into()),
            source_url: None,
            preview_url: None,
            declared_pixel_size: None,
            license_category: None,
        });
    }
    write_font_index(&state, &index).await?;

    Ok(Json(FontImportResponse {
        id: family_id,
        label,
        variant,
    }))
}

pub(crate) async fn rescan_fonts(State(state): State<AppState>) -> ApiResult<Vec<FontOption>> {
    fs::create_dir_all(fonts_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    let previous = read_font_index(&state).await?;
    let previous_by_id = previous
        .fonts
        .iter()
        .map(|font| (font.id.clone(), font.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();

    let mut entries = fs::read_dir(fonts_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    let mut merged = std::collections::BTreeMap::<String, StoredFontFamily>::new();
    while let Some(entry) = entries.next_entry().await.map_err(internal_error)? {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "ttf" | "otf" | "woff" | "woff2") {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let label = filename
            .rsplit_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(&filename)
            .replace(['_', '-'], " ")
            .trim()
            .to_string();
        let family_id = slugify_font_id(&label);
        let variant = detect_font_variant_from_name(&filename);
        let previous_font = previous_by_id.get(&family_id);
        let font = merged.entry(family_id.clone()).or_insert_with(|| StoredFontFamily {
            id: family_id.clone(),
            label: label.clone(),
            files: serde_json::json!({}),
            allowed_pixel_sizes: previous_font.and_then(|font| font.allowed_pixel_sizes.clone()),
            import_source: previous_font
                .and_then(|font| font.import_source.clone())
                .or(Some("upload".into())),
            source_url: previous_font.and_then(|font| font.source_url.clone()),
            preview_url: previous_font.and_then(|font| font.preview_url.clone()),
            declared_pixel_size: previous_font.and_then(|font| font.declared_pixel_size),
            license_category: previous_font.and_then(|font| font.license_category.clone()),
        });
        let files = font
            .files
            .as_object_mut()
            .ok_or_else(|| ApiError::internal("Invalid fonts index"))?;
        files.insert(variant, serde_json::Value::from(filename));
    }
    let index = StoredFontsIndex {
        fonts: merged.into_values().collect(),
    };
    write_font_index(&state, &index).await?;
    Ok(Json(index.fonts.iter().map(to_font_option).collect()))
}

pub(crate) async fn dafont_page(
    State(state): State<AppState>,
    Query(query): Query<DaFontPageQuery>,
) -> ApiResult<DaFontPageResponse> {
    Ok(Json(
        fetch_dafont_page_native(&state.http, query.page.unwrap_or(1)).await?,
    ))
}

pub(crate) async fn import_dafont(
    State(state): State<AppState>,
    Json(entry): Json<DaFontEntry>,
) -> ApiResult<Option<FontOption>> {
    assert_dafont_url(&entry.download_url)?;
    let response = state
        .http
        .get(absolute_dafont_url(&entry.download_url))
        .header("User-Agent", "OpenEPaperLink Codex/1.0")
        .send()
        .await
        .map_err(internal_error)?;
    if !response.status().is_success() {
        return Err(ApiError::bad_request(format!(
            "DaFont download failed with {}",
            response.status().as_u16()
        )));
    }
    let headers = response.headers().clone();
    let bytes = response.bytes().await.map_err(internal_error)?.to_vec();
    let content_disposition = headers
        .get("content-disposition")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let disposition_filename = Regex::new(r#"filename="?([^"]+)"?"#)
        .expect("valid content-disposition regex")
        .captures(&content_disposition)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string());
    let content_type = headers
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let is_zip = disposition_filename
        .as_deref()
        .map(|name| name.to_ascii_lowercase().ends_with(".zip"))
        .unwrap_or(false)
        || content_type.contains("application/zip")
        || bytes.starts_with(&[0x50, 0x4b, 0x03, 0x04]);

    let mut files = Vec::<(String, Vec<u8>, String, String, i32)>::new();
    if is_zip {
        let reader = std::io::Cursor::new(bytes);
        let mut archive =
            ZipArchive::new(reader).map_err(|error| ApiError::bad_request(error.to_string()))?;
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|error| ApiError::bad_request(error.to_string()))?;
            if file.name().ends_with('/') {
                continue;
            }
            let filename = Path::new(file.name())
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(file.name())
                .to_string();
            let extension = Path::new(&filename)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let rank = match extension.as_str() {
                "ttf" => 0,
                "otf" => 1,
                "woff2" => 2,
                "woff" => 3,
                _ => continue,
            };
            let mut buffer = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut buffer).map_err(internal_error)?;
            let (family_label, variant) = extract_font_names(&buffer, &filename);
            files.push((filename, buffer, family_label, variant, rank));
        }
    } else {
        let filename = disposition_filename.unwrap_or_else(|| format!("{}.bin", entry.name));
        let extension = Path::new(&filename)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let rank = match extension.as_str() {
            "ttf" => 0,
            "otf" => 1,
            "woff2" => 2,
            "woff" => 3,
            _ => 4,
        };
        let (family_label, variant) = extract_font_names(&bytes, &filename);
        files.push((filename, bytes, family_label, variant, rank));
    }
    if files.is_empty() {
        return Err(ApiError::bad_request(
            "No importable font files found in DaFont download",
        ));
    }
    let chosen_family = choose_best_family(&files, &entry.name);
    let chosen_variants = choose_best_variants(&chosen_family);
    let family_label = chosen_variants
        .first()
        .map(|file| file.2.clone())
        .unwrap_or_else(|| entry.name.clone());
    let family_id = slugify_font_id(&family_label);
    fs::create_dir_all(fonts_dir(&state.data_dir))
        .await
        .map_err(internal_error)?;
    let mut index = read_font_index(&state).await?;
    let existing = index.fonts.iter_mut().find(|font| font.id == family_id);
    let font = if let Some(existing) = existing {
        existing
    } else {
        index.fonts.push(StoredFontFamily {
            id: family_id.clone(),
            label: family_label.clone(),
            files: serde_json::json!({}),
            allowed_pixel_sizes: None,
            import_source: Some("dafont".into()),
            source_url: Some(entry.detail_url.clone()),
            preview_url: Some(entry.preview_url.clone()),
            declared_pixel_size: entry.pixel_size.map(|value| value as i32),
            license_category: entry.license_category.clone(),
        });
        index.fonts.last_mut().expect("font inserted")
    };
    font.label = family_label.clone();
    font.allowed_pixel_sizes = build_allowed_sizes(entry.pixel_size);
    font.import_source = Some("dafont".into());
    font.source_url = Some(entry.detail_url.clone());
    font.preview_url = Some(entry.preview_url.clone());
    font.declared_pixel_size = entry.pixel_size.map(|value| value as i32);
    font.license_category = entry.license_category.clone();
    for (filename, bytes, _label, variant, _rank) in chosen_variants {
        let extension = Path::new(&filename)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("ttf");
        let stored_filename = format!("{family_id}-{variant}.{extension}");
        fs::write(fonts_dir(&state.data_dir).join(&stored_filename), bytes)
            .await
            .map_err(internal_error)?;
        let files = font
            .files
            .as_object_mut()
            .ok_or_else(|| ApiError::internal("Invalid fonts index"))?;
        files.insert(variant, serde_json::Value::from(stored_filename));
    }
    write_font_index(&state, &index).await?;
    let refreshed = list_font_options(&state).await?;
    Ok(Json(
        refreshed
            .into_iter()
            .find(|option| option.id == family_id),
    ))
}
