use axum::{extract::State, Json};

use crate::{app::AppState, DisplayProfile, HealthResponse, IconDefinition};

#[utoipa::path(get, path = "/healthz", tag = "system", responses((status = 200, body = HealthResponse)))]
pub(crate) async fn healthz() -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: "epd-backend-api",
    })
}

#[utoipa::path(get, path = "/api/v2/icons", tag = "icons", responses((status = 200, body = [IconDefinition])))]
pub(crate) async fn list_icons(State(state): State<AppState>) -> Json<Vec<IconDefinition>> {
    Json(state.icons.as_ref().clone())
}

#[utoipa::path(get, path = "/api/v2/display-profiles", tag = "display-profiles", responses((status = 200, body = [DisplayProfile])))]
pub(crate) async fn list_display_profiles(State(state): State<AppState>) -> Json<Vec<DisplayProfile>> {
    Json(state.display_profiles.as_ref().clone())
}
