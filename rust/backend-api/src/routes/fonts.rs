use std::path::Path;

use axum::{
    extract::{Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use base64::Engine;
use tokio::fs;

use ttf_parser::name_id;

use crate::{
    app::AppState, detect_font_variant_from_name, font_files, fonts_dir, internal_error,
    list_font_options, read_font_index, slugify_font_id, to_font_option, write_font_index,
    ApiError, ApiResult, FontImportRequest, FontImportResponse, FontMetadataPatch, FontOption,
    StoredFontFamily, StoredFontsIndex,
};

pub(crate) async fn list_fonts(State(state): State<AppState>) -> ApiResult<Vec<FontOption>> {
    Ok(Json(list_font_options(&state).await?))
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
            if next.is_empty() {
                None
            } else {
                Some(next)
            }
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
    let extension = Path::new(filename)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "ttf" && extension != "otf" {
        return Err(ApiError::bad_request("Only .ttf and .otf fonts supported"));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.base64.as_bytes())
        .map_err(|error| ApiError::bad_request(format!("Invalid base64: {error}")))?;
    let face = ttf_parser::Face::parse(&bytes, 0)
        .map_err(|error| ApiError::bad_request(format!("Invalid TrueType font: {error:?}")))?;
    let (label, style_name) = font_names(&face, filename);
    let family_id = slugify_font_id(&label);
    let variant = detect_font_variant_from_name(&style_name);
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
        if ext != "ttf" && ext != "otf" {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let bytes = fs::read(&path).await.map_err(internal_error)?;
        if ttf_parser::Face::parse(&bytes, 0).is_err() {
            continue;
        }
        let face = ttf_parser::Face::parse(&bytes, 0).ok();
        let (label, style_name) = face
            .as_ref()
            .map(|face| font_names(face, &filename))
            .unwrap_or_else(|| (pretty_stem(&filename), filename.clone()));
        let family_id = slugify_font_id(&label);
        let variant = detect_font_variant_from_name(&style_name);
        let previous_font = previous_by_id.get(&family_id);
        let font = merged
            .entry(family_id.clone())
            .or_insert_with(|| StoredFontFamily {
                id: family_id.clone(),
                label: label.clone(),
                files: serde_json::json!({}),
                allowed_pixel_sizes: previous_font
                    .and_then(|font| font.allowed_pixel_sizes.clone()),
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
    Ok(Json(list_font_options(&state).await?))
}

fn pretty_stem(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(filename)
        .replace(['_', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn font_name(face: &ttf_parser::Face<'_>, ids: &[u16]) -> Option<String> {
    ids.iter().find_map(|id| {
        face.names()
            .into_iter()
            .filter(|name| name.name_id == *id)
            .filter_map(|name| name.to_string())
            .find(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_string())
    })
}

fn strip_style_suffix(value: &str) -> String {
    let mut words = value.split_whitespace().collect::<Vec<_>>();
    while let Some(last) = words.last().map(|word| word.to_ascii_lowercase()) {
        if matches!(
            last.as_str(),
            "regular"
                | "roman"
                | "italic"
                | "oblique"
                | "bold"
                | "black"
                | "heavy"
                | "thin"
                | "light"
                | "medium"
                | "semibold"
                | "demibold"
                | "extrabold"
                | "ultrabold"
                | "extralight"
                | "ultralight"
        ) {
            words.pop();
        } else {
            break;
        }
    }
    words.join(" ")
}

fn font_names(face: &ttf_parser::Face<'_>, filename: &str) -> (String, String) {
    let family = font_name(
        face,
        &[
            name_id::TYPOGRAPHIC_FAMILY,
            name_id::WWS_FAMILY,
            name_id::FAMILY,
        ],
    )
    .unwrap_or_else(|| pretty_stem(filename));
    let subfamily = font_name(
        face,
        &[
            name_id::TYPOGRAPHIC_SUBFAMILY,
            name_id::WWS_SUBFAMILY,
            name_id::SUBFAMILY,
        ],
    )
    .unwrap_or_else(|| filename.to_string());
    let label = strip_style_suffix(&pretty_stem(&family));
    let label = if label.is_empty() {
        pretty_stem(filename)
    } else {
        label
    };
    (label, subfamily)
}
