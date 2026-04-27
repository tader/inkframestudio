use chrono::{Datelike, Local, TimeZone, Timelike};
use futures::stream::{self, StreamExt};
use serde_json::{json, Value};
use std::collections::BTreeSet;

use crate::{
    all_provider_instances, app::AppState, find_provider_instance, home_assistant_request,
    providers::source_provider, read_settings, ApiError, HomeAssistantSettingsStored,
};

fn zero_pad(value: u32) -> String {
    format!("{value:02}")
}

fn format_local_date<Tz: TimeZone>(date: chrono::DateTime<Tz>) -> String
where
    Tz::Offset: std::fmt::Display,
{
    format!(
        "{}-{}-{}",
        date.year(),
        zero_pad(date.month()),
        zero_pad(date.day())
    )
}

fn parse_rollover_time(value: Option<&str>) -> Option<(u32, u32)> {
    let value = value?.trim();
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<u32>().ok()?;
    let minutes = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() || hours > 23 || minutes > 59 {
        return None;
    }
    Some((hours, minutes))
}

fn build_local_calendar_window(
    offset_days: i64,
    rollover_time: Option<&str>,
) -> (
    chrono::DateTime<Local>,
    chrono::DateTime<Local>,
    String,
    i64,
) {
    let now = Local::now();
    let mut effective_offset_days = offset_days;
    if let Some((hours, minutes)) = parse_rollover_time(rollover_time) {
        if now.hour() > hours || (now.hour() == hours && now.minute() >= minutes) {
            effective_offset_days += 1;
        }
    }
    let midnight = now
        .with_hour(0)
        .and_then(|value| value.with_minute(0))
        .and_then(|value| value.with_second(0))
        .and_then(|value| value.with_nanosecond(0))
        .unwrap_or(now);
    let start = midnight + chrono::Duration::days(effective_offset_days);
    let end = start + chrono::Duration::days(1);
    (start, end, format_local_date(start), effective_offset_days)
}

fn extract_event_date_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Object(map) => [
            "dateTime",
            "datetime",
            "date",
            "value",
            "start",
            "start_time",
            "end",
            "end_time",
        ]
        .iter()
        .find_map(|key| {
            map.get(*key)
                .and_then(Value::as_str)
                .map(ToString::to_string)
        }),
        _ => None,
    }
}

fn parse_event_datetime(
    value: Option<&Value>,
    fallback: Option<chrono::DateTime<chrono::FixedOffset>>,
) -> chrono::DateTime<chrono::FixedOffset> {
    if let Some(value) = value {
        if let Some(text) = extract_event_date_string(value) {
            if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&text) {
                return parsed;
            }
            if let Ok(parsed) = chrono::NaiveDate::parse_from_str(&text, "%Y-%m-%d") {
                return parsed
                    .and_hms_opt(0, 0, 0)
                    .and_then(|naive| {
                        chrono::FixedOffset::east_opt(0)
                            .map(|offset| offset.from_utc_datetime(&naive))
                    })
                    .unwrap();
            }
        }
    }
    fallback.unwrap_or_else(|| {
        chrono::FixedOffset::east_opt(0)
            .unwrap()
            .timestamp_opt(0, 0)
            .unwrap()
    })
}

fn detect_all_day_event(item: &serde_json::Map<String, Value>, start: &str, end: &str) -> bool {
    if let Some(explicit) = item
        .get("all_day")
        .and_then(Value::as_bool)
        .or_else(|| item.get("allDay").and_then(Value::as_bool))
        .or_else(|| item.get("allday").and_then(Value::as_bool))
    {
        return explicit;
    }
    if chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d").is_ok()
        || chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d").is_ok()
    {
        return true;
    }
    if start.contains("T00:00:00") && end.contains("T00:00:00") {
        let start_dt = parse_event_datetime(Some(&Value::String(start.to_string())), None);
        let end_dt = parse_event_datetime(Some(&Value::String(end.to_string())), Some(start_dt));
        return (end_dt - start_dt).num_hours() >= 24;
    }
    false
}

fn normalize_calendar_event(entity_id: &str, item: &Value) -> Value {
    let object = item.as_object().cloned().unwrap_or_default();
    let start_value = object
        .get("start")
        .or_else(|| object.get("start_time"))
        .and_then(extract_event_date_string)
        .unwrap_or_default();
    let start_string_value = Value::String(start_value.clone());
    let fallback_start = parse_event_datetime(
        if start_value.is_empty() {
            None
        } else {
            Some(&start_string_value)
        },
        None,
    );
    let end_value = object
        .get("end")
        .or_else(|| object.get("end_time"))
        .or_else(|| object.get("start"))
        .or_else(|| object.get("start_time"))
        .and_then(extract_event_date_string)
        .unwrap_or_default();
    let end_string_value = Value::String(end_value.clone());
    let fallback_end = parse_event_datetime(
        if end_value.is_empty() {
            None
        } else {
            Some(&end_string_value)
        },
        Some(fallback_start + chrono::Duration::minutes(1)),
    );
    let start = if start_value.is_empty() {
        fallback_start.to_rfc3339()
    } else {
        start_value
    };
    let end = if end_value.is_empty() {
        fallback_end.to_rfc3339()
    } else {
        end_value
    };
    let all_day = detect_all_day_event(&object, &start, &end);
    json!({
        "calendarEntityId": entity_id,
        "summary": object.get("summary").and_then(Value::as_str)
            .or_else(|| object.get("message").and_then(Value::as_str))
            .or_else(|| object.get("title").and_then(Value::as_str))
            .unwrap_or(""),
        "start": start,
        "end": end,
        "allDay": all_day,
        "allday": all_day,
        "location": object.get("location").and_then(Value::as_str),
        "description": object.get("description").and_then(Value::as_str),
        "raw": Value::Object(object),
    })
}

fn sort_calendar_events(items: &mut [Value]) {
    items.sort_by(|left, right| {
        let left_start = left
            .get("start")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_start = right
            .get("start")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let left_end = left.get("end").and_then(Value::as_str).unwrap_or_default();
        let right_end = right.get("end").and_then(Value::as_str).unwrap_or_default();
        let left_summary = left
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_summary = right
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let left_entity = left
            .get("calendarEntityId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_entity = right
            .get("calendarEntityId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        left_start
            .cmp(right_start)
            .then(left_end.cmp(right_end))
            .then(left_summary.cmp(right_summary))
            .then(left_entity.cmp(right_entity))
    });
}

fn walk_layout_node(node: Option<&Value>, refs: &mut Vec<Value>) {
    let Some(node) = node else {
        return;
    };
    if node.get("type").and_then(Value::as_str) == Some("data_query") {
        refs.push(node.clone());
    }
    match node.get("type").and_then(Value::as_str).unwrap_or_default() {
        "stack" | "zstack" => {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    walk_layout_node(Some(child), refs);
                }
            }
        }
        "grid" => {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    walk_layout_node(child.get("node"), refs);
                }
            }
        }
        "data_query" | "foreach" | "filter" | "unique" | "script" => {
            walk_layout_node(node.get("child"), refs);
        }
        "if_else" => {
            walk_layout_node(node.get("thenChild"), refs);
            walk_layout_node(node.get("elseChild"), refs);
        }
        _ => {}
    }
}

pub(crate) fn collect_data_query_nodes(project: &Value) -> Vec<Value> {
    let mut refs = Vec::new();
    if let Some(layouts) = project.get("layoutDefinitions").and_then(Value::as_array) {
        for layout in layouts {
            walk_layout_node(layout.get("rootNode"), &mut refs);
        }
    }
    if let Some(definitions) = project.get("widgetDefinitions").and_then(Value::as_array) {
        for definition in definitions {
            if definition.get("kind").and_then(Value::as_str) != Some("compound") {
                continue;
            }
            walk_layout_node(definition.get("rootNode"), &mut refs);
        }
    }
    refs
}

#[derive(Debug, Default, Clone, Copy)]
struct RenderDataRequirements {
    needs_live_entities: bool,
    needs_data_queries: bool,
}

fn referenced_compound_root<'a>(project: &'a Value, definition_id: &str) -> Option<&'a Value> {
    project
        .get("widgetDefinitions")
        .and_then(Value::as_array)
        .and_then(|definitions| {
            definitions.iter().find(|definition| {
                definition.get("id").and_then(Value::as_str) == Some(definition_id)
                    && definition.get("kind").and_then(Value::as_str) == Some("compound")
            })
        })
        .and_then(|definition| definition.get("rootNode"))
}

fn scan_layout_requirements_node(
    project: &Value,
    node: Option<&Value>,
    requirements: &mut RenderDataRequirements,
    visited_compounds: &mut BTreeSet<String>,
) {
    let Some(node) = node else {
        return;
    };
    match node.get("type").and_then(Value::as_str).unwrap_or_default() {
        "primitive_instance" => {
            if node
                .get("bindings")
                .and_then(Value::as_object)
                .and_then(|bindings| bindings.get("entity"))
                .and_then(Value::as_str)
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
            {
                requirements.needs_live_entities = true;
            }
        }
        "compound_ref" => {
            if let Some(definition_id) = node.get("definitionId").and_then(Value::as_str) {
                if visited_compounds.insert(definition_id.to_string()) {
                    scan_layout_requirements_node(
                        project,
                        referenced_compound_root(project, definition_id),
                        requirements,
                        visited_compounds,
                    );
                }
            }
        }
        "data_query" => {
            requirements.needs_data_queries = true;
            scan_layout_requirements_node(
                project,
                node.get("child"),
                requirements,
                visited_compounds,
            );
        }
        "stack" | "zstack" => {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    scan_layout_requirements_node(
                        project,
                        Some(child),
                        requirements,
                        visited_compounds,
                    );
                }
            }
        }
        "grid" => {
            if let Some(children) = node.get("children").and_then(Value::as_array) {
                for child in children {
                    scan_layout_requirements_node(
                        project,
                        child.get("node"),
                        requirements,
                        visited_compounds,
                    );
                }
            }
        }
        "foreach" | "filter" | "unique" | "script" => {
            scan_layout_requirements_node(
                project,
                node.get("child"),
                requirements,
                visited_compounds,
            );
        }
        "if_else" => {
            scan_layout_requirements_node(
                project,
                node.get("thenChild"),
                requirements,
                visited_compounds,
            );
            scan_layout_requirements_node(
                project,
                node.get("elseChild"),
                requirements,
                visited_compounds,
            );
        }
        _ => {}
    }
}

fn render_data_requirements(
    project: &Value,
    target_layout_id: Option<&str>,
) -> RenderDataRequirements {
    let mut requirements = RenderDataRequirements::default();
    let mut visited_compounds = BTreeSet::new();
    if let Some(layout_id) = target_layout_id {
        let target_root = project
            .get("layoutDefinitions")
            .and_then(Value::as_array)
            .and_then(|layouts| {
                layouts
                    .iter()
                    .find(|layout| layout.get("id").and_then(Value::as_str) == Some(layout_id))
            })
            .and_then(|layout| layout.get("rootNode"));
        scan_layout_requirements_node(
            project,
            target_root,
            &mut requirements,
            &mut visited_compounds,
        );
        return requirements;
    }
    if let Some(layouts) = project.get("layoutDefinitions").and_then(Value::as_array) {
        for layout in layouts {
            scan_layout_requirements_node(
                project,
                layout.get("rootNode"),
                &mut requirements,
                &mut visited_compounds,
            );
        }
    }
    requirements
}

pub(crate) async fn resolve_meta_queries(
    client: &reqwest::Client,
    settings: &HomeAssistantSettingsStored,
    project: &Value,
) -> (serde_json::Map<String, Value>, Vec<String>) {
    let mut results = serde_json::Map::new();
    let mut warnings = Vec::new();
    for node in collect_data_query_nodes(project) {
        if node.get("queryKind").and_then(Value::as_str) != Some("calendar_events") {
            continue;
        }
        let id = node.get("id").and_then(Value::as_str).unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let offset_days = node.get("offsetDays").and_then(Value::as_i64).unwrap_or(0);
        let rollover_time = node.get("rolloverTime").and_then(Value::as_str);
        let (start, end, date, effective_offset_days) =
            build_local_calendar_window(offset_days, rollover_time);
        let items_and_warnings =
            if let Some(entity_ids) = node.get("calendarEntityIds").and_then(Value::as_array) {
                let owned_entity_ids = entity_ids
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>();
                stream::iter(owned_entity_ids.into_iter().map(|entity_id| {
                    let path = format!(
                        "/calendars/{}?start={}&end={}",
                        entity_id,
                        urlencoding::encode(&start.to_rfc3339()),
                        urlencoding::encode(&end.to_rfc3339())
                    );
                    async move {
                        match home_assistant_request::<Vec<Value>>(client, settings, &path).await {
                            Ok(calendar_items) => (
                                calendar_items
                                    .into_iter()
                                    .map(|item| normalize_calendar_event(&entity_id, &item))
                                    .collect::<Vec<_>>(),
                                None,
                            ),
                            Err(error) => (
                                Vec::new(),
                                Some(format!("Calendar {} failed. {}", entity_id, error.message)),
                            ),
                        }
                    }
                }))
                .buffer_unordered(4)
                .collect::<Vec<_>>()
                .await
            } else {
                Vec::new()
            };
        let mut items = Vec::new();
        for (result_items, warning) in items_and_warnings {
            items.extend(result_items);
            if let Some(warning) = warning {
                warnings.push(warning);
            }
        }
        sort_calendar_events(&mut items);
        results.insert(
            id.to_string(),
            json!({
                "kind": "calendar_events_meta",
                "items": items,
                "meta": {
                    "variableName": node.get("variableName").and_then(Value::as_str).unwrap_or("events"),
                    "dateVariableName": node.get("dateVariableName").and_then(Value::as_str).unwrap_or("date"),
                    "date": date,
                    "queryKind": "calendar_events",
                    "offsetDays": offset_days,
                    "effectiveOffsetDays": effective_offset_days,
                    "rolloverTime": rollover_time
                }
            }),
        );
    }
    (results, warnings)
}

pub(crate) async fn resolve_project_render_data_value(
    state: &AppState,
    project: &Value,
    target_layout_id: Option<&str>,
) -> Result<(Value, Option<String>), ApiError> {
    let settings_document = read_settings(state).await?;
    let unavailable_data = json!({
        "now": Local::now().to_rfc3339(),
        "entities": {},
        "queries": {},
        "metaQueries": {}
    });
    let default_source_instance_id = project
        .get("defaultSourceProviderInstanceId")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let default_source_instance = default_source_instance_id
        .as_deref()
        .and_then(|id| find_provider_instance(&settings_document, id))
        .or_else(|| {
            all_provider_instances(&settings_document)
                .into_iter()
                .find(|instance| {
                    instance.enabled && source_provider(&instance.provider_id).is_some()
                })
        });
    let Some(source_instance) = default_source_instance else {
        return Ok((
            unavailable_data,
            Some("Live source unavailable. Configure and enable a source provider.".into()),
        ));
    };
    let Some(source_provider_impl) = source_provider(&source_instance.provider_id) else {
        return Ok((
            unavailable_data,
            Some(format!(
                "Source provider {} not supported for live render yet.",
                source_instance.provider_id
            )),
        ));
    };
    if !source_provider_impl.is_configured(&source_instance) {
        return Ok((
            unavailable_data,
            Some("Live source unavailable. Configure and save provider settings.".into()),
        ));
    }

    let requirements = render_data_requirements(project, target_layout_id);
    let entities = if requirements.needs_live_entities {
        match source_provider_impl
            .live_entities(state, &source_instance)
            .await
        {
            Ok(entities) => entities,
            Err(error) => {
                return Ok((
                    unavailable_data,
                    Some(format!(
                        "Live source failed. {} Using unknown state.",
                        error.message
                    )),
                ))
            }
        }
    } else {
        serde_json::Map::new()
    };
    let (meta_queries, meta_warnings) = if requirements.needs_data_queries {
        source_provider_impl
            .resolve_meta_queries(state, &source_instance, project)
            .await
            .unwrap_or_default()
    } else {
        (serde_json::Map::new(), Vec::new())
    };
    let message = if meta_warnings.is_empty() {
        None
    } else {
        Some(meta_warnings.join("\n"))
    };
    Ok((
        json!({
            "now": Local::now().to_rfc3339(),
            "entities": entities,
            "queries": {},
            "metaQueries": meta_queries
        }),
        message,
    ))
}
