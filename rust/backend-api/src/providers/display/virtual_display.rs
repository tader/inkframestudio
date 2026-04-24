use async_trait::async_trait;
use serde_json::json;

use crate::providers::registry::{DisplayProvider, ProviderDescriptor, ProviderDomain, ProviderInstance};
use crate::{app::AppState, ApiError, DiscoveredDisplayCandidate, UploadPreviewRequest, UploadPreviewResponse};

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

    async fn test_connection(&self, _state: &AppState, _instance: &ProviderInstance) -> Result<serde_json::Value, ApiError> {
        Ok(json!({
            "ok": true,
            "message": "Virtual provider ready"
        }))
    }

    async fn discover(
        &self,
        _state: &AppState,
        _instance: &ProviderInstance,
    ) -> Result<Vec<DiscoveredDisplayCandidate>, ApiError> {
        Ok(Vec::new())
    }

    async fn upload_preview(
        &self,
        _state: &AppState,
        _instance: &ProviderInstance,
        _payload: UploadPreviewRequest,
    ) -> Result<UploadPreviewResponse, ApiError> {
        Err(ApiError::bad_request("Provider does not support preview upload"))
    }

    fn supports_scheduling(&self) -> bool {
        false
    }
}
