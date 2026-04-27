use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::ApiError;

#[derive(Clone)]
struct CacheEntry {
    expires_at_ms: u64,
    value: Value,
}

static HTTP_JSON_CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();

pub(crate) async fn cached_get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    ttl_ms: u64,
) -> Result<T, ApiError> {
    let now = crate::now_ms();
    let cache = HTTP_JSON_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(value) = cache
        .lock()
        .expect("http cache mutex poisoned")
        .get(url)
        .filter(|entry| entry.expires_at_ms > now)
        .map(|entry| entry.value.clone())
    {
        return serde_json::from_value(value)
            .map_err(|error| ApiError::internal(error.to_string()));
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let details = response.text().await.unwrap_or_default();
        return Err(ApiError::bad_request(format!(
            "GET {} failed with {}{}",
            url,
            status.as_u16(),
            if details.is_empty() {
                String::new()
            } else {
                format!(": {}", details.chars().take(160).collect::<String>())
            }
        )));
    }
    let value = response
        .json::<Value>()
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    cache.lock().expect("http cache mutex poisoned").insert(
        url.to_string(),
        CacheEntry {
            expires_at_ms: now.saturating_add(ttl_ms),
            value: value.clone(),
        },
    );
    serde_json::from_value(value).map_err(|error| ApiError::internal(error.to_string()))
}
