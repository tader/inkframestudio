use axum::{extract::State, http::StatusCode, Json};

use crate::{
    app::AppState, default_home_assistant_settings, default_openepaperlink_settings,
    fetch_access_point_page, fetch_home_assistant_config, masked_home_assistant_settings,
    normalize_home_assistant_mode, read_settings, write_settings, ApiResult,
    HomeAssistantConfigResponse, HomeAssistantConnectionStatus, HomeAssistantSettingsInput,
    HomeAssistantSettingsResponse, HomeAssistantSettingsStored, OpenEpaperLinkAccessPointSettings,
    OpenEpaperLinkAccessPointSettingsInput, OpenEpaperLinkAccessPointStatus,
};

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn get_home_assistant_settings(
    State(state): State<AppState>,
) -> ApiResult<HomeAssistantSettingsResponse> {
    Ok(Json(masked_home_assistant_settings(
        read_settings(&state).await?.home_assistant.as_ref(),
    )))
}

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn save_home_assistant_settings(
    State(state): State<AppState>,
    Json(input): Json<HomeAssistantSettingsInput>,
) -> ApiResult<HomeAssistantSettingsResponse> {
    let mut settings = read_settings(&state).await?;
    let current = settings
        .home_assistant
        .clone()
        .unwrap_or_else(default_home_assistant_settings);
    let next = HomeAssistantSettingsStored {
        host: input.host.unwrap_or(current.host),
        token: if input.replace_token.unwrap_or(false) || current.token.is_empty() {
            input.token.unwrap_or_default()
        } else {
            current.token
        },
        mode: normalize_home_assistant_mode(input.mode.as_deref()),
        use_supervisor_proxy: input.use_supervisor_proxy.unwrap_or(false),
        allow_insecure_tls: input.allow_insecure_tls.unwrap_or(false),
    };
    settings.home_assistant = Some(next.clone());
    write_settings(&state, &settings).await?;
    Ok(Json(masked_home_assistant_settings(Some(&next))))
}

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn test_home_assistant_settings(
    State(state): State<AppState>,
    Json(input): Json<HomeAssistantSettingsInput>,
) -> ApiResult<HomeAssistantConnectionStatus> {
    let stored = read_settings(&state)
        .await?
        .home_assistant
        .unwrap_or_else(default_home_assistant_settings);
    let settings = HomeAssistantSettingsStored {
        host: input.host.unwrap_or(stored.host),
        token: if input.replace_token.unwrap_or(false) || stored.token.is_empty() {
            input.token.unwrap_or_default()
        } else {
            stored.token
        },
        mode: normalize_home_assistant_mode(input.mode.as_deref()),
        use_supervisor_proxy: input.use_supervisor_proxy.unwrap_or(false),
        allow_insecure_tls: input.allow_insecure_tls.unwrap_or(false),
    };
    let result = match fetch_home_assistant_config(&state.http, &settings).await {
        Ok(HomeAssistantConfigResponse { version }) => HomeAssistantConnectionStatus {
            ok: true,
            mode: settings.mode.clone(),
            message: "Connected to Home Assistant".into(),
            server_version: version,
            auth_error: None,
            network_error: None,
        },
        Err(error) => HomeAssistantConnectionStatus {
            ok: false,
            mode: settings.mode.clone(),
            message: error.message.clone(),
            server_version: None,
            auth_error: Some(matches!(
                error.status,
                Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
            )),
            network_error: Some(error.status.is_none()),
        },
    };
    Ok(Json(result))
}

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn get_openepaperlink_settings(
    State(state): State<AppState>,
) -> ApiResult<OpenEpaperLinkAccessPointSettings> {
    Ok(Json(
        read_settings(&state)
            .await?
            .openepaperlink_access_point
            .unwrap_or_else(default_openepaperlink_settings),
    ))
}

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn save_openepaperlink_settings(
    State(state): State<AppState>,
    Json(input): Json<OpenEpaperLinkAccessPointSettingsInput>,
) -> ApiResult<OpenEpaperLinkAccessPointSettings> {
    let mut settings = read_settings(&state).await?;
    let current = settings
        .openepaperlink_access_point
        .clone()
        .unwrap_or_else(default_openepaperlink_settings);
    let next = OpenEpaperLinkAccessPointSettings {
        url: input.url.unwrap_or(current.url),
        default_test_display_mac: input
            .default_test_display_mac
            .or(current.default_test_display_mac),
    };
    settings.openepaperlink_access_point = Some(next.clone());
    write_settings(&state, &settings).await?;
    Ok(Json(next))
}

// Temporary compatibility routes. Generic provider-instance APIs remain preferred.
pub(crate) async fn test_openepaperlink_settings(
    State(state): State<AppState>,
    Json(input): Json<OpenEpaperLinkAccessPointSettingsInput>,
) -> ApiResult<OpenEpaperLinkAccessPointStatus> {
    let stored = read_settings(&state)
        .await?
        .openepaperlink_access_point
        .unwrap_or_else(default_openepaperlink_settings);
    let settings = OpenEpaperLinkAccessPointSettings {
        url: input.url.unwrap_or(stored.url),
        default_test_display_mac: input
            .default_test_display_mac
            .or(stored.default_test_display_mac),
    };
    if settings.url.trim().is_empty() {
        return Ok(Json(OpenEpaperLinkAccessPointStatus {
            ok: false,
            message: "Access point URL missing".into(),
            tag_count: None,
            network_error: Some(false),
        }));
    }
    match fetch_access_point_page(&state.http, &settings, 0).await {
        Ok(page) => Ok(Json(OpenEpaperLinkAccessPointStatus {
            ok: true,
            message: "Connected to OpenEPaperLink access point".into(),
            tag_count: Some(page.tags.unwrap_or_default().len()),
            network_error: None,
        })),
        Err(error) => Ok(Json(OpenEpaperLinkAccessPointStatus {
            ok: false,
            message: error.message,
            tag_count: None,
            network_error: Some(true),
        })),
    }
}
