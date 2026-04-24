use serde_json::{json, Value};
use tokio::fs;

use crate::{
    app::AppState, built_in_provider_descriptors, default_provider_instances, internal_error,
    ApiError, ProviderDomain, ProviderInstance, ProviderInstancesDocument, StoredSettings,
};

use super::{settings_file_path, write_json_file};

pub(crate) async fn read_settings(state: &AppState) -> Result<StoredSettings, ApiError> {
    if let Some(parent) = settings_file_path(&state.data_dir).parent() {
        fs::create_dir_all(parent).await.map_err(internal_error)?;
    }
    match fs::read_to_string(settings_file_path(&state.data_dir)).await {
        Ok(content) => {
            let mut settings: StoredSettings =
                serde_json::from_str(&content).map_err(|error| ApiError::internal(error.to_string()))?;
            if settings.provider_instances.is_none() {
                settings.provider_instances = Some(migrate_provider_instances(&settings));
            }
            Ok(settings)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(StoredSettings {
            provider_instances: Some(ProviderInstancesDocument {
                source_providers: default_provider_instances()
                    .into_iter()
                    .filter(|instance| instance.provider_id == "home-assistant")
                    .collect(),
                display_providers: default_provider_instances()
                    .into_iter()
                    .filter(|instance| instance.provider_id != "home-assistant")
                    .collect(),
            }),
            home_assistant: None,
            openepaperlink_access_point: None,
        }),
        Err(error) => Err(internal_error(error)),
    }
}

pub(crate) async fn write_settings(state: &AppState, settings: &StoredSettings) -> Result<(), ApiError> {
    let value = serde_json::to_value(settings).map_err(|error| ApiError::internal(error.to_string()))?;
    write_json_file(&settings_file_path(&state.data_dir), &value).await
}

fn migrate_provider_instances(settings: &StoredSettings) -> ProviderInstancesDocument {
    let defaults = default_provider_instances();
    let mut source_providers = defaults
        .iter()
        .filter(|instance| instance.provider_id == "home-assistant")
        .cloned()
        .collect::<Vec<_>>();
    let mut display_providers = defaults
        .iter()
        .filter(|instance| instance.provider_id != "home-assistant")
        .cloned()
        .collect::<Vec<_>>();
    if let Some(home_assistant) = &settings.home_assistant {
        if let Some(instance) = source_providers
            .iter_mut()
            .find(|instance| instance.provider_id == "home-assistant")
        {
            instance.config = json!({
                "host": home_assistant.host,
                "token": home_assistant.token,
                "mode": home_assistant.mode,
                "useSupervisorProxy": home_assistant.use_supervisor_proxy,
                "allowInsecureTls": home_assistant.allow_insecure_tls
            });
        }
    }
    if let Some(access_point) = &settings.openepaperlink_access_point {
        if let Some(instance) = display_providers
            .iter_mut()
            .find(|instance| instance.provider_id == "openepaperlink-ap")
        {
            instance.config = json!({
                "url": access_point.url,
                "defaultTestDisplayMac": access_point.default_test_display_mac.clone().unwrap_or_default()
            });
        }
    }
    if !display_providers.iter().any(|instance| instance.provider_id == "virtual") {
        display_providers.push(ProviderInstance {
            id: "virtual-default".into(),
            provider_id: "virtual".into(),
            name: "Virtual Display".into(),
            enabled: true,
            config: json!({}),
        });
    } else if let Some(instance) = display_providers
        .iter_mut()
        .find(|instance| instance.provider_id == "virtual")
    {
        instance.id = "virtual-default".into();
    }
    ProviderInstancesDocument {
        source_providers,
        display_providers,
    }
}

pub(crate) fn all_provider_instances(settings: &StoredSettings) -> Vec<ProviderInstance> {
    let migrated = settings
        .provider_instances
        .clone()
        .unwrap_or_else(|| migrate_provider_instances(settings));
    migrated
        .source_providers
        .into_iter()
        .chain(migrated.display_providers)
        .collect()
}

pub(crate) fn masked_provider_instance(instance: &ProviderInstance) -> ProviderInstance {
    let descriptor = built_in_provider_descriptors()
        .into_iter()
        .find(|descriptor| descriptor.id == instance.provider_id);
    let mut next = instance.clone();
    if let Some(descriptor) = descriptor {
        for field in descriptor.config_fields {
            if field.secret {
                if let Some(value) = next.config.get_mut(&field.key) {
                    if value.as_str().is_some_and(|current| !current.is_empty()) {
                        *value = Value::from("********");
                    }
                }
            }
        }
    }
    next
}

pub(crate) fn find_provider_instance(settings: &StoredSettings, instance_id: &str) -> Option<ProviderInstance> {
    all_provider_instances(settings)
        .into_iter()
        .find(|instance| instance.id == instance_id)
}

pub(crate) fn save_provider_instance_into_settings(settings: &mut StoredSettings, instance: ProviderInstance) {
    let mut document = settings
        .provider_instances
        .clone()
        .unwrap_or_else(|| migrate_provider_instances(settings));
    let target = match built_in_provider_descriptors()
        .into_iter()
        .find(|descriptor| descriptor.id == instance.provider_id)
        .map(|descriptor| descriptor.domain)
        .unwrap_or(ProviderDomain::Source)
    {
        ProviderDomain::Source => &mut document.source_providers,
        ProviderDomain::Display => &mut document.display_providers,
    };
    if let Some(existing) = target.iter_mut().find(|existing| existing.id == instance.id) {
        *existing = instance;
    } else {
        target.push(instance);
    }
    settings.provider_instances = Some(document);
}

pub(crate) fn delete_provider_instance_from_settings(settings: &mut StoredSettings, instance_id: &str) -> bool {
    let mut document = settings
        .provider_instances
        .clone()
        .unwrap_or_else(|| migrate_provider_instances(settings));
    let before = document.source_providers.len() + document.display_providers.len();
    document.source_providers.retain(|instance| instance.id != instance_id);
    document.display_providers.retain(|instance| instance.id != instance_id);
    let changed = before != document.source_providers.len() + document.display_providers.len();
    settings.provider_instances = Some(document);
    changed
}
