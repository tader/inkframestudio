use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    display::{openepaperlink_ap, virtual_display},
    source::{home_assistant, open_meteo},
};
use crate::{
    app::AppState, ApiError, DiscoveredDisplayCandidate, EntityCatalogEntry, PlaceSearchEntry,
    UploadPreviewRequest, UploadPreviewResponse,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderDomain {
    Source,
    Display,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderFieldKind {
    Text,
    Password,
    Checkbox,
    Select,
    Textarea,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFieldOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFieldDescriptor {
    pub key: String,
    pub label: String,
    pub kind: ProviderFieldKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub secret: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<ProviderFieldOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub label: String,
    pub domain: ProviderDomain,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub config_fields: Vec<ProviderFieldDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInstance {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub enabled: bool,
    #[serde(default)]
    pub config: Value,
}

#[async_trait]
pub(crate) trait SourceProvider: Sync + Send {
    fn descriptor(&self) -> ProviderDescriptor;
    fn is_configured(&self, instance: &ProviderInstance) -> bool;
    async fn test_connection(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Value, ApiError>;
    async fn entity_catalog(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<EntityCatalogEntry>, ApiError>;
    async fn live_entities(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<serde_json::Map<String, Value>, ApiError>;
    async fn resolve_meta_queries(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
        project: &Value,
        scope: &Value,
    ) -> Result<(serde_json::Map<String, Value>, Vec<String>), ApiError>;
    async fn search_places(
        &self,
        _state: &AppState,
        _instance: &ProviderInstance,
        _query: &str,
    ) -> Result<Vec<PlaceSearchEntry>, ApiError> {
        Ok(Vec::new())
    }
}

#[async_trait]
pub(crate) trait DisplayProvider: Sync + Send {
    fn descriptor(&self) -> ProviderDescriptor;
    fn is_configured(&self, instance: &ProviderInstance) -> bool;
    async fn test_connection(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Value, ApiError>;
    async fn discover(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<DiscoveredDisplayCandidate>, ApiError>;
    async fn upload_preview(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
        payload: UploadPreviewRequest,
    ) -> Result<UploadPreviewResponse, ApiError>;
    fn supports_scheduling(&self) -> bool;
}

pub fn built_in_provider_descriptors() -> Vec<ProviderDescriptor> {
    vec![
        home_assistant::PROVIDER.descriptor(),
        open_meteo::PROVIDER.descriptor(),
        openepaperlink_ap::PROVIDER.descriptor(),
        virtual_display::PROVIDER.descriptor(),
    ]
}

pub fn default_provider_instances() -> Vec<ProviderInstance> {
    vec![
        home_assistant::default_instance(),
        openepaperlink_ap::default_instance(),
    ]
}

pub(crate) fn source_provider(id: &str) -> Option<&'static dyn SourceProvider> {
    match id {
        "home-assistant" => Some(&home_assistant::PROVIDER),
        "open-meteo" => Some(&open_meteo::PROVIDER),
        _ => None,
    }
}

pub(crate) fn display_provider(id: &str) -> Option<&'static dyn DisplayProvider> {
    match id {
        "openepaperlink-ap" => Some(&openepaperlink_ap::PROVIDER),
        "virtual" => Some(&virtual_display::PROVIDER),
        _ => None,
    }
}
