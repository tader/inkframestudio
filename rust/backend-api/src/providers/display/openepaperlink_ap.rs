use async_trait::async_trait;
use serde_json::json;

use crate::providers::registry::{
    DisplayProvider, ProviderDescriptor, ProviderDomain, ProviderFieldDescriptor,
    ProviderFieldKind, ProviderInstance,
};
use crate::{
    app::AppState, build_discovered_display_type, fetch_access_point_page,
    fetch_access_point_tag_type, fetch_all_access_point_tags, openepaperlink_settings_from_instance,
    rgba_to_jpeg, upload_image_to_access_point, ApiError, DiscoveredDisplayCandidate,
    UploadPreviewRequest, UploadPreviewResponse,
};

pub static PROVIDER: OpenEpaperLinkApProvider = OpenEpaperLinkApProvider;

pub struct OpenEpaperLinkApProvider;

pub fn descriptor() -> ProviderDescriptor {
    ProviderDescriptor {
        id: "openepaperlink-ap".into(),
        label: "OpenEPaperLink Access Point".into(),
        domain: ProviderDomain::Display,
        capabilities: vec![
            "test_connection".into(),
            "discover_displays".into(),
            "upload_preview".into(),
            "upload_rendered_display".into(),
            "schedule_updates".into(),
        ],
        config_fields: vec![
            ProviderFieldDescriptor {
                key: "url".into(),
                label: "URL".into(),
                kind: ProviderFieldKind::Text,
                required: true,
                secret: false,
                placeholder: Some("http://192.168.1.170".into()),
                help: None,
                default_value: Some(json!("")),
                options: Vec::new(),
            },
            ProviderFieldDescriptor {
                key: "defaultTestDisplayMac".into(),
                label: "Default test display".into(),
                kind: ProviderFieldKind::Text,
                required: false,
                secret: false,
                placeholder: Some("AA:BB:CC:DD:EE:FF".into()),
                help: None,
                default_value: Some(json!("")),
                options: Vec::new(),
            },
        ],
    }
}

pub fn default_instance() -> ProviderInstance {
    ProviderInstance {
        id: "openepaperlink-ap-default".into(),
        provider_id: "openepaperlink-ap".into(),
        name: "OpenEPaperLink Access Point".into(),
        enabled: true,
        config: json!({
            "url": "",
            "defaultTestDisplayMac": ""
        }),
    }
}

#[async_trait]
impl DisplayProvider for OpenEpaperLinkApProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        descriptor()
    }

    fn is_configured(&self, instance: &ProviderInstance) -> bool {
        !openepaperlink_settings_from_instance(instance).url.trim().is_empty()
    }

    async fn test_connection(&self, state: &AppState, instance: &ProviderInstance) -> Result<serde_json::Value, ApiError> {
        let resolved = openepaperlink_settings_from_instance(instance);
        let value = match fetch_access_point_page(&state.http, &resolved, 0).await {
            Ok(page) => json!({
                "ok": true,
                "message": "Connected to OpenEPaperLink access point",
                "details": { "tagCount": page.tags.unwrap_or_default().len() }
            }),
            Err(error) => json!({
                "ok": false,
                "message": error.message,
                "networkError": true
            }),
        };
        Ok(value)
    }

    async fn discover(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<DiscoveredDisplayCandidate>, ApiError> {
        let provider_settings = openepaperlink_settings_from_instance(instance);
        if provider_settings.url.trim().is_empty() {
            return Ok(Vec::new());
        }
        let tags = fetch_all_access_point_tags(&state.http, &provider_settings).await?;
        let mut discovered = Vec::new();
        for tag in tags {
            let hw_type = tag.hw_type.unwrap_or(0);
            let tag_type = fetch_access_point_tag_type(&state.http, &provider_settings, hw_type)
                .await
                .ok()
                .flatten();
            let suggested_display_type = tag_type
                .as_ref()
                .and_then(|entry| build_discovered_display_type(entry, hw_type));
            discovered.push(DiscoveredDisplayCandidate {
                id: format!("ap:{}", tag.mac),
                name: tag
                    .alias
                    .clone()
                    .or_else(|| tag_type.as_ref().and_then(|entry| entry.name.clone()))
                    .unwrap_or_else(|| tag.mac.clone()),
                provider_id: instance.provider_id.clone(),
                provider_instance_id: instance.id.clone(),
                provider_device_ref: tag.mac.clone(),
                provider_kind: "openepaperlink-ap".into(),
                provider_ref: tag.mac.clone(),
                suggested_display_type_id: suggested_display_type.as_ref().map(|entry| entry.id.clone()),
                suggested_display_type,
                discovery_source: "access-point".into(),
                metadata: json!({
                    "mac": tag.mac,
                    "hwType": hw_type,
                    "tagTypeName": tag_type.as_ref().and_then(|entry| entry.name.clone()),
                    "contentMode": tag.content_mode,
                    "capabilities": tag.capabilities,
                    "rotate": tag.rotate,
                    "invert": tag.invert,
                    "lut": tag.lut,
                    "isexternal": tag.isexternal,
                    "apip": tag.apip,
                    "batteryMv": tag.battery_mv,
                    "temperature": tag.temperature,
                    "lastseen": tag.lastseen,
                    "nextcheckin": tag.nextcheckin
                }),
            });
        }
        Ok(discovered)
    }

    async fn upload_preview(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
        payload: UploadPreviewRequest,
    ) -> Result<UploadPreviewResponse, ApiError> {
        let resolved = openepaperlink_settings_from_instance(instance);
        if resolved.url.trim().is_empty() {
            return Err(ApiError::bad_request("Provider URL is not configured"));
        }
        let _ = payload.dither;
        let expected = payload.width as usize * payload.height as usize * 4;
        if payload.mac.trim().is_empty()
            || payload.width == 0
            || payload.height == 0
            || payload.rgba.len() != expected
        {
            return Err(ApiError::bad_request("Invalid preview payload"));
        }
        let jpeg = rgba_to_jpeg(&payload.rgba, payload.width, payload.height)?;
        upload_image_to_access_point(
            &state.http,
            &resolved,
            &payload.mac,
            jpeg,
            format!("{}.jpg", payload.mac),
        )
        .await?;
        Ok(UploadPreviewResponse {
            uploaded: true,
            mac: payload.mac,
            width: payload.width,
            height: payload.height,
        })
    }

    fn supports_scheduling(&self) -> bool {
        true
    }
}
