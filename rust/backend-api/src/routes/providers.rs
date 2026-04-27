use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Path as AxumPath, Query, State},
    Json,
};
use reqwest::StatusCode;
use serde_json::{json, Value};

use crate::*;

pub(crate) async fn discover_displays(
    State(state): State<AppState>,
    AxumPath(_project_id): AxumPath<String>,
    Query(query): Query<DiscoverDisplaysQuery>,
) -> ApiResult<Vec<DiscoveredDisplayCandidate>> {
    let settings = read_settings(&state).await?;
    let instances = if let Some(instance_id) = query.provider_instance_id.as_deref() {
        find_provider_instance(&settings, instance_id)
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        all_provider_instances(&settings)
            .into_iter()
            .filter(|instance| {
                instance.enabled && display_provider(&instance.provider_id).is_some()
            })
            .collect::<Vec<_>>()
    };
    let mut discovered = Vec::new();
    for instance in instances {
        let Some(provider) = display_provider(&instance.provider_id) else {
            continue;
        };
        if !provider.is_configured(&instance) {
            continue;
        }
        discovered.extend(provider.discover(&state, &instance).await?);
    }
    Ok(Json(discovered))
}

pub(crate) async fn list_provider_kinds() -> ApiResult<ProviderKindsResponse> {
    Ok(Json(ProviderKindsResponse {
        provider_kinds: built_in_provider_descriptors(),
    }))
}

pub(crate) async fn list_provider_instances(
    State(state): State<AppState>,
) -> ApiResult<Vec<ProviderInstance>> {
    let settings = read_settings(&state).await?;
    Ok(Json(
        all_provider_instances(&settings)
            .into_iter()
            .map(|instance| masked_provider_instance(&instance))
            .collect(),
    ))
}

pub(crate) async fn create_provider_instance(
    State(state): State<AppState>,
    Json(input): Json<ProviderInstanceInput>,
) -> ApiResult<ProviderInstance> {
    let mut settings = read_settings(&state).await?;
    let instance = ProviderInstance {
        id: input.id.unwrap_or_else(|| {
            format!(
                "{}-{}",
                input.provider_id,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
            )
        }),
        provider_id: input.provider_id,
        name: input.name,
        enabled: input.enabled,
        config: input.config,
    };
    save_provider_instance_into_settings(&mut settings, instance.clone());
    write_settings(&state, &settings).await?;
    Ok(Json(masked_provider_instance(&instance)))
}

pub(crate) async fn update_provider_instance(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
    Json(input): Json<ProviderInstanceInput>,
) -> ApiResult<ProviderInstance> {
    let mut settings = read_settings(&state).await?;
    let instance = ProviderInstance {
        id: instance_id,
        provider_id: input.provider_id,
        name: input.name,
        enabled: input.enabled,
        config: input.config,
    };
    save_provider_instance_into_settings(&mut settings, instance.clone());
    write_settings(&state, &settings).await?;
    Ok(Json(masked_provider_instance(&instance)))
}

pub(crate) async fn delete_provider_instance(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
) -> Result<StatusCode, ApiError> {
    let mut settings = read_settings(&state).await?;
    if !delete_provider_instance_from_settings(&mut settings, &instance_id) {
        return Err(ApiError::not_found(format!(
            "Unknown provider instance {instance_id}"
        )));
    }
    write_settings(&state, &settings).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn test_provider_instance(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
) -> ApiResult<Value> {
    let settings = read_settings(&state).await?;
    let instance = find_provider_instance(&settings, &instance_id)
        .ok_or_else(|| ApiError::not_found(format!("Unknown provider instance {instance_id}")))?;
    if let Some(provider) = source_provider(&instance.provider_id) {
        return Ok(Json(provider.test_connection(&state, &instance).await?));
    }
    if let Some(provider) = display_provider(&instance.provider_id) {
        return Ok(Json(provider.test_connection(&state, &instance).await?));
    }
    Ok(Json(json!({
        "ok": false,
        "message": format!("Unsupported provider {}", instance.provider_id)
    })))
}

pub(crate) async fn provider_entities(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
) -> ApiResult<Vec<EntityCatalogEntry>> {
    let settings = read_settings(&state).await?;
    let instance = find_provider_instance(&settings, &instance_id)
        .ok_or_else(|| ApiError::not_found(format!("Unknown provider instance {instance_id}")))?;
    let Some(provider) = source_provider(&instance.provider_id) else {
        return Ok(Json(Vec::new()));
    };
    if !provider.is_configured(&instance) {
        return Ok(Json(Vec::new()));
    }
    Ok(Json(provider.entity_catalog(&state, &instance).await?))
}

pub(crate) async fn provider_places(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
    Query(query): Query<ProviderPlacesQuery>,
) -> ApiResult<Vec<PlaceSearchEntry>> {
    let settings = read_settings(&state).await?;
    let instance = find_provider_instance(&settings, &instance_id)
        .ok_or_else(|| ApiError::not_found(format!("Unknown provider instance {instance_id}")))?;
    let Some(provider) = source_provider(&instance.provider_id) else {
        return Ok(Json(Vec::new()));
    };
    if !provider.is_configured(&instance) {
        return Ok(Json(Vec::new()));
    }
    Ok(Json(
        provider
            .search_places(&state, &instance, query.q.as_deref().unwrap_or_default())
            .await?,
    ))
}

pub(crate) async fn upload_preview_to_provider(
    State(state): State<AppState>,
    AxumPath(instance_id): AxumPath<String>,
    Json(payload): Json<UploadPreviewRequest>,
) -> ApiResult<UploadPreviewResponse> {
    let settings = read_settings(&state).await?;
    let instance = find_provider_instance(&settings, &instance_id)
        .ok_or_else(|| ApiError::not_found(format!("Unknown provider instance {instance_id}")))?;
    let Some(provider) = display_provider(&instance.provider_id) else {
        return Err(ApiError::bad_request(
            "Provider does not support preview upload",
        ));
    };
    Ok(Json(
        provider.upload_preview(&state, &instance, payload).await?,
    ))
}
