pub mod app;
pub mod error;
mod native_font_specimens;
mod native_layout_preview;
mod native_theme_preview;
pub mod providers;
pub mod routes;
pub mod services;
pub mod storage;

use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use app::AppState;
use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
    Router,
};
use base64::Engine;
use error::{ApiError, ApiResult};
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{ColorType, ImageEncoder};
use providers::{
    built_in_provider_descriptors, default_provider_instances, display_provider, source_provider,
    ProviderDescriptor, ProviderDomain, ProviderInstance,
};
use reqwest::header::{ACCEPT, AUTHORIZATION};
use reqwest::multipart::{Form, Part};
use routes::backup::{export_backup, restore_backup};
use routes::fonts::{delete_font, import_font, list_fonts, rescan_fonts, update_font_metadata};
use routes::previews::{device_preview, font_specimens, layout_preview, live_data, theme_preview};
use routes::projects::{get_project, list_projects, save_project};
use routes::providers::{
    create_provider_instance, delete_provider_instance, discover_displays, list_provider_instances,
    list_provider_kinds, provider_entities, test_provider_instance, update_provider_instance,
    upload_preview_to_provider,
};
use routes::publish::{
    force_assignment_update, get_schedule_update_log_settings, list_assignment_schedules,
    list_display_update_log, publish_project, save_schedule_update_log_settings,
    upload_device_image,
};
use routes::system::{__path_healthz, __path_list_display_profiles, __path_list_icons};
use routes::system::{healthz, list_display_profiles, list_icons};
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use services::scheduler::spawn_assignment_scheduler;
use storage::{
    all_provider_instances, delete_provider_instance_from_settings, ensure_seeded,
    find_provider_instance, font_index_file_path, fonts_dir, masked_provider_instance,
    project_file_path, projects_dir, read_json_file, read_settings,
    save_provider_instance_into_settings, update_log_file_path, write_json_file, write_settings,
};
use tokio::fs;
use tower_http::trace::TraceLayer;
use tracing::info;
use utoipa::OpenApi;

const FONT_AWESOME_ICONS_JSON: &str = include_str!("../assets/font-awesome-icons.json");
const SEEDED_PROJECT_JSON: &str = include_str!("seed/demo-home.json");

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct IconDefinition {
    id: String,
    label: String,
    pack: String,
    keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
struct EdgeInsets {
    top: i32,
    right: i32,
    bottom: i32,
    left: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct DisplayProfile {
    id: String,
    width: i32,
    height: i32,
    rotation: i32,
    palette: Palette,
    #[serde(rename = "contentPadding")]
    content_padding: EdgeInsets,
    #[serde(rename = "gridUnitPx")]
    grid_unit_px: i32,
    #[serde(rename = "recommendedFontScale")]
    recommended_font_scale: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
struct Palette {
    bg: String,
    fg: String,
    accent: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub(crate) struct HealthResponse {
    ok: bool,
    service: &'static str,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct ProjectSummary {
    id: String,
    name: String,
    version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
struct HomeAssistantSettingsResponse {
    host: String,
    token: String,
    #[serde(rename = "hasToken")]
    has_token: bool,
    mode: String,
    #[serde(rename = "useSupervisorProxy")]
    use_supervisor_proxy: bool,
    #[serde(rename = "allowInsecureTls")]
    allow_insecure_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
struct HomeAssistantConnectionStatus {
    ok: bool,
    mode: String,
    message: String,
    #[serde(rename = "serverVersion", skip_serializing_if = "Option::is_none")]
    server_version: Option<String>,
    #[serde(rename = "authError", skip_serializing_if = "Option::is_none")]
    auth_error: Option<bool>,
    #[serde(rename = "networkError", skip_serializing_if = "Option::is_none")]
    network_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct OpenEpaperLinkAccessPointSettings {
    url: String,
    #[serde(
        rename = "defaultTestDisplayMac",
        skip_serializing_if = "Option::is_none"
    )]
    default_test_display_mac: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
struct OpenEpaperLinkAccessPointStatus {
    ok: bool,
    message: String,
    #[serde(rename = "tagCount", skip_serializing_if = "Option::is_none")]
    tag_count: Option<usize>,
    #[serde(rename = "networkError", skip_serializing_if = "Option::is_none")]
    network_error: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct FontOption {
    id: String,
    label: String,
    source: String,
    variants: Vec<String>,
    #[serde(rename = "allowedPixelSizes", skip_serializing_if = "Option::is_none")]
    allowed_pixel_sizes: Option<Vec<i32>>,
    #[serde(rename = "importSource", skip_serializing_if = "Option::is_none")]
    import_source: Option<String>,
    #[serde(rename = "sourceUrl", skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    #[serde(rename = "previewUrl", skip_serializing_if = "Option::is_none")]
    preview_url: Option<String>,
    #[serde(rename = "declaredPixelSize", skip_serializing_if = "Option::is_none")]
    declared_pixel_size: Option<i32>,
    #[serde(rename = "licenseCategory", skip_serializing_if = "Option::is_none")]
    license_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredFontFamily {
    id: String,
    label: String,
    files: Value,
    #[serde(rename = "allowedPixelSizes", skip_serializing_if = "Option::is_none")]
    allowed_pixel_sizes: Option<Vec<i32>>,
    #[serde(rename = "importSource", skip_serializing_if = "Option::is_none")]
    import_source: Option<String>,
    #[serde(rename = "sourceUrl", skip_serializing_if = "Option::is_none")]
    source_url: Option<String>,
    #[serde(rename = "previewUrl", skip_serializing_if = "Option::is_none")]
    preview_url: Option<String>,
    #[serde(rename = "declaredPixelSize", skip_serializing_if = "Option::is_none")]
    declared_pixel_size: Option<i32>,
    #[serde(rename = "licenseCategory", skip_serializing_if = "Option::is_none")]
    license_category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredFontsIndex {
    fonts: Vec<StoredFontFamily>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FontMetadataPatch {
    #[serde(rename = "allowedPixelSizes")]
    allowed_pixel_sizes: Option<Vec<i32>>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FontImportRequest {
    filename: String,
    base64: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct FontImportResponse {
    id: String,
    label: String,
    variant: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UploadPreviewRequest {
    mac: String,
    width: u32,
    height: u32,
    #[serde(rename = "pngBase64", default)]
    png_base64: Option<String>,
    #[serde(default)]
    rgba: Vec<u8>,
    dither: Option<u8>,
}

#[derive(Debug, Serialize)]
pub(crate) struct UploadPreviewResponse {
    uploaded: bool,
    mac: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct SchedulerState {
    #[serde(skip_serializing_if = "Option::is_none")]
    config_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_run_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_run_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_completed_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_hash: Option<String>,
    #[serde(default)]
    running: bool,
}

#[derive(Debug, Serialize)]
struct AssignmentScheduleStatusResponse {
    #[serde(rename = "assignmentId")]
    assignment_id: String,
    #[serde(rename = "displayId")]
    display_id: String,
    enabled: bool,
    #[serde(rename = "intervalMinutes")]
    interval_minutes: u64,
    schedulable: bool,
    running: bool,
    #[serde(rename = "nextRunAt", skip_serializing_if = "Option::is_none")]
    next_run_at: Option<String>,
    #[serde(rename = "lastRunAt", skip_serializing_if = "Option::is_none")]
    last_run_at: Option<String>,
    #[serde(rename = "lastCompletedAt", skip_serializing_if = "Option::is_none")]
    last_completed_at: Option<String>,
    #[serde(rename = "lastResult", skip_serializing_if = "Option::is_none")]
    last_result: Option<String>,
    #[serde(rename = "lastError", skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
    #[serde(rename = "lastHash", skip_serializing_if = "Option::is_none")]
    last_hash: Option<String>,
}

#[derive(Debug, Serialize)]
struct AssignmentForceUpdateResponse {
    #[serde(rename = "assignmentId")]
    assignment_id: String,
    #[serde(rename = "displayId")]
    display_id: String,
    updated: bool,
    skipped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    hash: Option<String>,
    #[serde(rename = "activeScreenId", skip_serializing_if = "Option::is_none")]
    active_screen_id: Option<String>,
    #[serde(rename = "activeOverlayId", skip_serializing_if = "Option::is_none")]
    active_overlay_id: Option<String>,
    message: String,
}

#[derive(Debug, Clone)]
struct AssignmentConfig {
    assignment_id: String,
    display_id: String,
    enabled: bool,
    interval_minutes: u64,
    schedulable: bool,
    provider_instance_id: String,
    provider_device_ref: String,
    mac: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct EntityCatalogEntry {
    #[serde(rename = "entityId")]
    entity_id: String,
    #[serde(rename = "friendlyName")]
    friendly_name: String,
    domain: String,
    unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct DiscoveredDisplayCandidate {
    id: String,
    name: String,
    #[serde(rename = "providerId")]
    provider_id: String,
    #[serde(rename = "providerInstanceId")]
    provider_instance_id: String,
    #[serde(rename = "providerDeviceRef")]
    provider_device_ref: String,
    #[serde(rename = "providerKind")]
    provider_kind: String,
    #[serde(rename = "providerRef")]
    provider_ref: String,
    #[serde(
        rename = "suggestedDisplayTypeId",
        skip_serializing_if = "Option::is_none"
    )]
    suggested_display_type_id: Option<String>,
    #[serde(
        rename = "suggestedDisplayType",
        skip_serializing_if = "Option::is_none"
    )]
    suggested_display_type: Option<DisplayCandidateType>,
    #[serde(rename = "discoverySource")]
    discovery_source: String,
    metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub(crate) struct DisplayCandidateType {
    id: String,
    name: String,
    width: i32,
    height: i32,
    rotation: i32,
    palette: Palette,
    #[serde(rename = "contentPadding")]
    content_padding: EdgeInsets,
    #[serde(rename = "gridUnitPx")]
    grid_unit_px: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderInstancesDocument {
    #[serde(default)]
    source_providers: Vec<ProviderInstance>,
    #[serde(default)]
    display_providers: Vec<ProviderInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct StoredSettings {
    #[serde(flatten)]
    provider_instances: Option<ProviderInstancesDocument>,
    #[serde(
        rename = "scheduleUpdateLogRetentionDays",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) schedule_update_log_retention_days: Option<u64>,
    #[serde(rename = "homeAssistant", skip_serializing_if = "Option::is_none")]
    home_assistant: Option<HomeAssistantSettingsStored>,
    #[serde(
        rename = "openEpaperLinkAccessPoint",
        skip_serializing_if = "Option::is_none"
    )]
    openepaperlink_access_point: Option<OpenEpaperLinkAccessPointSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScheduleUpdateLogSettings {
    pub(crate) retention_days: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssignmentUpdateLogEntry {
    pub(crate) timestamp_ms: u64,
    pub(crate) timestamp: String,
    pub(crate) project_id: String,
    pub(crate) assignment_id: String,
    pub(crate) display_id: String,
    pub(crate) desired: bool,
    pub(crate) succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) height: Option<u32>,
    #[serde(rename = "imagePngBase64", skip_serializing_if = "Option::is_none")]
    pub(crate) image_png_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderKindsResponse {
    provider_kinds: Vec<ProviderDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HomeAssistantSettingsStored {
    host: String,
    token: String,
    mode: String,
    #[serde(rename = "useSupervisorProxy")]
    use_supervisor_proxy: bool,
    #[serde(rename = "allowInsecureTls", default)]
    allow_insecure_tls: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HomeAssistantStateResponse {
    entity_id: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    attributes: Value,
    #[serde(default)]
    last_changed: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct HomeAssistantConfigResponse {
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AccessPointTagRecord {
    mac: String,
    alias: Option<String>,
    #[serde(rename = "hwType")]
    hw_type: Option<u64>,
    #[serde(rename = "contentMode")]
    content_mode: Option<u64>,
    capabilities: Option<u64>,
    rotate: Option<u64>,
    invert: Option<u64>,
    lut: Option<u64>,
    isexternal: Option<bool>,
    apip: Option<String>,
    temperature: Option<f64>,
    #[serde(rename = "batteryMv")]
    battery_mv: Option<u64>,
    lastseen: Option<u64>,
    nextcheckin: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AccessPointTagPage {
    tags: Option<Vec<AccessPointTagRecord>>,
    continu: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AccessPointTagType {
    name: Option<String>,
    width: Option<u64>,
    height: Option<u64>,
    colortable: Option<Value>,
}

#[derive(OpenApi)]
#[openapi(
    paths(healthz, list_icons, list_display_profiles),
    components(schemas(
        HealthResponse,
        IconDefinition,
        DisplayProfile,
        Palette,
        EdgeInsets,
        ProjectSummary,
        HomeAssistantSettingsResponse,
        HomeAssistantConnectionStatus,
        OpenEpaperLinkAccessPointSettings,
        OpenEpaperLinkAccessPointStatus,
        EntityCatalogEntry,
        DiscoveredDisplayCandidate,
        DisplayCandidateType
    )),
    tags(
        (name = "system", description = "Backend health"),
        (name = "icons", description = "Font Awesome catalog"),
        (name = "display-profiles", description = "Built-in display profiles")
    )
)]
struct ApiDoc;

#[derive(Debug, Deserialize)]
struct ProviderInstanceInput {
    id: Option<String>,
    #[serde(rename = "providerId")]
    provider_id: String,
    name: String,
    enabled: bool,
    #[serde(default)]
    config: Value,
}

#[derive(Debug, Deserialize)]
struct DiscoverDisplaysQuery {
    #[serde(rename = "providerInstanceId")]
    provider_instance_id: Option<String>,
}

fn project_override_from_body(project_id: &str, body: &Value) -> Option<Value> {
    let project = body.get("project")?.clone();
    if project.get("id").and_then(Value::as_str) == Some(project_id) {
        Some(project)
    } else {
        None
    }
}

pub(crate) async fn load_project_for_request(
    state: &AppState,
    project_id: &str,
    body: Option<&Value>,
) -> Result<Value, ApiError> {
    if let Some(body) = body {
        if let Some(project) = project_override_from_body(project_id, body) {
            return Ok(project);
        }
    }
    read_json_file(&project_file_path(&state.data_dir, project_id)).await
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

#[derive(RustEmbed)]
#[folder = "../../dist/editor-ui"]
struct EmbeddedEditorAssets;

async fn embedded_editor_asset(
    axum::extract::OriginalUri(uri): axum::extract::OriginalUri,
) -> Response {
    let requested_path = uri.path().trim_start_matches('/');
    let asset_path = if requested_path.is_empty() {
        "index.html"
    } else {
        requested_path
    };
    let asset =
        EmbeddedEditorAssets::get(asset_path).or_else(|| EmbeddedEditorAssets::get("index.html"));
    let Some(asset) = asset else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let mime = mime_guess::from_path(asset_path).first_or_octet_stream();
    let mut response = asset.data.into_owned().into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    if asset_path != "index.html" {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    response
}

fn data_dir() -> PathBuf {
    env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data"))
}

fn app(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/v2/openapi.json", get(openapi))
        .route("/api/v2/backup", get(export_backup))
        .route("/api/v2/backup/restore", post(restore_backup))
        .route("/api/v2/display-profiles", get(list_display_profiles))
        .route("/api/v2/icons", get(list_icons))
        .route("/api/v2/provider-kinds", get(list_provider_kinds))
        .route(
            "/api/v2/provider-instances",
            get(list_provider_instances).post(create_provider_instance),
        )
        .route(
            "/api/v2/provider-instances/:id",
            put(update_provider_instance).delete(delete_provider_instance),
        )
        .route(
            "/api/v2/provider-instances/:id/test",
            post(test_provider_instance),
        )
        .route(
            "/api/v2/provider-instances/:id/entities",
            get(provider_entities),
        )
        .route(
            "/api/v2/provider-instances/:id/upload-preview",
            post(upload_preview_to_provider),
        )
        .route("/api/v2/fonts", get(list_fonts))
        .route("/api/v2/fonts/import", post(import_font))
        .route("/api/v2/fonts/rescan", post(rescan_fonts))
        .route(
            "/api/v2/fonts/:id",
            delete(delete_font).patch(update_font_metadata),
        )
        .route("/api/v2/projects", get(list_projects))
        .route("/api/v2/projects/:id", get(get_project).put(save_project))
        .route("/api/v2/projects/:id/live-data", get(live_data))
        .route("/api/v2/projects/:id/layout-preview", post(layout_preview))
        .route("/api/v2/projects/:id/device-preview", post(device_preview))
        .route("/api/v2/projects/:id/font-specimens", post(font_specimens))
        .route("/api/v2/projects/:id/theme-preview", post(theme_preview))
        .route("/api/v2/projects/:id/publish", post(publish_project))
        .route(
            "/api/v2/schedule-update-log-settings",
            get(get_schedule_update_log_settings).put(save_schedule_update_log_settings),
        )
        .route(
            "/api/v2/projects/:id/displays/discover",
            get(discover_displays),
        )
        .route(
            "/api/v2/projects/:id/assignment-schedules",
            get(list_assignment_schedules),
        )
        .route(
            "/api/v2/projects/:id/displays/:displayId/update-log",
            get(list_display_update_log),
        )
        .route(
            "/api/v2/projects/:id/assignments/:assignmentId/force-update",
            post(force_assignment_update),
        )
        .route(
            "/api/v2/projects/:id/devices/:displayId/upload",
            post(upload_device_image),
        )
        .fallback(get(embedded_editor_asset))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

fn load_icons() -> Vec<IconDefinition> {
    serde_json::from_str(FONT_AWESOME_ICONS_JSON)
        .expect("font awesome icon catalog must be valid json")
}

fn load_display_profiles() -> Vec<DisplayProfile> {
    vec![
        DisplayProfile {
            id: "tri296x128-red".into(),
            width: 296,
            height: 128,
            rotation: 0,
            palette: Palette {
                bg: "#ffffff".into(),
                fg: "#111111".into(),
                accent: "#d7261b".into(),
            },
            content_padding: EdgeInsets {
                top: 4,
                right: 4,
                bottom: 4,
                left: 4,
            },
            grid_unit_px: 8,
            recommended_font_scale: 2,
        },
        DisplayProfile {
            id: "tri296x128-yellow".into(),
            width: 296,
            height: 128,
            rotation: 0,
            palette: Palette {
                bg: "#ffffff".into(),
                fg: "#111111".into(),
                accent: "#d5a000".into(),
            },
            content_padding: EdgeInsets {
                top: 4,
                right: 4,
                bottom: 4,
                left: 4,
            },
            grid_unit_px: 8,
            recommended_font_scale: 2,
        },
        DisplayProfile {
            id: "tri400x300-red".into(),
            width: 400,
            height: 300,
            rotation: 0,
            palette: Palette {
                bg: "#ffffff".into(),
                fg: "#111111".into(),
                accent: "#d7261b".into(),
            },
            content_padding: EdgeInsets {
                top: 8,
                right: 8,
                bottom: 8,
                left: 8,
            },
            grid_unit_px: 10,
            recommended_font_scale: 3,
        },
        DisplayProfile {
            id: "tri400x300-yellow".into(),
            width: 400,
            height: 300,
            rotation: 0,
            palette: Palette {
                bg: "#ffffff".into(),
                fg: "#111111".into(),
                accent: "#d5a000".into(),
            },
            content_padding: EdgeInsets {
                top: 8,
                right: 8,
                bottom: 8,
                left: 8,
            },
            grid_unit_px: 10,
            recommended_font_scale: 3,
        },
    ]
}

pub(crate) async fn read_font_index(state: &AppState) -> Result<StoredFontsIndex, ApiError> {
    match fs::read_to_string(font_index_file_path(&state.data_dir)).await {
        Ok(content) => {
            serde_json::from_str(&content).map_err(|error| ApiError::internal(error.to_string()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(StoredFontsIndex { fonts: Vec::new() })
        }
        Err(error) => Err(internal_error(error)),
    }
}

pub(crate) async fn write_font_index(
    state: &AppState,
    index: &StoredFontsIndex,
) -> Result<(), ApiError> {
    let value =
        serde_json::to_value(index).map_err(|error| ApiError::internal(error.to_string()))?;
    write_json_file(&font_index_file_path(&state.data_dir), &value).await
}

pub(crate) async fn list_font_options(state: &AppState) -> Result<Vec<FontOption>, ApiError> {
    let mut fonts = read_font_index(state)
        .await?
        .fonts
        .iter()
        .map(to_font_option)
        .collect::<Vec<_>>();
    fonts.sort_by_key(|font| font.label.to_ascii_lowercase());
    Ok(fonts)
}

pub(crate) async fn load_user_font_data(state: &AppState) -> Result<Value, ApiError> {
    let index = read_font_index(state).await?;
    let mut families = serde_json::Map::new();
    for font in index.fonts {
        let mut entry = serde_json::Map::new();
        entry.insert("label".into(), Value::from(font.label.clone()));
        if let Some(allowed) = font.allowed_pixel_sizes.clone() {
            entry.insert(
                "allowedPixelSizes".into(),
                serde_json::to_value(allowed)
                    .map_err(|error| ApiError::internal(error.to_string()))?,
            );
        }
        for (variant, filename) in font_files(&font) {
            let bytes = fs::read(fonts_dir(&state.data_dir).join(filename))
                .await
                .map_err(internal_error)?;
            let encoded = Value::from(base64::engine::general_purpose::STANDARD.encode(bytes));
            entry.insert(variant.clone(), encoded.clone());
            let (weight, slope) = font_variant_weight_slope(&variant);
            let alias = match (weight, slope) {
                ("bold", "italic") => Some("boldItalic"),
                ("bold", _) => Some("bold"),
                (_, "italic") => Some("italic"),
                _ => Some("regular"),
            };
            if let Some(alias) = alias {
                entry.entry(alias).or_insert(encoded);
            }
        }
        families.insert(font.id, Value::Object(entry));
    }
    Ok(Value::Object(families))
}

pub(crate) fn slugify_font_id(value: &str) -> String {
    let mut output = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            output.push(ch);
            last_dash = false;
        } else if !last_dash {
            output.push('-');
            last_dash = true;
        }
    }
    output.trim_matches('-').chars().take(64).collect()
}

pub(crate) fn detect_font_variant_from_name(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let italic = lower.contains("italic") || lower.contains("oblique");
    let weight = if lower.contains("thin") {
        "thin"
    } else if lower.contains("extralight")
        || lower.contains("extra light")
        || lower.contains("ultralight")
        || lower.contains("ultra light")
    {
        "extraLight"
    } else if lower.contains("light") {
        "light"
    } else if lower.contains("medium") {
        "medium"
    } else if lower.contains("semibold")
        || lower.contains("semi bold")
        || lower.contains("demibold")
        || lower.contains("demi bold")
    {
        "semiBold"
    } else if lower.contains("extrabold")
        || lower.contains("extra bold")
        || lower.contains("ultrabold")
        || lower.contains("ultra bold")
    {
        "extraBold"
    } else if lower.contains("black") || lower.contains("heavy") {
        "black"
    } else if lower.contains("bold") {
        "bold"
    } else {
        "regular"
    };
    match (weight, italic) {
        ("regular", true) => "italic".into(),
        ("regular", false) => "regular".into(),
        ("bold", true) => "boldItalic".into(),
        (weight, true) => format!("{weight}Italic"),
        (weight, false) => weight.into(),
    }
}

pub(crate) fn font_variant_weight_slope(variant: &str) -> (&'static str, &'static str) {
    let lower = variant.to_ascii_lowercase();
    let italic = lower.contains("italic") || lower.contains("oblique");
    let bold = lower.contains("bold") || lower.contains("black") || lower.contains("heavy");
    (
        if bold { "bold" } else { "regular" },
        if italic { "italic" } else { "roman" },
    )
}

pub(crate) fn to_font_option(font: &StoredFontFamily) -> FontOption {
    let mut variants = font_files(font)
        .into_iter()
        .map(|(variant, _)| variant)
        .collect::<Vec<_>>();
    variants.sort_by_key(|variant| font_variant_sort_key(variant));
    FontOption {
        id: font.id.clone(),
        label: font.label.clone(),
        source: "user".into(),
        variants,
        allowed_pixel_sizes: font.allowed_pixel_sizes.clone(),
        import_source: font.import_source.clone(),
        source_url: font.source_url.clone(),
        preview_url: font.preview_url.clone(),
        declared_pixel_size: font.declared_pixel_size,
        license_category: font.license_category.clone(),
    }
}

fn font_variant_sort_key(variant: &str) -> (u8, String) {
    let lower = variant.to_ascii_lowercase();
    let rank = match lower.as_str() {
        "thin" => 0,
        "extralight" => 1,
        "light" => 2,
        "regular" => 3,
        "italic" => 4,
        "medium" => 5,
        "semibold" => 6,
        "bold" => 7,
        "bolditalic" => 8,
        "extrabold" => 9,
        "black" => 10,
        _ => 20,
    };
    (rank, lower)
}

pub(crate) fn font_files(font: &StoredFontFamily) -> Vec<(String, String)> {
    font.files
        .as_object()
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(variant, filename)| {
                    filename
                        .as_str()
                        .map(|name| (variant.clone(), name.to_string()))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(crate) fn home_assistant_settings_from_instance(
    instance: &ProviderInstance,
) -> HomeAssistantSettingsStored {
    HomeAssistantSettingsStored {
        host: instance
            .config
            .get("host")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        token: instance
            .config
            .get("token")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        mode: instance
            .config
            .get("mode")
            .and_then(Value::as_str)
            .unwrap_or("custom")
            .to_string(),
        use_supervisor_proxy: instance
            .config
            .get("useSupervisorProxy")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        allow_insecure_tls: instance
            .config
            .get("allowInsecureTls")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

pub(crate) fn openepaperlink_settings_from_instance(
    instance: &ProviderInstance,
) -> OpenEpaperLinkAccessPointSettings {
    OpenEpaperLinkAccessPointSettings {
        url: instance
            .config
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        default_test_display_mac: Some(
            instance
                .config
                .get("defaultTestDisplayMac")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        ),
    }
}

pub(crate) fn normalize_home_assistant_mode(mode: Option<&str>) -> String {
    match mode {
        Some("supervisor") => "supervisor".into(),
        _ => "custom".into(),
    }
}

pub(crate) fn has_configured_home_assistant(settings: &HomeAssistantSettingsStored) -> bool {
    if settings.mode == "supervisor" || settings.use_supervisor_proxy {
        env::var("SUPERVISOR_TOKEN").is_ok()
    } else {
        !settings.host.trim().is_empty() && !settings.token.trim().is_empty()
    }
}

fn home_assistant_base_url(settings: &HomeAssistantSettingsStored) -> String {
    if settings.mode == "supervisor" || settings.use_supervisor_proxy {
        "http://supervisor/core/api".into()
    } else {
        format!("{}/api", settings.host.trim_end_matches('/'))
    }
}

fn home_assistant_bearer_token(settings: &HomeAssistantSettingsStored) -> String {
    if settings.mode == "supervisor" || settings.use_supervisor_proxy {
        env::var("SUPERVISOR_TOKEN").unwrap_or_default()
    } else {
        settings.token.clone()
    }
}

pub(crate) async fn home_assistant_request<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    settings: &HomeAssistantSettingsStored,
    path: &str,
) -> Result<T, HttpLikeError> {
    if !has_configured_home_assistant(settings) {
        return Err(HttpLikeError {
            status: None,
            message: "Connection settings are incomplete".into(),
        });
    }
    let mut request = client
        .get(format!("{}{}", home_assistant_base_url(settings), path))
        .header(ACCEPT, "application/json");
    let token = home_assistant_bearer_token(settings);
    if !token.is_empty() {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    let response = request.send().await.map_err(|error| HttpLikeError {
        status: None,
        message: error.to_string(),
    })?;
    let status = response.status();
    if !status.is_success() {
        let details = response.text().await.unwrap_or_default();
        return Err(HttpLikeError {
            status: Some(status),
            message: format!(
                "Home Assistant request failed with {} on {}{}",
                status.as_u16(),
                path,
                if details.is_empty() {
                    String::new()
                } else {
                    format!(": {}", details.chars().take(160).collect::<String>())
                }
            ),
        });
    }
    response.json::<T>().await.map_err(|error| HttpLikeError {
        status: None,
        message: error.to_string(),
    })
}

pub(crate) async fn fetch_home_assistant_config(
    client: &reqwest::Client,
    settings: &HomeAssistantSettingsStored,
) -> Result<HomeAssistantConfigResponse, HttpLikeError> {
    home_assistant_request(client, settings, "/config").await
}

pub(crate) async fn fetch_home_assistant_states(
    client: &reqwest::Client,
    settings: &HomeAssistantSettingsStored,
) -> Result<Vec<HomeAssistantStateResponse>, HttpLikeError> {
    home_assistant_request(client, settings, "/states").await
}

pub(crate) async fn fetch_access_point_page(
    client: &reqwest::Client,
    settings: &OpenEpaperLinkAccessPointSettings,
    position: u64,
) -> Result<AccessPointTagPage, HttpLikeError> {
    access_point_request(client, settings, &format!("/get_db?pos={position}")).await
}

pub(crate) async fn fetch_all_access_point_tags(
    client: &reqwest::Client,
    settings: &OpenEpaperLinkAccessPointSettings,
) -> Result<Vec<AccessPointTagRecord>, ApiError> {
    let mut position = 0_u64;
    let mut visited = std::collections::BTreeSet::new();
    let mut tags = Vec::new();
    while !visited.contains(&position) {
        visited.insert(position);
        let page = fetch_access_point_page(client, settings, position)
            .await
            .map_err(|error| ApiError::bad_request(error.message))?;
        tags.extend(page.tags.unwrap_or_default());
        match page.continu {
            Some(next) => position = next,
            None => break,
        }
    }
    Ok(tags)
}

pub(crate) async fn fetch_access_point_tag_type(
    client: &reqwest::Client,
    settings: &OpenEpaperLinkAccessPointSettings,
    hw_type: u64,
) -> Result<Option<AccessPointTagType>, HttpLikeError> {
    access_point_request(
        client,
        settings,
        &format!("/tagtypes/{:02X}.json", hw_type & 0xff),
    )
    .await
    .map(Some)
}

async fn access_point_request<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    settings: &OpenEpaperLinkAccessPointSettings,
    path: &str,
) -> Result<T, HttpLikeError> {
    let url = format!("{}{}", settings.url.trim_end_matches('/'), path);
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| HttpLikeError {
            status: None,
            message: error.to_string(),
        })?;
    let status = response.status();
    if !status.is_success() {
        let details = response.text().await.unwrap_or_default();
        return Err(HttpLikeError {
            status: Some(status),
            message: format!(
                "OpenEPaperLink request failed with {} on {}{}",
                status.as_u16(),
                path,
                if details.is_empty() {
                    String::new()
                } else {
                    format!(": {}", details.chars().take(160).collect::<String>())
                }
            ),
        });
    }
    response.json::<T>().await.map_err(|error| HttpLikeError {
        status: None,
        message: error.to_string(),
    })
}

pub(crate) fn rgba_to_jpeg(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ApiError> {
    let mut rgb = Vec::with_capacity(width as usize * height as usize * 3);
    for chunk in rgba.chunks_exact(4) {
        let alpha = f32::from(chunk[3]) / 255.0;
        let blend = |channel: u8| -> u8 {
            (((f32::from(channel) * alpha) + (255.0 * (1.0 - alpha))).round() as i32).clamp(0, 255)
                as u8
        };
        rgb.push(blend(chunk[0]));
        rgb.push(blend(chunk[1]));
        rgb.push(blend(chunk[2]));
    }
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 90)
        .write_image(&rgb, width, height, ColorType::Rgb8.into())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(bytes)
}

pub(crate) fn rgba_to_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, ApiError> {
    let mut bytes = Vec::new();
    PngEncoder::new(&mut bytes)
        .write_image(rgba, width, height, ColorType::Rgba8.into())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(bytes)
}

pub(crate) fn png_to_jpeg(png: &[u8]) -> Result<Vec<u8>, ApiError> {
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let rgba = image.to_rgba8();
    rgba_to_jpeg(&rgba, image.width(), image.height())
}

pub(crate) async fn upload_image_to_access_point(
    client: &reqwest::Client,
    settings: &OpenEpaperLinkAccessPointSettings,
    mac: &str,
    jpeg: Vec<u8>,
    filename: String,
) -> Result<(), ApiError> {
    let form = Form::new()
        .text("mac", mac.to_string())
        .text("contentmode", "25")
        .text("dither", "0")
        .text("ttl", "1")
        .text("lut", "0")
        .part(
            "file",
            Part::bytes(jpeg)
                .file_name(filename)
                .mime_str("image/jpeg")
                .map_err(|error| ApiError::internal(error.to_string()))?,
        );
    let response = client
        .post(format!("{}/imgupload", settings.url.trim_end_matches('/')))
        .multipart(form)
        .send()
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let details = response.text().await.unwrap_or_default();
        return Err(ApiError::bad_request(format!(
            "OpenEPaperLink upload failed with {}{}",
            status.as_u16(),
            if details.is_empty() {
                String::new()
            } else {
                format!(": {}", details.chars().take(160).collect::<String>())
            }
        )));
    }
    Ok(())
}

pub(crate) fn build_discovered_display_type(
    tag_type: &AccessPointTagType,
    hw_type: u64,
) -> Option<DisplayCandidateType> {
    let width = tag_type.width? as i32;
    let height = tag_type.height? as i32;
    let color_table = tag_type.colortable.as_ref()?;
    let white = color_table
        .get("white")
        .and_then(as_hex_rgb)
        .unwrap_or_else(|| "#ffffff".into());
    let black = color_table
        .get("black")
        .and_then(as_hex_rgb)
        .unwrap_or_else(|| "#000000".into());
    let accent = color_table
        .as_object()
        .and_then(|entries| {
            entries
                .iter()
                .find(|(name, _)| !matches!(name.as_str(), "white" | "black"))
                .and_then(|(_, value)| as_hex_rgb(value))
        })
        .unwrap_or_else(|| "#ff0000".into());
    Some(DisplayCandidateType {
        id: format!("oel-ap-hw-{:02X}-{}x{}", hw_type & 0xff, width, height),
        name: tag_type
            .name
            .clone()
            .unwrap_or_else(|| format!("OEL {}x{}", width, height)),
        width,
        height,
        rotation: 0,
        palette: Palette {
            bg: white,
            fg: black,
            accent,
        },
        content_padding: EdgeInsets {
            top: 4,
            right: 4,
            bottom: 4,
            left: 4,
        },
        grid_unit_px: 8,
    })
}

fn as_hex_rgb(value: &Value) -> Option<String> {
    let channels = value.as_array()?;
    if channels.len() != 3 {
        return None;
    }
    let mut rgb = String::from("#");
    for channel in channels {
        let number = channel.as_u64()? as u8;
        rgb.push_str(&format!("{number:02x}"));
    }
    Some(rgb)
}

pub(crate) fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn integer_field(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or_default()
}

fn internal_error(error: impl std::fmt::Display) -> ApiError {
    ApiError::internal(error.to_string())
}

#[derive(Debug)]
pub(crate) struct HttpLikeError {
    status: Option<StatusCode>,
    message: String,
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c()
            .await
            .expect("install ctrl+c handler");
    }
}

pub async fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8098);
    let http = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .connect_timeout(std::time::Duration::from_secs(2))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .expect("build reqwest client");
    let address = SocketAddr::from(([0, 0, 0, 0], port));
    let state = AppState {
        icons: Arc::new(load_icons()),
        http,
        data_dir: data_dir(),
        display_profiles: Arc::new(load_display_profiles()),
        publish_hashes: Arc::new(Mutex::new(HashMap::new())),
        assignment_states: Arc::new(Mutex::new(HashMap::new())),
    };
    ensure_seeded(&state).await.expect("seed default project");
    spawn_assignment_scheduler(state.clone());
    info!("epd-backend-api listening on {}", address);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind backend-api listener");
    axum::serve(listener, app(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serve backend-api");
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn loads_font_awesome_icon_catalog() {
        let icons = load_icons();
        assert!(!icons.is_empty());
        assert!(icons
            .iter()
            .any(|icon| icon.id == "fa-solid:triangle-exclamation"));
        assert!(icons.iter().any(|icon| icon.id == "fa-regular:clock"));
        assert!(icons.iter().any(|icon| icon.id == "fa-brands:github"));
    }

    #[tokio::test]
    async fn seeds_and_saves_project_files() {
        let temp_dir = std::env::temp_dir().join(format!(
            "epd-backend-api-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state = AppState {
            icons: Arc::new(load_icons()),
            http: reqwest::Client::new(),
            data_dir: temp_dir.clone(),
            display_profiles: Arc::new(load_display_profiles()),
            publish_hashes: Arc::new(Mutex::new(HashMap::new())),
            assignment_states: Arc::new(Mutex::new(HashMap::new())),
        };
        ensure_seeded(&state).await.unwrap();
        let projects = list_projects(axum::extract::State(state.clone()))
            .await
            .unwrap()
            .0;
        assert!(!projects.is_empty());

        let mut project = get_project(
            axum::extract::State(state.clone()),
            axum::extract::Path(projects[0].id.clone()),
        )
        .await
        .unwrap()
        .0;
        let current_version = integer_field(&project, "version");
        project["name"] = Value::from("Renamed Project");
        let saved = save_project(
            axum::extract::State(state.clone()),
            axum::extract::Path(projects[0].id.clone()),
            Json(project),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(string_field(&saved, "name"), "Renamed Project");
        assert_eq!(integer_field(&saved, "version"), current_version + 1);

        let _ = fs::remove_dir_all(temp_dir).await;
    }
}
