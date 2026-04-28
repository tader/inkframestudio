use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::providers::registry::{
    ProviderDescriptor, ProviderDomain, ProviderFieldDescriptor, ProviderFieldKind,
    ProviderInstance, SourceProvider,
};
use crate::{
    app::AppState,
    services::{
        http_cache::cached_get_json,
        render_data::{collect_data_query_nodes, data_query_source_matches},
    },
    ApiError, EntityCatalogEntry, PlaceSearchEntry,
};

pub static PROVIDER: OpenMeteoProvider = OpenMeteoProvider;

pub struct OpenMeteoProvider;

const CACHE_TTL_MS: u64 = 10 * 60 * 1000;
const DEFAULT_CURRENT_VARIABLES: &str =
    "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,rain";
const DEFAULT_HOURLY_VARIABLES: &str =
    "temperature_2m,weather_code,precipitation_probability,precipitation,rain,wind_speed_10m,wind_direction_10m";
const DEFAULT_DAILY_VARIABLES: &str =
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max";
const REQUIRED_CURRENT_VARIABLES: &[&str] = &[
    "wind_speed_10m",
    "wind_direction_10m",
    "precipitation",
    "rain",
];
const REQUIRED_HOURLY_VARIABLES: &[&str] = &["precipitation_probability", "precipitation", "rain"];
const REQUIRED_DAILY_VARIABLES: &[&str] = &[
    "precipitation_sum",
    "rain_sum",
    "precipitation_probability_max",
];

#[derive(Debug, Deserialize)]
struct GeocodingResponse {
    #[serde(default)]
    results: Vec<GeocodingPlace>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_alias_uses_provider_defaults() {
        assert_eq!(
            variables_from_value(Some(&json!("current")), DEFAULT_CURRENT_VARIABLES),
            vec![
                "temperature_2m".to_string(),
                "weather_code".to_string(),
                "wind_speed_10m".to_string(),
                "wind_direction_10m".to_string(),
                "precipitation".to_string(),
                "rain".to_string()
            ]
        );
    }

    #[test]
    fn empty_current_value_uses_provider_defaults() {
        assert_eq!(
            variables_from_value(Some(&json!("")), DEFAULT_CURRENT_VARIABLES),
            split_variables(DEFAULT_CURRENT_VARIABLES)
        );
        assert_eq!(
            variables_from_value(Some(&json!([])), DEFAULT_CURRENT_VARIABLES),
            split_variables(DEFAULT_CURRENT_VARIABLES)
        );
    }

    #[test]
    fn current_value_falls_back_to_hourly_row() {
        let hourly_rows = vec![json!({
            "time": "2026-04-27T17:00",
            "temperature_2m": 16.8,
            "weather_code": 2,
            "units": {
                "temperature_2m": "°C",
                "weather_code": "wmo code"
            }
        })];
        let current = current_value_from_forecast(
            &json!({ "current": {} }),
            &hourly_rows,
            &["temperature_2m".into(), "weather_code".into()],
        );
        assert_eq!(current["temperature_2m"], json!(16.8));
        assert_eq!(current["weather_code"], json!(2));
        assert_eq!(current["time"], json!("2026-04-27T17:00"));
    }

    #[test]
    fn required_weather_variables_are_added_to_legacy_config() {
        let vars = ensure_variables(
            split_variables("temperature_2m,weather_code"),
            REQUIRED_CURRENT_VARIABLES,
        );
        assert!(vars.contains(&"wind_speed_10m".to_string()));
        assert!(vars.contains(&"wind_direction_10m".to_string()));
        assert!(vars.contains(&"precipitation".to_string()));
        assert!(vars.contains(&"rain".to_string()));
    }

    #[test]
    fn current_value_includes_hourly_rain_chance_when_available() {
        let hourly_rows = vec![
            json!({
                "time": "2026-04-27T09:00",
                "precipitation_probability": 10,
                "rain": 0,
                "units": {
                    "precipitation_probability": "%",
                    "rain": "mm"
                }
            }),
            json!({
                "time": "2026-04-27T17:00",
                "precipitation_probability": 70,
                "rain": 1.2,
                "units": {
                    "precipitation_probability": "%",
                    "rain": "mm"
                }
            }),
        ];
        let current = current_value_from_forecast(
            &json!({
                "current": {
                    "time": "2026-04-27T17:00",
                    "temperature_2m": 16.8,
                    "wind_speed_10m": 14.2,
                    "wind_direction_10m": 220,
                    "precipitation": 1.2
                },
                "current_units": {
                    "temperature_2m": "°C",
                    "wind_speed_10m": "km/h",
                    "wind_direction_10m": "°",
                    "precipitation": "mm"
                }
            }),
            &hourly_rows,
            &split_variables(DEFAULT_CURRENT_VARIABLES),
        );
        assert_eq!(current["wind_speed_10m"], json!(14.2));
        assert_eq!(current["wind_direction_10m"], json!(220));
        assert_eq!(current["precipitation"], json!(1.2));
        assert_eq!(current["precipitation_probability"], json!(70));
        assert_eq!(current["units"]["precipitation_probability"], json!("%"));
    }
}

#[derive(Debug, Deserialize)]
struct GeocodingPlace {
    id: Option<u64>,
    name: String,
    latitude: f64,
    longitude: f64,
    timezone: Option<String>,
    country: Option<String>,
    admin1: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ConfigPlace {
    id: Option<String>,
    name: String,
    latitude: f64,
    longitude: f64,
    timezone: Option<String>,
}

fn field(
    key: &str,
    label: &str,
    placeholder: &str,
    default_value: Value,
) -> ProviderFieldDescriptor {
    ProviderFieldDescriptor {
        key: key.into(),
        label: label.into(),
        kind: ProviderFieldKind::Text,
        required: false,
        secret: false,
        placeholder: Some(placeholder.into()),
        help: None,
        default_value: Some(default_value),
        options: Vec::new(),
    }
}

fn textarea_field(
    key: &str,
    label: &str,
    placeholder: &str,
    default_value: Value,
) -> ProviderFieldDescriptor {
    ProviderFieldDescriptor {
        kind: ProviderFieldKind::Textarea,
        ..field(key, label, placeholder, default_value)
    }
}

pub fn descriptor() -> ProviderDescriptor {
    ProviderDescriptor {
        id: "open-meteo".into(),
        label: "Open-Meteo".into(),
        domain: ProviderDomain::Source,
        capabilities: vec![
            "test_connection".into(),
            "entity_catalog".into(),
            "place_search".into(),
            "resolve_render_data".into(),
            "generic_data_queries".into(),
            "weather_forecast".into(),
        ],
        config_fields: vec![
            field("defaultLatitude", "Default latitude", "52.0000", json!("")),
            field("defaultLongitude", "Default longitude", "4.0000", json!("")),
            field("timezone", "Timezone", "auto", json!("auto")),
            field(
                "currentVariables",
                "Current variables",
                DEFAULT_CURRENT_VARIABLES,
                json!(DEFAULT_CURRENT_VARIABLES),
            ),
            field(
                "hourlyVariables",
                "Hourly variables",
                DEFAULT_HOURLY_VARIABLES,
                json!(DEFAULT_HOURLY_VARIABLES),
            ),
            field(
                "dailyVariables",
                "Daily variables",
                DEFAULT_DAILY_VARIABLES,
                json!(DEFAULT_DAILY_VARIABLES),
            ),
            textarea_field(
                "placesJson",
                "Places JSON",
                r#"[{"id":"den-hoorn","name":"Den Hoorn","latitude":52.00,"longitude":4.33}]"#,
                json!("[]"),
            ),
        ],
    }
}

fn config_string(instance: &ProviderInstance, key: &str) -> String {
    instance
        .config
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn config_f64(instance: &ProviderInstance, key: &str) -> Option<f64> {
    instance
        .config
        .get(key)
        .and_then(Value::as_f64)
        .or_else(|| config_string(instance, key).parse::<f64>().ok())
}

fn configured_places(instance: &ProviderInstance) -> Vec<ConfigPlace> {
    serde_json::from_str::<Vec<ConfigPlace>>(&config_string(instance, "placesJson"))
        .unwrap_or_default()
}

fn variables_from_value(value: Option<&Value>, fallback: &str) -> Vec<String> {
    let variables = match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .collect(),
        Some(Value::String(text)) => split_variables(text),
        _ => split_variables(fallback),
    };
    if variables.is_empty()
        || (variables.len() == 1
            && matches!(
                variables[0].as_str(),
                "current" | "hourly" | "daily" | "default" | "defaults"
            ))
    {
        return split_variables(fallback);
    }
    variables
}

fn split_variables(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn ensure_variables(mut variables: Vec<String>, required: &[&str]) -> Vec<String> {
    for variable in required {
        if !variables.iter().any(|value| value == variable) {
            variables.push((*variable).to_string());
        }
    }
    variables
}

fn place_entry(place: &GeocodingPlace) -> PlaceSearchEntry {
    let detail = [place.admin1.as_deref(), place.country.as_deref()]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let display_name = if detail.is_empty() {
        place.name.clone()
    } else {
        format!("{}, {}", place.name, detail)
    };
    PlaceSearchEntry {
        id: place
            .id
            .map(|id| id.to_string())
            .unwrap_or_else(|| slug(&place.name)),
        name: place.name.clone(),
        display_name,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: place.timezone.clone(),
        country: place.country.clone(),
        admin1: place.admin1.clone(),
    }
}

fn slug(value: &str) -> String {
    let mut output = value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    while output.contains("--") {
        output = output.replace("--", "-");
    }
    output.trim_matches('-').to_string()
}

fn push_param(params: &mut Vec<(String, String)>, key: &str, value: impl Into<String>) {
    let value = value.into();
    if !value.trim().is_empty() {
        params.push((key.into(), value));
    }
}

fn forecast_url(
    latitude: f64,
    longitude: f64,
    timezone: &str,
    current: &[String],
    hourly: &[String],
    daily: &[String],
    forecast_days: Option<u64>,
) -> String {
    let mut params = Vec::new();
    push_param(&mut params, "latitude", latitude.to_string());
    push_param(&mut params, "longitude", longitude.to_string());
    push_param(&mut params, "timezone", timezone);
    push_param(&mut params, "current", current.join(","));
    push_param(&mut params, "hourly", hourly.join(","));
    push_param(&mut params, "daily", daily.join(","));
    if let Some(days) = forecast_days {
        push_param(&mut params, "forecast_days", days.clamp(1, 16).to_string());
    }
    let query = params
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                urlencoding::encode(&key),
                urlencoding::encode(&value)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    format!("https://api.open-meteo.com/v1/forecast?{query}")
}

async fn fetch_forecast(
    state: &AppState,
    latitude: f64,
    longitude: f64,
    timezone: &str,
    current: &[String],
    hourly: &[String],
    daily: &[String],
    forecast_days: Option<u64>,
) -> Result<Value, ApiError> {
    cached_get_json(
        &state.http,
        &forecast_url(
            latitude,
            longitude,
            timezone,
            current,
            hourly,
            daily,
            forecast_days,
        ),
        CACHE_TTL_MS,
    )
    .await
}

fn table_to_rows(table: Option<&Value>, units: Option<&Value>) -> Vec<Value> {
    let Some(object) = table.and_then(Value::as_object) else {
        return Vec::new();
    };
    let len = object
        .values()
        .filter_map(Value::as_array)
        .map(Vec::len)
        .max()
        .unwrap_or(0);
    (0..len)
        .map(|index| {
            let mut row = serde_json::Map::new();
            for (key, value) in object {
                if let Some(items) = value.as_array() {
                    row.insert(
                        key.clone(),
                        items.get(index).cloned().unwrap_or(Value::Null),
                    );
                }
            }
            row.insert("units".into(), units.cloned().unwrap_or_else(|| json!({})));
            Value::Object(row)
        })
        .collect()
}

fn hourly_row_for_current<'a>(
    hourly_rows: &'a [Value],
    current: Option<&serde_json::Map<String, Value>>,
) -> Option<&'a Value> {
    let current_hour = current
        .and_then(|value| value.get("time"))
        .and_then(Value::as_str)
        .and_then(|time| time.get(..13));
    if let Some(current_hour) = current_hour {
        if let Some(row) = hourly_rows.iter().find(|row| {
            row.get("time")
                .and_then(Value::as_str)
                .and_then(|time| time.get(..13))
                == Some(current_hour)
        }) {
            return Some(row);
        }
    }
    hourly_rows.first()
}

fn current_value_from_forecast(
    forecast: &Value,
    hourly_rows: &[Value],
    current_vars: &[String],
) -> Value {
    if let Some(current) = forecast.get("current").and_then(Value::as_object) {
        if !current.is_empty() {
            let mut current = current.clone();
            let mut units = forecast
                .get("current_units")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            if let Some(first_hourly) =
                hourly_row_for_current(hourly_rows, Some(&current)).and_then(Value::as_object)
            {
                for variable in [
                    "precipitation_probability",
                    "precipitation",
                    "rain",
                    "wind_speed_10m",
                    "wind_direction_10m",
                ] {
                    if !current.contains_key(variable) {
                        if let Some(value) = first_hourly.get(variable) {
                            current.insert(variable.into(), value.clone());
                        }
                    }
                }
                if let Some(hourly_units) = first_hourly.get("units").and_then(Value::as_object) {
                    for variable in [
                        "precipitation_probability",
                        "precipitation",
                        "rain",
                        "wind_speed_10m",
                        "wind_direction_10m",
                    ] {
                        if !units.contains_key(variable) {
                            if let Some(value) = hourly_units.get(variable) {
                                units.insert(variable.into(), value.clone());
                            }
                        }
                    }
                }
            }
            current.insert("units".into(), Value::Object(units));
            return Value::Object(current);
        }
    }
    if let Some(current_weather) = forecast.get("current_weather").and_then(Value::as_object) {
        if !current_weather.is_empty() {
            return Value::Object(current_weather.clone());
        }
    }
    hourly_rows
        .iter()
        .find(|row| {
            row.get("time")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
        })
        .or_else(|| hourly_rows.first())
        .and_then(Value::as_object)
        .map(|row| {
            let mut current = serde_json::Map::new();
            for variable in current_vars {
                if let Some(value) = row.get(variable) {
                    current.insert(variable.clone(), value.clone());
                }
            }
            if let Some(value) = row.get("time") {
                current.insert("time".into(), value.clone());
            }
            if let Some(value) = row.get("units") {
                current.insert("units".into(), value.clone());
            }
            Value::Object(current)
        })
        .filter(|value| value.as_object().is_some_and(|object| !object.is_empty()))
        .unwrap_or_else(|| json!({}))
}

fn query_location(instance: &ProviderInstance, node: &Value) -> Option<(f64, f64, Option<String>)> {
    let by_node = node
        .get("latitude")
        .and_then(Value::as_f64)
        .zip(node.get("longitude").and_then(Value::as_f64));
    if let Some((latitude, longitude)) = by_node {
        return Some((
            latitude,
            longitude,
            node.get("timezone")
                .and_then(Value::as_str)
                .map(ToString::to_string),
        ));
    }
    if let Some(location_id) = node.get("locationId").and_then(Value::as_str) {
        if let Some(place) = configured_places(instance).into_iter().find(|place| {
            place.id.as_deref() == Some(location_id) || slug(&place.name) == location_id
        }) {
            return Some((place.latitude, place.longitude, place.timezone));
        }
    }
    config_f64(instance, "defaultLatitude")
        .zip(config_f64(instance, "defaultLongitude"))
        .map(|(latitude, longitude)| {
            (
                latitude,
                longitude,
                Some(config_string(instance, "timezone")).filter(|value| !value.is_empty()),
            )
        })
}

#[async_trait]
impl SourceProvider for OpenMeteoProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        descriptor()
    }

    fn is_configured(&self, _instance: &ProviderInstance) -> bool {
        true
    }

    async fn test_connection(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Value, ApiError> {
        let Some((latitude, longitude, timezone)) = query_location(instance, &json!({})) else {
            return Ok(json!({
                "ok": true,
                "message": "Open-Meteo ready. Add a default latitude/longitude or places for live data."
            }));
        };
        let current = ensure_variables(
            split_variables(&config_string(instance, "currentVariables")),
            REQUIRED_CURRENT_VARIABLES,
        );
        let hourly = ensure_variables(Vec::new(), REQUIRED_HOURLY_VARIABLES);
        let forecast = fetch_forecast(
            state,
            latitude,
            longitude,
            timezone.as_deref().unwrap_or("auto"),
            &current,
            &hourly,
            &[],
            Some(1),
        )
        .await?;
        Ok(json!({
            "ok": true,
            "message": "Connected to Open-Meteo",
            "details": {
                "latitude": forecast.get("latitude"),
                "longitude": forecast.get("longitude"),
                "cachedForSeconds": CACHE_TTL_MS / 1000
            }
        }))
    }

    async fn entity_catalog(
        &self,
        _state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<Vec<EntityCatalogEntry>, ApiError> {
        let mut entries = Vec::new();
        for place in configured_places(instance) {
            let id = place.id.unwrap_or_else(|| slug(&place.name));
            entries.push(EntityCatalogEntry {
                entity_id: format!("open_meteo.{id}.temperature_2m"),
                friendly_name: format!("{} temperature", place.name),
                domain: "weather".into(),
                unit: Some("°C".into()),
            });
            entries.push(EntityCatalogEntry {
                entity_id: format!("open_meteo.{id}.weather_code"),
                friendly_name: format!("{} weather code", place.name),
                domain: "weather".into(),
                unit: None,
            });
        }
        Ok(entries)
    }

    async fn live_entities(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
    ) -> Result<serde_json::Map<String, Value>, ApiError> {
        let mut entities = serde_json::Map::new();
        let current_vars = ensure_variables(
            split_variables(&config_string(instance, "currentVariables")),
            REQUIRED_CURRENT_VARIABLES,
        );
        let hourly_vars = ensure_variables(Vec::new(), REQUIRED_HOURLY_VARIABLES);
        for place in configured_places(instance) {
            let id = place.id.clone().unwrap_or_else(|| slug(&place.name));
            let forecast = fetch_forecast(
                state,
                place.latitude,
                place.longitude,
                place.timezone.as_deref().unwrap_or("auto"),
                &current_vars,
                &hourly_vars,
                &[],
                Some(1),
            )
            .await?;
            let current = forecast
                .get("current")
                .cloned()
                .unwrap_or_else(|| json!({}));
            for variable in &current_vars {
                let state_value = current
                    .get(variable)
                    .map(|value| {
                        value
                            .as_f64()
                            .map(|number| number.to_string())
                            .or_else(|| value.as_str().map(ToString::to_string))
                            .unwrap_or_else(|| value.to_string())
                    })
                    .unwrap_or_else(|| "unknown".into());
                entities.insert(
                    format!("open_meteo.{id}.{variable}"),
                    json!({
                        "entityId": format!("open_meteo.{id}.{variable}"),
                        "state": state_value,
                        "attributes": {
                            "place": place.name,
                            "latitude": place.latitude,
                            "longitude": place.longitude,
                            "raw": current
                        }
                    }),
                );
            }
        }
        Ok(entities)
    }

    async fn resolve_meta_queries(
        &self,
        state: &AppState,
        instance: &ProviderInstance,
        project: &Value,
    ) -> Result<(serde_json::Map<String, Value>, Vec<String>), ApiError> {
        let mut results = serde_json::Map::new();
        let mut warnings = Vec::new();
        for node in collect_data_query_nodes(project) {
            if !matches!(
                node.get("queryKind").and_then(Value::as_str),
                Some("weather_forecast" | "open_meteo_forecast" | "forecast")
            ) {
                continue;
            }
            if !data_query_source_matches(&node, &instance.id) {
                continue;
            }
            let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let Some((latitude, longitude, timezone)) = query_location(instance, &node) else {
                warnings.push(format!("Open-Meteo query {id} has no latitude/longitude."));
                continue;
            };
            let current = ensure_variables(
                variables_from_value(
                    node.get("current"),
                    &config_string(instance, "currentVariables"),
                ),
                REQUIRED_CURRENT_VARIABLES,
            );
            let hourly = ensure_variables(
                variables_from_value(
                    node.get("hourly"),
                    &config_string(instance, "hourlyVariables"),
                ),
                REQUIRED_HOURLY_VARIABLES,
            );
            let daily = ensure_variables(
                variables_from_value(
                    node.get("daily"),
                    &config_string(instance, "dailyVariables"),
                ),
                REQUIRED_DAILY_VARIABLES,
            );
            let forecast_days = node.get("forecastDays").and_then(Value::as_u64);
            match fetch_forecast(
                state,
                latitude,
                longitude,
                timezone.as_deref().unwrap_or("auto"),
                &current,
                &hourly,
                &daily,
                forecast_days,
            )
            .await
            {
                Ok(forecast) => {
                    let hourly_rows =
                        table_to_rows(forecast.get("hourly"), forecast.get("hourly_units"));
                    let daily_rows =
                        table_to_rows(forecast.get("daily"), forecast.get("daily_units"));
                    let current_value =
                        current_value_from_forecast(&forecast, &hourly_rows, &current);
                    results.insert(
                        id.to_string(),
                        json!({
                            "kind": "open_meteo_forecast",
                            "items": [{
                                "current": current_value,
                                "hourly": hourly_rows,
                                "daily": daily_rows,
                                "latitude": latitude,
                                "longitude": longitude,
                                "timezone": forecast.get("timezone").cloned().unwrap_or_else(|| json!(timezone.as_deref().unwrap_or("auto"))),
                                "raw": forecast
                            }],
                            "meta": {
                                "queryKind": "weather_forecast",
                                "variableName": node.get("variableName").and_then(Value::as_str).unwrap_or("weather"),
                                "latitude": latitude,
                                "longitude": longitude,
                                "cacheTtlSeconds": CACHE_TTL_MS / 1000
                            }
                        }),
                    );
                }
                Err(error) => {
                    warnings.push(format!("Open-Meteo query {id} failed. {}", error.message))
                }
            }
        }
        Ok((results, warnings))
    }

    async fn search_places(
        &self,
        state: &AppState,
        _instance: &ProviderInstance,
        query: &str,
    ) -> Result<Vec<PlaceSearchEntry>, ApiError> {
        let query = query.trim();
        if query.len() < 2 {
            return Ok(Vec::new());
        }
        let url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=10&format=json",
            urlencoding::encode(query)
        );
        let response: GeocodingResponse = cached_get_json(&state.http, &url, CACHE_TTL_MS).await?;
        Ok(response.results.iter().map(place_entry).collect())
    }
}
