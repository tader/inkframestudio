use async_trait::async_trait;
use serde_json::{json, Value};

use crate::providers::registry::{
    DisplayProvider, ProviderDescriptor, ProviderDomain, ProviderInstance,
};
use crate::{
    app::AppState, ApiError, DiscoveredDisplayCandidate, UploadPreviewRequest,
    UploadPreviewResponse,
};

pub static PROVIDER: VirtualDisplayProvider = VirtualDisplayProvider;

pub struct VirtualDisplayProvider;

pub fn descriptor() -> ProviderDescriptor {
    ProviderDescriptor {
        id: "virtual".into(),
        label: "Virtual Display".into(),
        domain: ProviderDomain::Display,
        capabilities: vec!["virtual".into()],
        config_fields: Vec::new(),
    }
}

#[async_trait]
impl DisplayProvider for VirtualDisplayProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        descriptor()
    }

    fn is_configured(&self, _instance: &ProviderInstance) -> bool {
        true
    }

    async fn test_connection(
        &self,
        _state: &AppState,
        _instance: &ProviderInstance,
    ) -> Result<serde_json::Value, ApiError> {
        Ok(json!({
            "ok": true,
            "message": "Virtual provider ready"
        }))
    }

    async fn discover(
        &self,
        _state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<DiscoveredDisplayCandidate>, ApiError> {
        Ok(instance
            .config
            .get("virtualDisplays")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .enumerate()
                    .filter_map(|(index, entry)| {
                        let id = entry
                            .get("id")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("virtual-{}", index + 1));
                        let name = entry
                            .get("name")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("Virtual Display {}", index + 1));
                        let display_type_id = entry
                            .get("displayTypeId")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string)?;
                        Some(DiscoveredDisplayCandidate {
                            id: format!("{}:{id}", instance.id),
                            name,
                            provider_id: "virtual".into(),
                            provider_instance_id: instance.id.clone(),
                            provider_device_ref: id.clone(),
                            provider_kind: "virtual".into(),
                            provider_ref: id.clone(),
                            suggested_display_type_id: Some(display_type_id),
                            suggested_display_type: None,
                            discovery_source: "virtual".into(),
                            metadata: json!({ "virtual": true }),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default())
    }

    async fn upload_preview(
        &self,
        _state: &AppState,
        _instance: &ProviderInstance,
        _payload: UploadPreviewRequest,
    ) -> Result<UploadPreviewResponse, ApiError> {
        Err(ApiError::bad_request(
            "Provider does not support preview upload",
        ))
    }

    fn supports_scheduling(&self) -> bool {
        false
    }
}
