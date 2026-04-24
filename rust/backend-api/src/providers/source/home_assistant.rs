use async_trait::async_trait;
use serde_json::json;

use crate::providers::registry::{
    ProviderDescriptor, ProviderDomain, ProviderFieldDescriptor, ProviderFieldKind, ProviderFieldOption,
    ProviderInstance, SourceProvider,
};
use crate::{
    app::AppState, home_assistant_settings_from_instance, has_configured_home_assistant,
    normalize_home_assistant_mode, services::render_data::resolve_meta_queries,
    ApiError, EntityCatalogEntry, fetch_home_assistant_config, fetch_home_assistant_states,
};

pub static PROVIDER: HomeAssistantProvider = HomeAssistantProvider;

pub struct HomeAssistantProvider;

pub fn descriptor() -> ProviderDescriptor {
    ProviderDescriptor {
        id: "home-assistant".into(),
        label: "Home Assistant".into(),
        domain: ProviderDomain::Source,
        capabilities: vec![
            "test_connection".into(),
            "entity_catalog".into(),
            "resolve_render_data".into(),
            "meta_calendar_events".into(),
        ],
        config_fields: vec![
            ProviderFieldDescriptor {
                key: "mode".into(),
                label: "Mode".into(),
                kind: ProviderFieldKind::Select,
                required: true,
                secret: false,
                placeholder: None,
                help: None,
                default_value: Some(json!(normalize_home_assistant_mode(Some("custom")))),
                options: vec![
                    ProviderFieldOption { value: "custom".into(), label: "Custom host".into() },
                    ProviderFieldOption { value: "supervisor".into(), label: "Use local HA".into() },
                ],
            },
            ProviderFieldDescriptor {
                key: "host".into(),
                label: "Host".into(),
                kind: ProviderFieldKind::Text,
                required: false,
                secret: false,
                placeholder: Some("http://homeassistant.local:8123".into()),
                help: None,
                default_value: Some(json!("")),
                options: Vec::new(),
            },
            ProviderFieldDescriptor {
                key: "useSupervisorProxy".into(),
                label: "Use Supervisor proxy".into(),
                kind: ProviderFieldKind::Checkbox,
                required: false,
                secret: false,
                placeholder: None,
                help: None,
                default_value: Some(json!(false)),
                options: Vec::new(),
            },
            ProviderFieldDescriptor {
                key: "allowInsecureTls".into(),
                label: "Allow insecure TLS".into(),
                kind: ProviderFieldKind::Checkbox,
                required: false,
                secret: false,
                placeholder: None,
                help: Some("Self-signed certs".into()),
                default_value: Some(json!(false)),
                options: Vec::new(),
            },
            ProviderFieldDescriptor {
                key: "token".into(),
                label: "Token".into(),
                kind: ProviderFieldKind::Password,
                required: false,
                secret: true,
                placeholder: None,
                help: None,
                default_value: Some(json!("")),
                options: Vec::new(),
            },
        ],
    }
}

pub fn default_instance() -> ProviderInstance {
    ProviderInstance {
        id: "home-assistant-default".into(),
        provider_id: "home-assistant".into(),
        name: "Home Assistant".into(),
        enabled: true,
        config: json!({
            "host": "",
            "token": "",
            "mode": "custom",
            "useSupervisorProxy": false,
            "allowInsecureTls": false
        }),
    }
}

#[async_trait]
impl SourceProvider for HomeAssistantProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        descriptor()
    }

    fn is_configured(&self, instance: &ProviderInstance) -> bool {
        let settings = home_assistant_settings_from_instance(instance);
        has_configured_home_assistant(&settings)
    }

    async fn test_connection(&self, state: &AppState, instance: &ProviderInstance) -> Result<serde_json::Value, ApiError> {
        let resolved = home_assistant_settings_from_instance(instance);
        let value = match fetch_home_assistant_config(&state.http, &resolved).await {
            Ok(config) => json!({
                "ok": true,
                "message": "Connected to Home Assistant",
                "details": {
                    "mode": resolved.mode,
                    "serverVersion": config.version
                }
            }),
            Err(error) => json!({
                "ok": false,
                "message": error.message,
                "networkError": error.status.is_none(),
                "details": {
                    "mode": resolved.mode,
                    "authError": matches!(error.status, Some(reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN))
                }
            }),
        };
        Ok(value)
    }

    async fn entity_catalog(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<EntityCatalogEntry>, ApiError> {
        let provider_settings = home_assistant_settings_from_instance(instance);
        if !has_configured_home_assistant(&provider_settings) {
            return Ok(Vec::new());
        }
        Ok(fetch_home_assistant_states(&state.http, &provider_settings)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|entry| EntityCatalogEntry {
                friendly_name: entry
                    .attributes
                    .get("friendly_name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&entry.entity_id)
                    .to_string(),
                domain: entry
                    .entity_id
                    .split('.')
                    .next()
                    .unwrap_or_default()
                    .to_string(),
                unit: entry
                    .attributes
                    .get("unit_of_measurement")
                    .and_then(serde_json::Value::as_str)
                    .map(ToString::to_string),
                entity_id: entry.entity_id,
            })
            .collect::<Vec<_>>())
    }

    async fn live_entities(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<serde_json::Map<String, serde_json::Value>, ApiError> {
        let settings = home_assistant_settings_from_instance(instance);
        let mut entities = serde_json::Map::new();
        for value in fetch_home_assistant_states(&state.http, &settings).await.map_err(|error| ApiError::bad_request(error.message))? {
            entities.insert(
                value.entity_id.clone(),
                json!({
                    "entityId": value.entity_id,
                    "state": value.state,
                    "attributes": value.attributes,
                    "lastChanged": value.last_changed
                }),
            );
        }
        Ok(entities)
    }

    async fn resolve_meta_queries(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
        project: &serde_json::Value,
    ) -> Result<(serde_json::Map<String, serde_json::Value>, Vec<String>), ApiError> {
        Ok(resolve_meta_queries(&state.http, &home_assistant_settings_from_instance(instance), project).await)
    }
}
