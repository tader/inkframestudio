use std::{collections::HashMap, fs, path::PathBuf};

use base64::Engine;
use boa_engine::{Context as BoaContext, Source};
use chrono::{Datelike, Timelike};
use epd_text_engine::{
    render as render_text_layout, FontFamilyData as EngineFontFamilyData,
    FontPresets as EngineFontPresets, LayoutRequest, TextLayoutRun, TextStyle as EngineTextStyle,
};
use resvg::{
    tiny_skia::{Pixmap, Transform},
    usvg::{Options, Tree},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{rgba_to_png, ApiError};

const COLOR_BG: u8 = 0;
const COLOR_FG: u8 = 1;
const COLOR_ACCENT: u8 = 2;
const DEFAULT_ICON_ID: &str = "fa-solid:triangle-exclamation";

fn preview_image_hash(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(bytes))
}

fn normalize_icon_id(icon_id: &str) -> String {
    match icon_id.trim() {
        "" => DEFAULT_ICON_ID.into(),
        "garage" => "fa-solid:warehouse".into(),
        "warning" => "fa-solid:triangle-exclamation".into(),
        "calendar" => "fa-regular:calendar".into(),
        "door" => "fa-solid:door-open".into(),
        "lock" => "fa-solid:lock".into(),
        "thermometer" => "fa-solid:temperature-half".into(),
        "humidity" => "fa-solid:droplet".into(),
        "power" => "fa-solid:power-off".into(),
        "clock" => "fa-regular:clock".into(),
        "bolt" => "fa-solid:bolt".into(),
        "window" => "fa-regular:window-maximize".into(),
        "battery" => "fa-solid:battery-half".into(),
        value => value.into(),
    }
}

fn font_awesome_svg_path(icon_id: &str) -> Option<PathBuf> {
    let normalized = normalize_icon_id(icon_id);
    let (pack, name) = normalized.split_once(':')?;
    let dir = match pack {
        "fa-solid" => "solid",
        "fa-regular" => "regular",
        "fa-brands" => "brands",
        _ => return None,
    };
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../node_modules/@fortawesome/fontawesome-free/svgs")
        .join(dir)
        .join(format!("{name}.svg"));
    root.exists().then_some(root)
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectView {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    locale: String,
    #[serde(rename = "activeThemeId", default)]
    active_theme_id: Option<String>,
    themes: Vec<WidgetTheme>,
    #[serde(rename = "displayTypes")]
    display_types: Vec<DisplayType>,
    #[serde(rename = "fontPresets")]
    font_presets: FontPresetValues,
    #[serde(rename = "layoutDefinitions")]
    layout_definitions: Vec<LayoutDefinition>,
    #[serde(rename = "widgetDefinitions", default)]
    widget_definitions: Vec<WidgetDefinition>,
    #[serde(default)]
    devices: Vec<ManagedDisplay>,
    #[serde(rename = "deviceAssignments", default)]
    device_assignments: Vec<DeviceAssignment>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisplayType {
    id: String,
    width: u32,
    height: u32,
    #[serde(rename = "contentPadding")]
    content_padding: Option<EdgeInsets>,
    palette: Palette,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct Palette {
    bg: String,
    fg: String,
    accent: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontPresetValues {
    tiny: u32,
    normal: u32,
    header: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetTheme {
    id: String,
    text: ThemeTextRoles,
    #[serde(default)]
    border: ThemeBorder,
    #[serde(default)]
    surface: ThemeSurface,
    #[serde(rename = "autoFitFontFamily")]
    auto_fit_font_family: Option<String>,
    #[serde(rename = "fontRoles")]
    font_roles: Option<ThemeFontRoles>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeBorder {
    color_role: PaletteRole,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeSurface {
    fill_role: Option<FillRole>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeTextRoles {
    #[allow(dead_code)]
    title: PaletteRole,
    body: PaletteRole,
    value: PaletteRole,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeFontRoles {
    tiny: Option<PartialTextStyle>,
    normal: Option<PartialTextStyle>,
    #[serde(rename = "normalEmphasis")]
    normal_emphasis: Option<PartialTextStyle>,
    header: Option<PartialTextStyle>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialTextStyle {
    family: Option<String>,
    pixel_size: Option<u32>,
    color_role: Option<PaletteRole>,
    weight: Option<String>,
    slope: Option<String>,
    line_spacing_px: Option<i32>,
    top_padding_px: Option<i32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PaletteRole {
    #[default]
    Bg,
    Fg,
    Accent,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum FillRole {
    Bg,
    Fg,
    Accent,
    Gray,
    LightAccent,
    DarkAccent,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFontFamilyData {
    regular: Option<String>,
    italic: Option<String>,
    bold: Option<String>,
    #[serde(rename = "boldItalic")]
    bold_italic: Option<String>,
    #[serde(flatten)]
    variants: HashMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutDefinition {
    id: String,
    #[serde(default)]
    kind: String,
    #[serde(rename = "displayTypeId")]
    display_type_id: Option<String>,
    #[serde(rename = "rootNode")]
    root_node: Option<Node>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedDisplay {
    id: String,
    #[serde(rename = "displayTypeId")]
    display_type_id: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceAssignment {
    #[serde(rename = "displayId")]
    display_id: String,
    #[serde(rename = "defaultFullscreenLayoutId")]
    default_fullscreen_layout_id: Option<String>,
    #[serde(rename = "defaultThemeId")]
    default_theme_id: Option<String>,
    #[serde(rename = "fullscreenRules", default)]
    fullscreen_rules: Vec<Value>,
    #[serde(rename = "popupRules", default)]
    popup_rules: Vec<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SizeSpec {
    mode: Option<String>,
    value: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridTrack {
    size: SizeSpec,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridPlacement {
    row: i32,
    column: i32,
    #[serde(rename = "rowSpan")]
    row_span: Option<i32>,
    #[serde(rename = "columnSpan")]
    column_span: Option<i32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GridChild {
    placement: GridPlacement,
    node: Node,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutStyle {
    #[serde(rename = "paddingPx")]
    padding_px: Option<i32>,
    padding: Option<EdgeInsets>,
    #[serde(rename = "gapPx")]
    gap_px: Option<i32>,
    #[allow(dead_code)]
    #[serde(rename = "horizontalAlign")]
    horizontal_align: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "verticalAlign")]
    vertical_align: Option<String>,
    #[serde(rename = "borderToken")]
    border_token: Option<String>,
    border: Option<BorderEdges>,
    #[serde(rename = "themeId")]
    theme_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EdgeInsets {
    top: Option<i32>,
    right: Option<i32>,
    bottom: Option<i32>,
    left: Option<i32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BorderEdges {
    top: Option<BorderSide>,
    right: Option<BorderSide>,
    bottom: Option<BorderSide>,
    left: Option<BorderSide>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BorderSide {
    size: Option<String>,
    pattern: Option<String>,
    #[serde(rename = "thicknessPx")]
    thickness_px: Option<i32>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetProps {
    text: Option<String>,
    icon: Option<String>,
    prefix: Option<String>,
    suffix: Option<String>,
    unit: Option<String>,
    digits: Option<i32>,
    #[serde(rename = "quantizeStep")]
    quantize_step: Option<f64>,
    #[serde(rename = "valueKey")]
    value_key: Option<String>,
    #[serde(rename = "highlightKey")]
    highlight_key: Option<String>,
    #[serde(rename = "minValue")]
    min_value: Option<f64>,
    #[serde(rename = "maxValue")]
    max_value: Option<f64>,
    #[serde(rename = "baselineValue")]
    baseline_value: Option<f64>,
    #[serde(rename = "barGapPx")]
    bar_gap_px: Option<i32>,
    #[serde(rename = "barOrientation")]
    bar_orientation: Option<String>,
    #[serde(rename = "colorRole")]
    color_role: Option<FillRole>,
    #[serde(rename = "highlightColorRole")]
    highlight_color_role: Option<FillRole>,
    #[serde(rename = "lineDirection")]
    line_direction: Option<String>,
    #[serde(rename = "fixedPixelSize")]
    fixed_pixel_size: Option<u32>,
    #[serde(rename = "renderEntityState")]
    render_entity_state: Option<bool>,
    #[serde(rename = "paddingPx")]
    padding_px: Option<i32>,
    padding: Option<EdgeInsets>,
    #[allow(dead_code)]
    #[serde(rename = "fontRole")]
    font_role: Option<String>,
    #[serde(rename = "horizontalAlign")]
    horizontal_align: Option<String>,
    #[serde(rename = "verticalAlign")]
    vertical_align: Option<String>,
    #[serde(rename = "autoFit")]
    auto_fit: Option<bool>,
    overflow: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompoundInputDefinition {
    id: String,
    name: String,
    #[serde(rename = "valueType")]
    value_type: String,
    #[serde(rename = "defaultValue")]
    default_value: Option<Value>,
    #[serde(rename = "previewValue")]
    preview_value: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetDefinition {
    id: String,
    #[allow(dead_code)]
    name: String,
    kind: String,
    #[serde(rename = "inputSchema", default)]
    input_schema: Vec<CompoundInputDefinition>,
    #[serde(rename = "rootNode")]
    root_node: Option<Node>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompoundRefNode {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "definitionId")]
    definition_id: String,
    #[serde(rename = "inputBindings", default)]
    input_bindings: HashMap<String, String>,
    #[serde(rename = "inputValues", default)]
    input_values: HashMap<String, Value>,
    #[serde(default)]
    style: LayoutStyle,
    width: Option<SizeSpec>,
    height: Option<SizeSpec>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataQueryNode {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "queryKind")]
    query_kind: String,
    #[serde(rename = "variableName")]
    variable_name: String,
    #[serde(rename = "dateVariableName")]
    date_variable_name: Option<String>,
    child: Option<Box<Node>>,
    #[serde(default)]
    style: LayoutStyle,
    width: Option<SizeSpec>,
    height: Option<SizeSpec>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForEachNode {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "itemsRef")]
    items_ref: String,
    #[serde(rename = "itemAlias")]
    item_alias: String,
    #[serde(rename = "indexAlias")]
    index_alias: String,
    axis: String,
    #[serde(rename = "maxItems")]
    max_items: Option<usize>,
    child: Option<Box<Node>>,
    #[serde(default)]
    style: LayoutStyle,
    width: Option<SizeSpec>,
    height: Option<SizeSpec>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptNode {
    #[allow(dead_code)]
    id: String,
    source: String,
    child: Option<Box<Node>>,
    #[serde(default)]
    bindings: HashMap<String, String>,
    #[serde(default)]
    style: LayoutStyle,
    width: Option<SizeSpec>,
    height: Option<SizeSpec>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IfElseNode {
    #[allow(dead_code)]
    id: String,
    condition: String,
    then_child: Option<Box<Node>>,
    else_child: Option<Box<Node>>,
    #[serde(default)]
    style: LayoutStyle,
    width: Option<SizeSpec>,
    height: Option<SizeSpec>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Node {
    Stack {
        #[allow(dead_code)]
        id: String,
        axis: String,
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        style: LayoutStyle,
        width: Option<SizeSpec>,
        height: Option<SizeSpec>,
    },
    Zstack {
        #[allow(dead_code)]
        id: String,
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        style: LayoutStyle,
        width: Option<SizeSpec>,
        height: Option<SizeSpec>,
    },
    Grid {
        #[allow(dead_code)]
        id: String,
        #[serde(default)]
        rows: Vec<GridTrack>,
        #[serde(default)]
        columns: Vec<GridTrack>,
        #[serde(default)]
        children: Vec<GridChild>,
        #[serde(default)]
        style: LayoutStyle,
        width: Option<SizeSpec>,
        height: Option<SizeSpec>,
    },
    DataQuery(DataQueryNode),
    #[serde(rename = "foreach")]
    ForEach(ForEachNode),
    CompoundRef(CompoundRefNode),
    Script(ScriptNode),
    IfElse(IfElseNode),
    PrimitiveInstance {
        #[allow(dead_code)]
        id: String,
        #[serde(rename = "primitiveType")]
        primitive_type: String,
        #[serde(default)]
        props: WidgetProps,
        #[serde(default)]
        bindings: HashMap<String, String>,
        #[serde(default)]
        style: LayoutStyle,
        width: Option<SizeSpec>,
        height: Option<SizeSpec>,
    },
    Spacer {
        #[allow(dead_code)]
        id: String,
        #[serde(default)]
        style: LayoutStyle,
        width: Option<SizeSpec>,
        height: Option<SizeSpec>,
    },
    #[serde(other)]
    Unsupported,
}

#[derive(Clone, Copy)]
struct Rect {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

struct IndexedCanvas {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

pub(crate) struct NativeRenderedPreview {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) hash: String,
    pub(crate) active_screen_id: String,
    pub(crate) active_overlay_id: Option<String>,
    pub(crate) data_source_message: Option<String>,
    pub(crate) script_warnings: Option<Vec<String>>,
    pub(crate) png_bytes: Vec<u8>,
}

impl IndexedCanvas {
    fn new(width: u32, height: u32, fill: u8) -> Self {
        Self {
            width,
            height,
            pixels: vec![fill; width as usize * height as usize],
        }
    }

    fn set_pixel(&mut self, x: i32, y: i32, color: u8) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return;
        }
        self.pixels[y as usize * self.width as usize + x as usize] = color;
    }

    fn fill_rect(&mut self, rect: Rect, color: u8) {
        let x0 = rect.x.max(0);
        let y0 = rect.y.max(0);
        let x1 = (rect.x + rect.w).min(self.width as i32);
        let y1 = (rect.y + rect.h).min(self.height as i32);
        for y in y0..y1 {
            for x in x0..x1 {
                self.set_pixel(x, y, color);
            }
        }
    }

    fn draw_border_span(&mut self, horizontal: bool, fixed: i32, start: i32, end: i32, color: u8) {
        for pos in start..end {
            if horizontal {
                self.set_pixel(pos, fixed, color);
            } else {
                self.set_pixel(fixed, pos, color);
            }
        }
    }
}

fn parse_hex_color(value: &str) -> Result<[u8; 3], ApiError> {
    let safe = value.trim_start_matches('#');
    if safe.len() != 6 {
        return Err(ApiError::bad_request("Invalid palette color"));
    }
    let numeric = u32::from_str_radix(safe, 16)
        .map_err(|_| ApiError::bad_request("Invalid palette color"))?;
    Ok([
        ((numeric >> 16) & 0xff) as u8,
        ((numeric >> 8) & 0xff) as u8,
        (numeric & 0xff) as u8,
    ])
}

fn entity_value<'a>(data: &'a Value, entity_id: &str) -> Option<&'a Value> {
    data.get("entities")?.get(entity_id)
}

fn entity_attribute_value<'a>(
    data: &'a Value,
    entity_id: &str,
    attribute: &str,
) -> Option<&'a Value> {
    entity_value(data, entity_id)?
        .get("attributes")?
        .get(attribute)
}

fn value_ref_value(value_ref: &Value, data: &Value) -> Option<Value> {
    match value_ref.get("type").and_then(Value::as_str) {
        Some("entity_state") => value_ref
            .get("entityId")
            .and_then(Value::as_str)
            .and_then(|entity_id| entity_value(data, entity_id))
            .and_then(|entity| entity.get("state"))
            .cloned(),
        Some("entity_attribute") => {
            let entity_id = value_ref.get("entityId").and_then(Value::as_str)?;
            let attribute = value_ref.get("attribute").and_then(Value::as_str)?;
            entity_attribute_value(data, entity_id, attribute).cloned()
        }
        Some("literal") => value_ref.get("value").cloned(),
        _ => None,
    }
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|entry| entry as f64))
        .or_else(|| value.as_u64().map(|entry| entry as f64))
        .or_else(|| value.as_str().and_then(|entry| entry.parse::<f64>().ok()))
}

fn value_as_bool(value: &Value) -> Option<bool> {
    value.as_bool().or_else(|| match value.as_str() {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    })
}

fn parse_hhmm(value: &str) -> Option<(u32, u32)> {
    let (hour, minute) = value.split_once(':')?;
    let hour = hour.parse::<u32>().ok()?;
    let minute = minute.parse::<u32>().ok()?;
    (hour < 24 && minute < 60).then_some((hour, minute))
}

fn minutes_of_day(hour: u32, minute: u32) -> u32 {
    hour * 60 + minute
}

fn evaluate_condition(condition: &Value, data: &Value) -> bool {
    match condition.get("kind").and_then(Value::as_str) {
        Some("all") => condition
            .get("conditions")
            .and_then(Value::as_array)
            .is_some_and(|conditions| {
                conditions
                    .iter()
                    .all(|entry| evaluate_condition(entry, data))
            }),
        Some("any") => condition
            .get("conditions")
            .and_then(Value::as_array)
            .is_some_and(|conditions| {
                conditions
                    .iter()
                    .any(|entry| evaluate_condition(entry, data))
            }),
        Some("not") => condition
            .get("condition")
            .is_some_and(|entry| !evaluate_condition(entry, data)),
        Some("entity_state") => {
            let entity_id = condition.get("entityId").and_then(Value::as_str);
            let expected = condition.get("equals").and_then(Value::as_str);
            match (entity_id, expected) {
                (Some(entity_id), Some(expected)) => {
                    entity_value(data, entity_id)
                        .and_then(|entity| entity.get("state"))
                        .and_then(Value::as_str)
                        == Some(expected)
                }
                _ => false,
            }
        }
        Some("entity_matches") => {
            let entity_id = condition.get("entityId").and_then(Value::as_str);
            let pattern = condition.get("pattern").and_then(Value::as_str);
            let flags = condition.get("flags").and_then(Value::as_str).unwrap_or("");
            match (entity_id, pattern) {
                (Some(entity_id), Some(pattern)) => {
                    let state = entity_value(data, entity_id)
                        .and_then(|entity| entity.get("state"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let prefixed = if flags.contains('i') {
                        format!("(?i){pattern}")
                    } else {
                        pattern.to_string()
                    };
                    regex::Regex::new(&prefixed)
                        .ok()
                        .is_some_and(|regex| regex.is_match(state))
                }
                _ => false,
            }
        }
        Some("entity_duration_ge") => {
            let entity_id = condition.get("entityId").and_then(Value::as_str);
            let state = condition.get("state").and_then(Value::as_str);
            let minutes = condition
                .get("minutes")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            match (entity_id, state) {
                (Some(entity_id), Some(state)) => {
                    let Some(entity) = entity_value(data, entity_id) else {
                        return false;
                    };
                    if entity.get("state").and_then(Value::as_str) != Some(state) {
                        return false;
                    }
                    let now = data
                        .get("now")
                        .and_then(Value::as_str)
                        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
                    let last_changed = entity
                        .get("lastChanged")
                        .or_else(|| entity.get("last_changed"))
                        .and_then(Value::as_str)
                        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
                    match (now, last_changed) {
                        (Some(now), Some(last_changed)) => {
                            (now - last_changed).num_seconds() as f64 >= minutes * 60.0
                        }
                        _ => false,
                    }
                }
                _ => false,
            }
        }
        Some("numeric_compare") => {
            let left = condition
                .get("left")
                .and_then(|value| value_ref_value(value, data));
            let right = condition.get("right").and_then(Value::as_f64);
            let op = condition.get("op").and_then(Value::as_str);
            match (left.as_ref().and_then(value_as_f64), right, op) {
                (Some(left), Some(right), Some("gt")) => left > right,
                (Some(left), Some(right), Some("gte")) => left >= right,
                (Some(left), Some(right), Some("lt")) => left < right,
                (Some(left), Some(right), Some("lte")) => left <= right,
                (Some(left), Some(right), Some("eq")) => (left - right).abs() < f64::EPSILON,
                (Some(left), Some(right), Some("neq")) => (left - right).abs() >= f64::EPSILON,
                _ => false,
            }
        }
        Some("boolean_compare") => {
            let left = condition
                .get("left")
                .and_then(|value| value_ref_value(value, data));
            let expected = condition.get("equals").and_then(Value::as_bool);
            match (left.as_ref().and_then(value_as_bool), expected) {
                (Some(left), Some(expected)) => left == expected,
                _ => false,
            }
        }
        Some("is_defined") => {
            let expected = condition
                .get("expected")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let defined = condition
                .get("ref")
                .and_then(|value| value_ref_value(value, data))
                .is_some_and(|value| !value.is_null());
            defined == expected
        }
        Some("time_between") => {
            let now = data
                .get("now")
                .and_then(Value::as_str)
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok());
            let start = condition
                .get("start")
                .and_then(Value::as_str)
                .and_then(parse_hhmm);
            let end = condition
                .get("end")
                .and_then(Value::as_str)
                .and_then(parse_hhmm);
            match (now, start, end) {
                (Some(now), Some(start), Some(end)) => {
                    if let Some(weekdays) = condition.get("weekdays").and_then(Value::as_array) {
                        let weekday = now.weekday().num_days_from_monday() as i64;
                        if !weekdays
                            .iter()
                            .filter_map(Value::as_i64)
                            .any(|entry| entry == weekday)
                        {
                            return false;
                        }
                    }
                    let current = minutes_of_day(now.hour(), now.minute());
                    let start = minutes_of_day(start.0, start.1);
                    let end = minutes_of_day(end.0, end.1);
                    if start <= end {
                        current >= start && current <= end
                    } else {
                        current >= start || current <= end
                    }
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn select_rule_layout_id<'a>(
    rules: &'a [Value],
    action_type: &str,
    data: &Value,
) -> Option<&'a str> {
    rules
        .iter()
        .filter(|rule| {
            rule.get("action")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
                == Some(action_type)
        })
        .filter(|rule| {
            rule.get("condition")
                .is_some_and(|condition| evaluate_condition(condition, data))
        })
        .max_by_key(|rule| rule.get("priority").and_then(Value::as_i64).unwrap_or(0))
        .and_then(|rule| rule.get("action"))
        .and_then(|action| action.get("layoutId"))
        .and_then(Value::as_str)
}

fn role_color(role: PaletteRole) -> u8 {
    match role {
        PaletteRole::Bg => COLOR_BG,
        PaletteRole::Fg => COLOR_FG,
        PaletteRole::Accent => COLOR_ACCENT,
    }
}

fn fill_role_color(role: FillRole) -> u8 {
    match role {
        FillRole::Bg => COLOR_BG,
        FillRole::Fg | FillRole::Gray => COLOR_FG,
        FillRole::Accent | FillRole::LightAccent | FillRole::DarkAccent => COLOR_ACCENT,
    }
}

fn contrasted_text_color(theme: &WidgetTheme, resolved: u8, fallback: PaletteRole) -> u8 {
    match theme.surface.fill_role {
        Some(fill_role) if fill_role_color(fill_role) == resolved => role_color(fallback),
        _ => resolved,
    }
}

fn should_fill_node_surface(style: &LayoutStyle) -> bool {
    style
        .theme_id
        .as_deref()
        .is_some_and(|theme_id| !theme_id.is_empty() && theme_id != "inherit")
}

fn resolve_font_family_data(
    family: &str,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Option<RuntimeFontFamilyData> {
    user_fonts
        .get(family)
        .cloned()
        .or_else(|| user_fonts.get("arial").cloned())
        .or_else(|| {
            let fallback_id = user_fonts.keys().min()?.clone();
            user_fonts.get(&fallback_id).cloned()
        })
}

fn runtime_font_variants(data: &RuntimeFontFamilyData) -> HashMap<String, String> {
    data.variants
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|font| (key.clone(), font.to_string())))
        .collect()
}

fn get_size_value(spec: &Option<SizeSpec>, total: i32) -> Option<i32> {
    let spec = spec.as_ref()?;
    match spec.mode.as_deref() {
        Some("fixed_px") => spec.value.map(|value| value.round() as i32),
        Some("fraction") => spec
            .value
            .map(|value| (value * total as f64).round() as i32),
        _ => None,
    }
}

fn node_padding(style: &LayoutStyle, props_padding: Option<i32>) -> i32 {
    props_padding
        .unwrap_or(style.padding_px.unwrap_or(0))
        .max(0)
}

fn edge_value(insets: Option<EdgeInsets>, edge: &str, fallback: i32) -> i32 {
    let value = match edge {
        "top" => insets.and_then(|value| value.top),
        "right" => insets.and_then(|value| value.right),
        "bottom" => insets.and_then(|value| value.bottom),
        _ => insets.and_then(|value| value.left),
    };
    value.unwrap_or(fallback).max(0)
}

fn node_padding_edges(style: &LayoutStyle, props: Option<&WidgetProps>) -> EdgeInsets {
    let fallback = node_padding(style, props.and_then(|props| props.padding_px));
    let insets = props.and_then(|props| props.padding).or(style.padding);
    EdgeInsets {
        top: Some(edge_value(insets, "top", fallback)),
        right: Some(edge_value(insets, "right", fallback)),
        bottom: Some(edge_value(insets, "bottom", fallback)),
        left: Some(edge_value(insets, "left", fallback)),
    }
}

fn edge_inset(insets: &EdgeInsets, edge: &str) -> i32 {
    match edge {
        "top" => insets.top,
        "right" => insets.right,
        "bottom" => insets.bottom,
        _ => insets.left,
    }
    .unwrap_or(0)
    .max(0)
}

fn border_default_thickness(size: &str) -> i32 {
    match size {
        "none" => 0,
        "thick" => 2,
        "fat" => 3,
        _ => 1,
    }
}

fn border_side_for(style: &LayoutStyle, edge: &str) -> BorderSide {
    let legacy_size = style.border_token.as_deref().unwrap_or("none").to_string();
    let side = style.border.as_ref().and_then(|border| match edge {
        "top" => border.top.clone(),
        "right" => border.right.clone(),
        "bottom" => border.bottom.clone(),
        _ => border.left.clone(),
    });
    let legacy_pattern = side.as_ref().and_then(|side| side.pattern.clone());
    let size = side
        .as_ref()
        .and_then(|side| side.size.clone())
        .or_else(|| {
            legacy_pattern
                .clone()
                .filter(|value| matches!(value.as_str(), "none" | "thin" | "thick" | "fat"))
        })
        .unwrap_or(legacy_size);
    let pattern = legacy_pattern
        .filter(|value| !matches!(value.as_str(), "none" | "thin" | "thick" | "fat"))
        .unwrap_or_else(|| "solid".into());
    let thickness = side
        .as_ref()
        .and_then(|side| side.thickness_px)
        .unwrap_or_else(|| border_default_thickness(&size))
        .max(0);
    BorderSide {
        size: Some(size.clone()),
        pattern: Some(pattern.clone()),
        thickness_px: Some(if size == "none" { 0 } else { thickness.max(1) }),
    }
}

fn border_side_thickness(side: &BorderSide) -> i32 {
    let line_thickness = border_side_line_thickness(side);
    if side.pattern.as_deref().unwrap_or("solid") == "double" && line_thickness > 0 {
        line_thickness * 3
    } else {
        line_thickness
    }
}

fn border_side_line_thickness(side: &BorderSide) -> i32 {
    if side.size.as_deref().unwrap_or("none") == "none" {
        0
    } else {
        side.thickness_px
            .unwrap_or_else(|| border_default_thickness(side.size.as_deref().unwrap_or("thin")))
            .max(1)
    }
}

fn node_border_edges(style: &LayoutStyle) -> EdgeInsets {
    EdgeInsets {
        top: Some(border_side_thickness(&border_side_for(style, "top"))),
        right: Some(border_side_thickness(&border_side_for(style, "right"))),
        bottom: Some(border_side_thickness(&border_side_for(style, "bottom"))),
        left: Some(border_side_thickness(&border_side_for(style, "left"))),
    }
}

fn inset_rect_by(rect: Rect, insets: &EdgeInsets) -> Rect {
    let top = edge_inset(insets, "top");
    let right = edge_inset(insets, "right");
    let bottom = edge_inset(insets, "bottom");
    let left = edge_inset(insets, "left");
    Rect {
        x: rect.x + left,
        y: rect.y + top,
        w: (rect.w - left - right).max(1),
        h: (rect.h - top - bottom).max(1),
    }
}

fn inset_rect_by_optional(rect: Rect, insets: Option<&EdgeInsets>) -> Rect {
    insets.map_or(rect, |insets| inset_rect_by(rect, insets))
}

fn add_edge_insets(left: &EdgeInsets, right: &EdgeInsets) -> EdgeInsets {
    EdgeInsets {
        top: Some(edge_inset(left, "top") + edge_inset(right, "top")),
        right: Some(edge_inset(left, "right") + edge_inset(right, "right")),
        bottom: Some(edge_inset(left, "bottom") + edge_inset(right, "bottom")),
        left: Some(edge_inset(left, "left") + edge_inset(right, "left")),
    }
}

fn horizontal_insets(insets: &EdgeInsets) -> i32 {
    edge_inset(insets, "left") + edge_inset(insets, "right")
}

fn vertical_insets(insets: &EdgeInsets) -> i32 {
    edge_inset(insets, "top") + edge_inset(insets, "bottom")
}

fn draw_border_side(
    canvas: &mut IndexedCanvas,
    frame: Rect,
    edge: &str,
    side: &BorderSide,
    color: u8,
) {
    let pattern = side.pattern.as_deref().unwrap_or("solid");
    let line_thickness = border_side_line_thickness(side);
    let total_thickness = border_side_thickness(side);
    if side.size.as_deref().unwrap_or("none") == "none"
        || total_thickness <= 0
        || frame.w <= 0
        || frame.h <= 0
    {
        return;
    }
    let horizontal = edge == "top" || edge == "bottom";
    let start = if horizontal { frame.x } else { frame.y };
    let end = if horizontal {
        frame.x + frame.w
    } else {
        frame.y + frame.h
    };
    let outer = match edge {
        "top" => frame.y,
        "bottom" => frame.y + frame.h - 1,
        "right" => frame.x + frame.w - 1,
        _ => frame.x,
    };
    for offset in 0..total_thickness {
        let fixed = if edge == "top" || edge == "left" {
            outer + offset
        } else {
            outer - offset
        };
        if pattern == "dashed" {
            for pos in start..end {
                if ((pos - start) / 4) % 2 == 0 {
                    canvas.draw_border_span(horizontal, fixed, pos, pos + 1, color);
                }
            }
        } else if pattern != "double" || offset < line_thickness || offset >= line_thickness * 2 {
            canvas.draw_border_span(horizontal, fixed, start, end, color);
        }
    }
}

fn draw_node_border(canvas: &mut IndexedCanvas, frame: Rect, style: &LayoutStyle, color: u8) {
    draw_border_side(canvas, frame, "top", &border_side_for(style, "top"), color);
    draw_border_side(
        canvas,
        frame,
        "right",
        &border_side_for(style, "right"),
        color,
    );
    draw_border_side(
        canvas,
        frame,
        "bottom",
        &border_side_for(style, "bottom"),
        color,
    );
    draw_border_side(
        canvas,
        frame,
        "left",
        &border_side_for(style, "left"),
        color,
    );
}

fn render_box_chrome(
    canvas: &mut IndexedCanvas,
    theme: &WidgetTheme,
    style: &LayoutStyle,
    frame: Rect,
) -> Rect {
    let border = node_border_edges(style);
    if should_fill_node_surface(style) {
        if let Some(fill_role) = theme.surface.fill_role {
            canvas.fill_rect(inset_rect_by(frame, &border), fill_role_color(fill_role));
        }
    }
    draw_node_border(canvas, frame, style, role_color(theme.border.color_role));
    let padding = node_padding_edges(style, None);
    inset_rect_by(frame, &add_edge_insets(&border, &padding))
}

fn unsupported_border(style: &LayoutStyle) -> bool {
    let _ = style;
    false
}

fn node_width_spec(node: &Node) -> Option<&SizeSpec> {
    match node {
        Node::Stack { width, .. } | Node::Zstack { width, .. } | Node::Grid { width, .. } => {
            width.as_ref()
        }
        Node::DataQuery(node) => node.width.as_ref(),
        Node::ForEach(node) => node.width.as_ref(),
        Node::CompoundRef(node) => node.width.as_ref(),
        Node::Script(node) => node.width.as_ref(),
        Node::IfElse(node) => node.width.as_ref(),
        Node::PrimitiveInstance { width, .. } => width.as_ref(),
        Node::Spacer { width, .. } => width.as_ref(),
        Node::Unsupported => None,
    }
}

fn node_height_spec(node: &Node) -> Option<&SizeSpec> {
    match node {
        Node::Stack { height, .. } | Node::Zstack { height, .. } | Node::Grid { height, .. } => {
            height.as_ref()
        }
        Node::DataQuery(node) => node.height.as_ref(),
        Node::ForEach(node) => node.height.as_ref(),
        Node::CompoundRef(node) => node.height.as_ref(),
        Node::Script(node) => node.height.as_ref(),
        Node::IfElse(node) => node.height.as_ref(),
        Node::PrimitiveInstance { height, .. } => height.as_ref(),
        Node::Spacer { height, .. } => height.as_ref(),
        Node::Unsupported => None,
    }
}

fn node_theme_id(node: &Node) -> Option<&str> {
    match node {
        Node::Stack { style, .. }
        | Node::Zstack { style, .. }
        | Node::Grid { style, .. }
        | Node::PrimitiveInstance { style, .. }
        | Node::Spacer { style, .. } => style.theme_id.as_deref(),
        Node::DataQuery(node) => node.style.theme_id.as_deref(),
        Node::ForEach(node) => node.style.theme_id.as_deref(),
        Node::CompoundRef(node) => node.style.theme_id.as_deref(),
        Node::Script(node) => node.style.theme_id.as_deref(),
        Node::IfElse(node) => node.style.theme_id.as_deref(),
        Node::Unsupported => None,
    }
}

fn theme_for_node<'a>(project: &'a ProjectView, style: &LayoutStyle) -> &'a WidgetTheme {
    if let Some(theme_id) = style.theme_id.as_deref() {
        if theme_id != "inherit" {
            if let Some(theme) = project.themes.iter().find(|theme| theme.id == theme_id) {
                return theme;
            }
        }
    }
    if let Some(theme_id) = project.active_theme_id.as_deref() {
        if let Some(theme) = project.themes.iter().find(|theme| theme.id == theme_id) {
            return theme;
        }
    }
    project
        .themes
        .iter()
        .find(|theme| theme.id == "classic-outline")
        .or_else(|| project.themes.first())
        .expect("theme list should not be empty")
}

fn node_supported(node: &Node) -> bool {
    match node {
        Node::Stack {
            children,
            style,
            width,
            height,
            ..
        } => {
            if unsupported_border(style) {
                return false;
            }
            if !matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if !matches!(
                height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            children.iter().all(node_supported)
        }
        Node::Zstack {
            children,
            style,
            width,
            height,
            ..
        } => {
            if unsupported_border(style) {
                return false;
            }
            if !matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if !matches!(
                height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            children.iter().all(node_supported)
        }
        Node::Grid {
            rows,
            columns,
            children,
            style,
            width,
            height,
            ..
        } => {
            if unsupported_border(style) || rows.is_empty() || columns.is_empty() {
                return false;
            }
            if !matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if !matches!(
                height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            rows.iter().all(|track| {
                matches!(
                    track.size.mode.as_deref(),
                    None | Some("fill") | Some("fixed_px") | Some("fraction")
                )
            }) && columns.iter().all(|track| {
                matches!(
                    track.size.mode.as_deref(),
                    None | Some("fill") | Some("fixed_px") | Some("fraction")
                )
            }) && children.iter().all(|child| node_supported(&child.node))
        }
        Node::DataQuery(node) => {
            if unsupported_border(&node.style)
                || !matches!(
                    node.query_kind.as_str(),
                    "calendar_events"
                        | "entity_states"
                        | "weather_forecast"
                        | "forecast"
                        | "open_meteo_forecast"
                )
            {
                return false;
            }
            matches!(
                node.width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) && matches!(
                node.height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) && node.child.as_deref().is_some_and(node_supported)
        }
        Node::ForEach(node) => {
            if unsupported_border(&node.style)
                || !matches!(node.axis.as_str(), "horizontal" | "vertical")
            {
                return false;
            }
            matches!(
                node.width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) && matches!(
                node.height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) && node.child.as_deref().is_some_and(node_supported)
        }
        Node::CompoundRef(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            matches!(
                node.width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) && matches!(
                node.height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            )
        }
        Node::Script(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            if !matches!(
                node.width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) {
                return false;
            }
            if !matches!(
                node.height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) {
                return false;
            }
            node.bindings.values().all(|value| binding_supported(value))
                && node.child.as_deref().is_some_and(node_supported)
        }
        Node::IfElse(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            if !matches!(
                node.width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) {
                return false;
            }
            if !matches!(
                node.height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")
            ) {
                return false;
            }
            node.then_child.as_deref().is_none_or(node_supported)
                && node.else_child.as_deref().is_none_or(node_supported)
        }
        Node::PrimitiveInstance {
            primitive_type,
            props,
            bindings,
            style,
            width,
            height,
            ..
        } => {
            if !matches!(
                primitive_type.as_str(),
                "text" | "number" | "line" | "icon" | "bar_chart"
            ) {
                return false;
            }
            if primitive_type == "icon"
                && font_awesome_svg_path(props.icon.as_deref().unwrap_or(DEFAULT_ICON_ID)).is_none()
            {
                return false;
            }
            if unsupported_border(style) {
                return false;
            }
            if !matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if !matches!(
                height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if props
                .text
                .as_deref()
                .is_some_and(|value| value.contains("{{") || value.contains('\n'))
            {
                if !props.text.as_deref().is_some_and(template_supported) {
                    return false;
                }
            }
            if props
                .prefix
                .as_deref()
                .is_some_and(|value| !template_supported(value))
            {
                return false;
            }
            if props
                .suffix
                .as_deref()
                .is_some_and(|value| !template_supported(value))
            {
                return false;
            }
            if props
                .unit
                .as_deref()
                .is_some_and(|value| !template_supported(value))
            {
                return false;
            }
            bindings.iter().all(|(key, value)| {
                matches!(
                    key.as_str(),
                    "entity" | "value" | "icon" | "highlightIndexes"
                ) && binding_supported(value)
            })
        }
        Node::Spacer { width, height, .. } => {
            matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction")
            ) && matches!(
                height.as_ref().and_then(|spec| spec.mode.as_deref()),
                None | Some("fill") | Some("fixed_px") | Some("fraction")
            )
        }
        Node::Unsupported => false,
    }
}

#[cfg(test)]
fn node_supported_with_project(project: &ProjectView, node: &Node) -> bool {
    if !node_supported(node) {
        return false;
    }
    match node {
        Node::Stack { children, .. } | Node::Zstack { children, .. } => children
            .iter()
            .all(|child| node_supported_with_project(project, child)),
        Node::Grid { children, .. } => children
            .iter()
            .all(|child| node_supported_with_project(project, &child.node)),
        Node::CompoundRef(node) => project
            .widget_definitions
            .iter()
            .find(|definition| definition.id == node.definition_id && definition.kind == "compound")
            .and_then(|definition| definition.root_node.as_ref())
            .is_some_and(|root| node_supported_with_project(project, root)),
        Node::DataQuery(node) => node
            .child
            .as_deref()
            .is_some_and(|child| node_supported_with_project(project, child)),
        Node::ForEach(node) => node
            .child
            .as_deref()
            .is_some_and(|child| node_supported_with_project(project, child)),
        Node::Script(node) => node
            .child
            .as_deref()
            .is_some_and(|child| node_supported_with_project(project, child)),
        Node::IfElse(node) => {
            node.then_child
                .as_deref()
                .is_none_or(|child| node_supported_with_project(project, child))
                && node
                    .else_child
                    .as_deref()
                    .is_none_or(|child| node_supported_with_project(project, child))
        }
        _ => true,
    }
}

pub(crate) fn unsupported_layout_preview_reason(project_value: &Value, body: &Value) -> String {
    let Ok(project) = serde_json::from_value::<ProjectView>(project_value.clone()) else {
        return "project JSON could not be parsed by native renderer".into();
    };
    let Some(layout_id) = body.get("layoutId").and_then(Value::as_str) else {
        return "layoutId missing".into();
    };
    let Some(layout) = project
        .layout_definitions
        .iter()
        .find(|layout| layout.id == layout_id)
    else {
        return format!("layout not found: {layout_id}");
    };
    let Some(root) = layout.root_node.as_ref() else {
        return format!("layout {layout_id} has no root node");
    };
    unsupported_node_reason(&project, root, "root")
        .map(|reason| format!("layout {layout_id} unsupported at {reason}"))
        .unwrap_or_else(|| "layout rejected by native renderer for an unknown reason".into())
}

fn unsupported_node_reason(project: &ProjectView, node: &Node, path: &str) -> Option<String> {
    let child_reason = match node {
        Node::Stack { children, .. } | Node::Zstack { children, .. } => {
            children.iter().enumerate().find_map(|(index, child)| {
                unsupported_node_reason(project, child, &format!("{path}.children[{index}]"))
            })
        }
        Node::Grid { children, .. } => children.iter().enumerate().find_map(|(index, child)| {
            unsupported_node_reason(project, &child.node, &format!("{path}.children[{index}]"))
        }),
        Node::CompoundRef(node) => {
            let Some(definition) = project.widget_definitions.iter().find(|definition| {
                definition.id == node.definition_id && definition.kind == "compound"
            }) else {
                return Some(format!(
                    "{path}: missing compound definition {}",
                    node.definition_id
                ));
            };
            let Some(root) = definition.root_node.as_ref() else {
                return Some(format!(
                    "{path}: compound {} has no root node",
                    node.definition_id
                ));
            };
            unsupported_node_reason(
                project,
                root,
                &format!("{path}.compound({})", node.definition_id),
            )
        }
        Node::DataQuery(node) => node
            .child
            .as_deref()
            .and_then(|child| unsupported_node_reason(project, child, &format!("{path}.child"))),
        Node::ForEach(node) => node
            .child
            .as_deref()
            .and_then(|child| unsupported_node_reason(project, child, &format!("{path}.template"))),
        Node::Script(node) => node
            .child
            .as_deref()
            .and_then(|child| unsupported_node_reason(project, child, &format!("{path}.child"))),
        Node::IfElse(node) => node
            .then_child
            .as_deref()
            .and_then(|child| unsupported_node_reason(project, child, &format!("{path}.then")))
            .or_else(|| {
                node.else_child.as_deref().and_then(|child| {
                    unsupported_node_reason(project, child, &format!("{path}.else"))
                })
            }),
        _ => None,
    };
    if child_reason.is_some() {
        return child_reason;
    }
    unsupported_node_self_reason(node).map(|reason| format!("{path}: {reason}"))
}

fn unsupported_node_self_reason(node: &Node) -> Option<String> {
    if node_supported(node) {
        return None;
    }
    match node {
        Node::Unsupported => Some("unknown node type".into()),
        Node::Stack { .. } | Node::Zstack { .. } | Node::Grid { .. } => None,
        Node::CompoundRef(_) => None,
        Node::IfElse(_) => None,
        Node::DataQuery(node) if unsupported_border(&node.style) => Some(format!(
            "data query {} uses unsupported border style",
            node.id
        )),
        Node::DataQuery(node)
            if !matches!(
                node.query_kind.as_str(),
                "calendar_events"
                    | "entity_states"
                    | "weather_forecast"
                    | "forecast"
                    | "open_meteo_forecast"
            ) =>
        {
            Some(format!("unsupported data query kind {}", node.query_kind))
        }
        Node::DataQuery(node) if node.child.is_none() => {
            Some(format!("data query {} has no child node", node.id))
        }
        Node::DataQuery(_) => None,
        Node::PrimitiveInstance { primitive_type, .. }
            if !matches!(
                primitive_type.as_str(),
                "text" | "number" | "line" | "icon" | "bar_chart"
            ) =>
        {
            Some(format!("unsupported primitive type {primitive_type}"))
        }
        Node::PrimitiveInstance {
            primitive_type,
            props,
            ..
        } if primitive_type == "icon"
            && font_awesome_svg_path(props.icon.as_deref().unwrap_or(DEFAULT_ICON_ID))
                .is_none() =>
        {
            Some(format!(
                "unsupported icon {}",
                props.icon.as_deref().unwrap_or(DEFAULT_ICON_ID)
            ))
        }
        Node::PrimitiveInstance {
            primitive_type,
            bindings,
            ..
        } if !bindings.keys().all(|key| {
            matches!(
                key.as_str(),
                "entity" | "value" | "icon" | "highlightIndexes"
            )
        }) =>
        {
            let keys = bindings.keys().cloned().collect::<Vec<_>>().join(", ");
            Some(format!("unsupported primitive binding keys: {keys}"))
        }
        Node::PrimitiveInstance { bindings, .. }
            if !bindings.values().all(|value| binding_supported(value)) =>
        {
            Some("unsupported primitive binding template".into())
        }
        Node::Script(node) if !node.bindings.values().all(|value| binding_supported(value)) => {
            Some(format!(
                "script {} has unsupported binding template",
                node.id
            ))
        }
        Node::Script(node) if node.child.is_none() => {
            Some(format!("script {} has no child node", node.id))
        }
        Node::ForEach(node) if node.child.is_none() => {
            Some(format!("foreach {} has no template child", node.id))
        }
        _ => Some(format!("unsupported node shape: {node:?}")),
    }
}

fn simple_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first == '_' || first == '$' || first.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn template_supported(value: &str) -> bool {
    let mut rest = value;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return false;
        };
        let expr = after[..end].trim();
        if expr.is_empty() {
            return false;
        }
        let mut segments = split_top_level(expr, '|').into_iter();
        let Some(base) = segments.next() else {
            return false;
        };
        let base = base.trim();
        if base.contains('.') {
            if !base.split('.').all(simple_identifier) {
                return false;
            }
        } else if !base.is_empty()
            && !base
                .chars()
                .all(|ch| ch == ' ' || ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
        {
            return false;
        }
        for filter in segments {
            let trimmed = filter.trim();
            if trimmed == "title"
                || trimmed == "downcase"
                || trimmed == "upcase"
                || trimmed == "to_json"
            {
                continue;
            }
            if let Some(args) = trimmed
                .strip_prefix("format(")
                .and_then(|rest| rest.strip_suffix(')'))
            {
                let arg = args.trim();
                if ((arg.starts_with('"') && arg.ends_with('"'))
                    || (arg.starts_with('\'') && arg.ends_with('\'')))
                    && arg.len() >= 2
                {
                    continue;
                }
            }
            return false;
        }
        rest = &after[end + 2..];
    }
    true
}

fn binding_supported(value: &str) -> bool {
    template_supported(value)
}

fn split_top_level(input: &str, separator: char) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut paren_depth = 0i32;
    let mut brace_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut quote: Option<char> = None;
    let chars: Vec<char> = input.chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        if let Some(active) = quote {
            current.push(ch);
            if ch == '\\' && index + 1 < chars.len() {
                index += 1;
                current.push(chars[index]);
            } else if ch == active {
                quote = None;
            }
            index += 1;
            continue;
        }
        match ch {
            '"' | '\'' => {
                quote = Some(ch);
                current.push(ch);
            }
            '(' => {
                paren_depth += 1;
                current.push(ch);
            }
            ')' => {
                paren_depth -= 1;
                current.push(ch);
            }
            '{' => {
                brace_depth += 1;
                current.push(ch);
            }
            '}' => {
                brace_depth -= 1;
                current.push(ch);
            }
            '[' => {
                bracket_depth += 1;
                current.push(ch);
            }
            ']' => {
                bracket_depth -= 1;
                current.push(ch);
            }
            _ if ch == separator && paren_depth == 0 && brace_depth == 0 && bracket_depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
        index += 1;
    }
    parts.push(current.trim().to_string());
    parts
}

fn stringify_scope_value(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(boolean) => boolean.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn normalize_query_items(query_kind: &str, items: Value) -> Value {
    if query_kind == "weather_forecast"
        || query_kind == "forecast"
        || query_kind == "open_meteo_forecast"
    {
        if let Some(first) = items.as_array().and_then(|items| items.first()).cloned() {
            return first;
        }
    }
    items
}

fn quantize_number(value: f64, step: f64) -> f64 {
    if !value.is_finite() || step <= 0.0 {
        return value;
    }
    (value / step).round() * step
}

fn format_quantized_number(value: &str, step: f64, digits: Option<i32>) -> String {
    let Ok(numeric) = value.trim().parse::<f64>() else {
        return "--".into();
    };
    if !numeric.is_finite() {
        return "--".into();
    }
    let quantized = quantize_number(numeric, step);
    if let Some(digits) = digits {
        return format!("{:.*}", digits.max(0) as usize, quantized);
    }
    if step.abs() < 1.0 {
        let inferred_digits = step
            .to_string()
            .split('.')
            .nth(1)
            .map(|fraction| fraction.len())
            .unwrap_or(0);
        return format!("{:.*}", inferred_digits, quantized);
    }
    quantized.to_string()
}

fn format_date_part(
    date: chrono::DateTime<chrono::Utc>,
    locale: &str,
    options: chrono::format::StrftimeItems<'_>,
) -> String {
    let _ = locale;
    date.format_with_items(options).to_string()
}

fn locale_is_dutch(locale: &str) -> bool {
    locale.to_ascii_lowercase().starts_with("nl")
}

fn localized_weekday_name(weekday: chrono::Weekday, locale: &str, short: bool) -> &'static str {
    if locale_is_dutch(locale) {
        match (weekday, short) {
            (chrono::Weekday::Mon, false) => "maandag",
            (chrono::Weekday::Tue, false) => "dinsdag",
            (chrono::Weekday::Wed, false) => "woensdag",
            (chrono::Weekday::Thu, false) => "donderdag",
            (chrono::Weekday::Fri, false) => "vrijdag",
            (chrono::Weekday::Sat, false) => "zaterdag",
            (chrono::Weekday::Sun, false) => "zondag",
            (chrono::Weekday::Mon, true) => "ma",
            (chrono::Weekday::Tue, true) => "di",
            (chrono::Weekday::Wed, true) => "wo",
            (chrono::Weekday::Thu, true) => "do",
            (chrono::Weekday::Fri, true) => "vr",
            (chrono::Weekday::Sat, true) => "za",
            (chrono::Weekday::Sun, true) => "zo",
        }
    } else {
        match (weekday, short) {
            (chrono::Weekday::Mon, false) => "Monday",
            (chrono::Weekday::Tue, false) => "Tuesday",
            (chrono::Weekday::Wed, false) => "Wednesday",
            (chrono::Weekday::Thu, false) => "Thursday",
            (chrono::Weekday::Fri, false) => "Friday",
            (chrono::Weekday::Sat, false) => "Saturday",
            (chrono::Weekday::Sun, false) => "Sunday",
            (chrono::Weekday::Mon, true) => "Mon",
            (chrono::Weekday::Tue, true) => "Tue",
            (chrono::Weekday::Wed, true) => "Wed",
            (chrono::Weekday::Thu, true) => "Thu",
            (chrono::Weekday::Fri, true) => "Fri",
            (chrono::Weekday::Sat, true) => "Sat",
            (chrono::Weekday::Sun, true) => "Sun",
        }
    }
}

fn localized_month_name(month: u32, locale: &str, short: bool) -> &'static str {
    if locale_is_dutch(locale) {
        match (month, short) {
            (1, false) => "januari",
            (2, false) => "februari",
            (3, false) => "maart",
            (4, false) => "april",
            (5, false) => "mei",
            (6, false) => "juni",
            (7, false) => "juli",
            (8, false) => "augustus",
            (9, false) => "september",
            (10, false) => "oktober",
            (11, false) => "november",
            (12, false) => "december",
            (1, true) => "jan",
            (2, true) => "feb",
            (3, true) => "mrt",
            (4, true) => "apr",
            (5, true) => "mei",
            (6, true) => "jun",
            (7, true) => "jul",
            (8, true) => "aug",
            (9, true) => "sep",
            (10, true) => "okt",
            (11, true) => "nov",
            (12, true) => "dec",
            _ => "",
        }
    } else {
        match (month, short) {
            (1, false) => "January",
            (2, false) => "February",
            (3, false) => "March",
            (4, false) => "April",
            (5, false) => "May",
            (6, false) => "June",
            (7, false) => "July",
            (8, false) => "August",
            (9, false) => "September",
            (10, false) => "October",
            (11, false) => "November",
            (12, false) => "December",
            (1, true) => "Jan",
            (2, true) => "Feb",
            (3, true) => "Mar",
            (4, true) => "Apr",
            (5, true) => "May",
            (6, true) => "Jun",
            (7, true) => "Jul",
            (8, true) => "Aug",
            (9, true) => "Sep",
            (10, true) => "Oct",
            (11, true) => "Nov",
            (12, true) => "Dec",
            _ => "",
        }
    }
}

fn parse_date_like_parts(value: &Value, locale: &str) -> Option<HashMap<String, String>> {
    if let Some(object) = value.as_object() {
        for key in [
            "dateTime",
            "datetime",
            "date",
            "iso",
            "value",
            "start",
            "start_time",
        ] {
            if let Some(nested) = object.get(key) {
                if let Some(parts) = parse_date_like_parts(nested, locale) {
                    return Some(parts);
                }
            }
        }
    }
    let text = match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    let mut parts = HashMap::new();
    if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&text) {
        parts.insert(
            "dddd".into(),
            localized_weekday_name(parsed.weekday(), locale, false).into(),
        );
        parts.insert(
            "ddd".into(),
            localized_weekday_name(parsed.weekday(), locale, true).into(),
        );
        parts.insert(
            "mmmm".into(),
            localized_month_name(parsed.month(), locale, false).into(),
        );
        parts.insert(
            "mmm".into(),
            localized_month_name(parsed.month(), locale, true).into(),
        );
        parts.insert("yyyy".into(), parsed.format("%Y").to_string());
        parts.insert("yy".into(), parsed.format("%y").to_string());
        parts.insert("mm".into(), format!("{:02}", parsed.month()));
        parts.insert("m".into(), parsed.month().to_string());
        parts.insert("dd".into(), format!("{:02}", parsed.day()));
        parts.insert("d".into(), parsed.day().to_string());
        parts.insert("HH".into(), format!("{:02}", parsed.hour()));
        parts.insert("H".into(), parsed.hour().to_string());
        let hour12 = parsed.hour12().1;
        parts.insert("hh".into(), format!("{:02}", hour12));
        parts.insert("h".into(), hour12.to_string());
        parts.insert("MM".into(), format!("{:02}", parsed.minute()));
        parts.insert("M".into(), parsed.minute().to_string());
        parts.insert("ss".into(), format!("{:02}", parsed.second()));
        parts.insert("s".into(), parsed.second().to_string());
        return Some(parts);
    }
    if let Ok(parsed) = chrono::NaiveDate::parse_from_str(&text, "%Y-%m-%d") {
        parts.insert(
            "dddd".into(),
            localized_weekday_name(parsed.weekday(), locale, false).into(),
        );
        parts.insert(
            "ddd".into(),
            localized_weekday_name(parsed.weekday(), locale, true).into(),
        );
        parts.insert(
            "mmmm".into(),
            localized_month_name(parsed.month(), locale, false).into(),
        );
        parts.insert(
            "mmm".into(),
            localized_month_name(parsed.month(), locale, true).into(),
        );
        parts.insert("yyyy".into(), parsed.format("%Y").to_string());
        parts.insert("yy".into(), parsed.format("%y").to_string());
        parts.insert("mm".into(), format!("{:02}", parsed.month()));
        parts.insert("m".into(), parsed.month().to_string());
        parts.insert("dd".into(), format!("{:02}", parsed.day()));
        parts.insert("d".into(), parsed.day().to_string());
        parts.insert("HH".into(), "00".into());
        parts.insert("H".into(), "0".into());
        parts.insert("hh".into(), "12".into());
        parts.insert("h".into(), "12".into());
        parts.insert("MM".into(), "00".into());
        parts.insert("M".into(), "0".into());
        parts.insert("ss".into(), "00".into());
        parts.insert("s".into(), "0".into());
        return Some(parts);
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts)
}

fn render_date_pattern(pattern: &str, parts: &HashMap<String, String>) -> String {
    let tokens = [
        "dddd", "mmmm", "yyyy", "ddd", "mmm", "yy", "HH", "hh", "MM", "ss", "mm", "dd", "H", "h",
        "M", "s", "m", "d",
    ];
    let mut out = String::new();
    let mut index = 0usize;
    while index < pattern.len() {
        let remainder = &pattern[index..];
        if let Some(token) = tokens.iter().find(|token| remainder.starts_with(**token)) {
            out.push_str(parts.get(*token).map(String::as_str).unwrap_or(token));
            index += token.len();
            continue;
        }
        let mut chars = remainder.chars();
        let ch = chars.next().unwrap();
        out.push(ch);
        index += ch.len_utf8();
    }
    out
}

fn format_scope_value(value: &Value, pattern: &str, locale: &str) -> Value {
    let _ = format_date_part; // keep helper anchored
    let Some(parts) = parse_date_like_parts(value, locale) else {
        return value.clone();
    };
    Value::String(render_date_pattern(pattern, &parts))
}

fn title_case(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str().to_lowercase()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn apply_template_filter(value: Value, filter_expression: &str, locale: &str) -> Value {
    let trimmed = filter_expression.trim();
    if trimmed == "title" {
        return Value::String(title_case(&stringify_scope_value(&value)));
    }
    if trimmed == "downcase" {
        return Value::String(stringify_scope_value(&value).to_lowercase());
    }
    if trimmed == "upcase" {
        return Value::String(stringify_scope_value(&value).to_uppercase());
    }
    if trimmed == "to_json" {
        return Value::String(serde_json::to_string(&value).unwrap_or_else(|_| "null".into()));
    }
    if let Some(args) = trimmed
        .strip_prefix("format(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        let pattern = args.trim().trim_matches('"').trim_matches('\'');
        return format_scope_value(&value, pattern, locale);
    }
    value
}

fn resolve_scope_or_literal_expression(expression: &str, scope: &Value, locale: &str) -> Value {
    let trimmed = expression.trim();
    if trimmed.is_empty() {
        return Value::Null;
    }
    if (trimmed.starts_with('[') && trimmed.ends_with(']'))
        || (trimmed.starts_with('{') && trimmed.ends_with('}'))
    {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return value;
        }
    }
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        return Value::String(trimmed[1..trimmed.len() - 1].to_string());
    }
    if trimmed == "true" {
        return Value::Bool(true);
    }
    if trimmed == "false" {
        return Value::Bool(false);
    }
    if let Ok(number) = trimmed.parse::<f64>() {
        if let Some(number) = serde_json::Number::from_f64(number) {
            return Value::Number(number);
        }
    }
    let segments = split_top_level(trimmed, '|');
    let base = segments
        .first()
        .map(String::as_str)
        .unwrap_or(trimmed)
        .trim();
    let mut current = scope_value(scope, base).unwrap_or(Value::Null);
    for segment in segments.into_iter().skip(1) {
        current = apply_template_filter(current, &segment, locale);
    }
    if current.is_null() && !trimmed.contains('|') {
        if let Ok(value) = evaluate_js_value(trimmed, scope) {
            return value;
        }
    }
    current
}

fn scope_value(scope: &Value, path: &str) -> Option<Value> {
    if let Some(object) = scope.as_object() {
        if let Some(value) = object.get(path) {
            return Some(value.clone());
        }
    }
    let mut current = scope;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current.clone())
}

fn render_template(value: &str, scope: &Value, locale: &str) -> Option<String> {
    if !value.contains("{{") {
        return Some(value.to_string());
    }
    if !template_supported(value) {
        return None;
    }
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find("}}")?;
        let expr = after[..end].trim();
        let resolved = resolve_scope_or_literal_expression(expr, scope, locale);
        match resolved {
            Value::Null => {}
            Value::String(text) => out.push_str(&text),
            other => out.push_str(&stringify_scope_value(&other)),
        }
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Some(out)
}

fn merge_scope(scope: &Value, derived: &Value) -> Value {
    let mut merged = scope.clone();
    if let (Some(scope_object), Some(derived_object)) =
        (merged.as_object_mut(), derived.as_object())
    {
        for (key, value) in derived_object {
            scope_object.insert(key.clone(), value.clone());
        }
    }
    merged
}

fn build_array_item_scope(
    scope: &Value,
    value: &Value,
    index: usize,
    item_alias: &str,
    index_alias: &str,
) -> Value {
    let mut next = scope.clone();
    if let Some(object) = next.as_object_mut() {
        object.insert("$".into(), value.clone());
        object.insert("item".into(), value.clone());
        object.insert("index".into(), Value::Number(index.into()));
        object.insert(item_alias.to_string(), value.clone());
        object.insert(index_alias.to_string(), Value::Number(index.into()));
    }
    next
}

fn evaluate_array_expression(
    expression: &str,
    scope: &Value,
    locale: &str,
    item_alias: &str,
    index_alias: &str,
) -> Vec<Value> {
    let segments = split_top_level(expression, '|');
    let base = segments.first().cloned().unwrap_or_default();
    let mut current = match resolve_scope_or_literal_expression(&base, scope, locale) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    for stage in segments.into_iter().skip(1) {
        let trimmed = stage.trim();
        if let Some(condition) = trimmed
            .strip_prefix("filter(")
            .and_then(|rest| rest.strip_suffix(')'))
        {
            current = current
                .into_iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let item_scope =
                        build_array_item_scope(scope, &value, index, item_alias, index_alias);
                    match evaluate_js_bool(condition, &item_scope) {
                        Ok(true) => Some(value),
                        _ => None,
                    }
                })
                .collect();
            continue;
        }
        if let Some(template_expr) = trimmed
            .strip_prefix("unique_by(")
            .and_then(|rest| rest.strip_suffix(')'))
        {
            let template = match resolve_scope_or_literal_expression(template_expr, scope, locale) {
                Value::String(text) => text,
                other => stringify_scope_value(&other),
            };
            let mut seen = std::collections::HashSet::new();
            current = current
                .into_iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let item_scope =
                        build_array_item_scope(scope, &value, index, item_alias, index_alias);
                    let key = render_template(&template, &item_scope, locale).unwrap_or_default();
                    if seen.insert(key) {
                        Some(value)
                    } else {
                        None
                    }
                })
                .collect();
        }
    }
    current
}

fn globals_value(project: &ProjectView, data: &Value, frame: Rect) -> Value {
    let now = data
        .get("now")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| chrono::Local::now().to_rfc3339());
    let today = now.get(..10).unwrap_or("").to_string();
    json!({
        "now": now,
        "today": today,
        "locale": if project.locale.is_empty() { "en-US" } else { &project.locale },
        "display": {
            "id": "",
            "width": frame.w,
            "height": frame.h,
            "rotation": 0,
        },
        "project": {
            "id": project.id,
            "name": project.name,
        }
    })
}

fn scope_declarations(scope: &Value) -> String {
    let mut declarations = String::new();
    if let Some(object) = scope.as_object() {
        for key in object.keys().filter(|key| simple_identifier(key)) {
            declarations.push_str("const ");
            declarations.push_str(key);
            declarations.push_str(" = scope[");
            declarations.push_str(&serde_json::to_string(key).unwrap_or_else(|_| "\"\"".into()));
            declarations.push_str("];\n");
        }
    }
    declarations
}

fn run_js_json(
    script: &str,
    scope: &Value,
    bindings: &Value,
    globals: &Value,
) -> Result<Value, ApiError> {
    let mut context = BoaContext::default();
    let scope_json =
        serde_json::to_string(scope).map_err(|error| ApiError::internal(error.to_string()))?;
    let bindings_json =
        serde_json::to_string(bindings).map_err(|error| ApiError::internal(error.to_string()))?;
    let globals_json =
        serde_json::to_string(globals).map_err(|error| ApiError::internal(error.to_string()))?;
    let source = format!(
        "(function(){{ const scope = {scope_json}; const bindings = {bindings_json}; const globals = {globals_json}; const locale = globals.locale; const shared = {{}}; const helpers = {{}}; function warn(_msg){{}}; {decls} return JSON.stringify((function(){{ {script} }})()); }})()",
        decls = scope_declarations(scope)
    );
    let value = context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let text = value
        .to_string(&mut context)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .to_std_string_escaped();
    serde_json::from_str(&text).map_err(|error| ApiError::internal(error.to_string()))
}

fn evaluate_js_bool(expression: &str, scope: &Value) -> Result<bool, ApiError> {
    let mut context = BoaContext::default();
    let scope_json =
        serde_json::to_string(scope).map_err(|error| ApiError::internal(error.to_string()))?;
    let source = format!(
        "(function(){{ const scope = {scope_json}; {decls} return Boolean({expression}); }})()",
        decls = scope_declarations(scope)
    );
    let value = context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(value.to_boolean())
}

fn evaluate_js_value(expression: &str, scope: &Value) -> Result<Value, ApiError> {
    let mut context = BoaContext::default();
    let scope_json =
        serde_json::to_string(scope).map_err(|error| ApiError::internal(error.to_string()))?;
    let source = format!(
        "(function(){{ const scope = {scope_json}; {decls} return JSON.stringify({expression}); }})()",
        decls = scope_declarations(scope)
    );
    let value = context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let text = value
        .to_string(&mut context)
        .map_err(|error| ApiError::internal(error.to_string()))?
        .to_std_string_escaped();
    serde_json::from_str(&text).map_err(|error| ApiError::internal(error.to_string()))
}

fn text_run(
    text: &str,
    family: &str,
    weight: &str,
    slope: &str,
    pixel_size: u32,
    tabular: bool,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<TextLayoutRun>, ApiError> {
    let Some(family_data) = resolve_font_family_data(family, user_fonts) else {
        return Ok(None);
    };
    let run = render_text_layout(LayoutRequest {
        op: "layout".into(),
        text: text.into(),
        style: EngineTextStyle {
            family: family.into(),
            weight: weight.into(),
            slope: slope.into(),
            size: "normal".into(),
            tabular_numbers: Some(tabular),
            pixel_size: Some(pixel_size),
            bypass_allowed_pixel_sizes: Some(true),
        },
        font_presets: EngineFontPresets {
            tiny: presets.tiny,
            normal: presets.normal,
            header: presets.header,
        },
        font_family_data: EngineFontFamilyData {
            regular: family_data.regular.clone(),
            italic: family_data.italic.clone(),
            bold: family_data.bold.clone(),
            bold_italic: family_data.bold_italic.clone(),
            variants: runtime_font_variants(&family_data),
        },
        render_mode: "mono_hint".into(),
        threshold: 128,
        oversample_factor: 1,
    })
    .map_err(ApiError::internal)?;
    Ok(Some(run))
}

fn theme_font_role<'a>(theme: &'a WidgetTheme, role: &str) -> Option<&'a PartialTextStyle> {
    match role {
        "tiny" => theme
            .font_roles
            .as_ref()
            .and_then(|roles| roles.tiny.as_ref()),
        "header" => theme
            .font_roles
            .as_ref()
            .and_then(|roles| roles.header.as_ref()),
        "normalEmphasis" => theme
            .font_roles
            .as_ref()
            .and_then(|roles| roles.normal_emphasis.as_ref()),
        _ => theme
            .font_roles
            .as_ref()
            .and_then(|roles| roles.normal.as_ref()),
    }
}

#[derive(Clone, Copy)]
struct PaintedBounds {
    min_x: i32,
    min_y: i32,
    width: i32,
    height: i32,
}

fn painted_bounds(run: &TextLayoutRun) -> PaintedBounds {
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    for glyph in &run.glyphs {
        if glyph.width <= 0 || glyph.height <= 0 {
            continue;
        }
        min_x = min_x.min(glyph.x);
        min_y = min_y.min(glyph.y);
        max_x = max_x.max(glyph.x + glyph.width);
        max_y = max_y.max(glyph.y + glyph.height);
    }
    if min_x == i32::MAX {
        return PaintedBounds {
            min_x: 0,
            min_y: 0,
            width: 1,
            height: 1,
        };
    }
    PaintedBounds {
        min_x,
        min_y,
        width: (max_x - min_x).max(1),
        height: (max_y - min_y).max(1),
    }
}

fn text_width(
    text: &str,
    family: &str,
    weight: &str,
    slope: &str,
    pixel_size: u32,
    tabular: bool,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<i32, ApiError> {
    Ok(text_run(
        text, family, weight, slope, pixel_size, tabular, presets, user_fonts,
    )?
    .map(|run| painted_bounds(&run).width)
    .unwrap_or(0))
}

fn truncate_text_to_width(
    text: &str,
    suffix: &str,
    max_width: i32,
    spec: &PrimitiveTextSpec,
    pixel_size: u32,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<String, ApiError> {
    if max_width <= 0 {
        return Ok(String::new());
    }
    if text_width(
        text,
        &spec.family,
        &spec.weight,
        &spec.slope,
        pixel_size,
        spec.tabular,
        presets,
        user_fonts,
    )? <= max_width
    {
        return Ok(text.to_string());
    }
    let suffix_width = if suffix.is_empty() {
        0
    } else {
        text_width(
            suffix,
            &spec.family,
            &spec.weight,
            &spec.slope,
            pixel_size,
            spec.tabular,
            presets,
            user_fonts,
        )?
    };
    if suffix_width > max_width {
        return truncate_text_to_width("", "", max_width, spec, pixel_size, presets, user_fonts);
    }
    let mut chars = text.chars().collect::<Vec<_>>();
    while !chars.is_empty() {
        let candidate = chars.iter().collect::<String>() + suffix;
        if text_width(
            &candidate,
            &spec.family,
            &spec.weight,
            &spec.slope,
            pixel_size,
            spec.tabular,
            presets,
            user_fonts,
        )? <= max_width
        {
            return Ok(candidate);
        }
        chars.pop();
    }
    Ok(suffix.to_string())
}

fn wrap_word_by_character(
    word: &str,
    max_width: i32,
    spec: &PrimitiveTextSpec,
    pixel_size: u32,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Vec<String>, ApiError> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for ch in word.chars() {
        let next = format!("{current}{ch}");
        if current.is_empty()
            || text_width(
                &next,
                &spec.family,
                &spec.weight,
                &spec.slope,
                pixel_size,
                spec.tabular,
                presets,
                user_fonts,
            )? <= max_width
        {
            current = next;
            continue;
        }
        lines.push(current);
        current = ch.to_string();
    }
    if !current.is_empty() {
        lines.push(current);
    }
    Ok(if lines.is_empty() {
        vec![word.to_string()]
    } else {
        lines
    })
}

fn layout_text_lines(
    spec: &PrimitiveTextSpec,
    pixel_size: u32,
    max_width: i32,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Vec<String>, ApiError> {
    let overflow = spec.overflow.as_str();
    if overflow != "wrap" {
        let suffix = if overflow == "ellipsis" { "..." } else { "" };
        return spec
            .text
            .split('\n')
            .map(|line| {
                truncate_text_to_width(
                    line, suffix, max_width, spec, pixel_size, presets, user_fonts,
                )
            })
            .collect();
    }
    let mut lines = Vec::new();
    for paragraph in spec.text.split('\n') {
        let words = paragraph.split_whitespace().collect::<Vec<_>>();
        if words.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for word in words {
            let candidate = if current.is_empty() {
                word.to_string()
            } else {
                format!("{current} {word}")
            };
            if current.is_empty()
                || text_width(
                    &candidate,
                    &spec.family,
                    &spec.weight,
                    &spec.slope,
                    pixel_size,
                    spec.tabular,
                    presets,
                    user_fonts,
                )? <= max_width
            {
                current = candidate;
                continue;
            }
            lines.push(current);
            if text_width(
                word,
                &spec.family,
                &spec.weight,
                &spec.slope,
                pixel_size,
                spec.tabular,
                presets,
                user_fonts,
            )? <= max_width
            {
                current = word.to_string();
            } else {
                let broken =
                    wrap_word_by_character(word, max_width, spec, pixel_size, presets, user_fonts)?;
                lines.extend(broken.iter().take(broken.len().saturating_sub(1)).cloned());
                current = broken.last().cloned().unwrap_or_default();
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    Ok(if lines.is_empty() {
        vec![spec.text.clone()]
    } else {
        lines
    })
}

struct TextLineRun {
    run: TextLayoutRun,
    bounds: PaintedBounds,
}

fn text_line_runs(
    spec: &PrimitiveTextSpec,
    pixel_size: u32,
    frame_width: i32,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Vec<TextLineRun>, ApiError> {
    let lines = layout_text_lines(spec, pixel_size, frame_width, presets, user_fonts)?;
    let mut runs = Vec::new();
    for line in lines {
        let Some(run) = text_run(
            &line,
            &spec.family,
            &spec.weight,
            &spec.slope,
            pixel_size,
            spec.tabular,
            presets,
            user_fonts,
        )?
        else {
            continue;
        };
        let bounds = painted_bounds(&run);
        runs.push(TextLineRun { run, bounds });
    }
    Ok(runs)
}

fn text_lines_block_size(runs: &[TextLineRun], line_spacing_px: i32) -> (i32, i32) {
    let width = runs
        .iter()
        .map(|line| line.bounds.width)
        .max()
        .unwrap_or(1)
        .max(1);
    let height = runs
        .iter()
        .enumerate()
        .map(|(index, line)| {
            line.bounds.height
                + if index + 1 < runs.len() {
                    line_spacing_px.max(0)
                } else {
                    0
                }
        })
        .sum::<i32>()
        .max(1);
    (width, height)
}

fn auto_fit_pixel_size(
    spec: &PrimitiveTextSpec,
    frame: Rect,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<u32>, ApiError> {
    let mut low = 4u32;
    let mut high = frame.h.max(4) as u32;
    let mut best = None;
    while low <= high {
        let mid = low + (high - low) / 2;
        let runs = text_line_runs(spec, mid, frame.w, presets, user_fonts)?;
        if runs.is_empty() {
            return Ok(None);
        }
        let (w, h) = text_lines_block_size(&runs, spec.line_spacing_px);
        if w <= frame.w && h + spec.top_padding_px.max(0) <= frame.h {
            best = Some(mid);
            low = mid.saturating_add(1);
        } else if mid == 0 {
            break;
        } else {
            high = mid.saturating_sub(1);
        }
    }
    Ok(best)
}

fn entity_state_text(data: &Value, entity_id: &str) -> String {
    data.get("entities")
        .and_then(|entities| entities.get(entity_id))
        .and_then(|entity| entity.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn bound_entity_text(data: &Value, rendered_binding: &str) -> String {
    let resolved = entity_state_text(data, rendered_binding);
    if resolved.is_empty() {
        rendered_binding.to_string()
    } else {
        resolved
    }
}

fn binding_scope_value(scope: &Value, binding: Option<&String>, locale: &str) -> Option<Value> {
    let raw = binding?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.contains("{{") {
        return render_template(raw, scope, locale).map(Value::String);
    }
    if let Some(resolved) = scope_value(scope, raw) {
        return Some(resolved);
    }
    let resolved = resolve_scope_or_literal_expression(raw, scope, locale);
    if !resolved.is_null() {
        return Some(resolved);
    }
    Some(Value::String(raw.to_string()))
}

fn binding_scope_text(scope: &Value, binding: Option<&String>, locale: &str) -> Option<String> {
    binding_scope_value(scope, binding, locale).map(|value| stringify_scope_value(&value))
}

fn numeric_chart_value(item: &Value, value_key: &str) -> Option<f64> {
    match item {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse::<f64>().ok(),
        Value::Object(object) => object.get(value_key).and_then(|value| match value {
            Value::Number(number) => number.as_f64(),
            Value::String(text) => text.parse::<f64>().ok(),
            _ => None,
        }),
        _ => None,
    }
    .filter(|value| value.is_finite())
}

#[derive(Clone, Copy, Debug)]
struct BarChartDatum {
    value: f64,
    highlighted: bool,
}

fn truthy_chart_flag(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(value)) => value
            .as_f64()
            .is_some_and(|value| value.is_finite() && value != 0.0),
        Some(Value::String(value)) => matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        _ => false,
    }
}

fn highlighted_indexes(
    scope: &Value,
    bindings: &HashMap<String, String>,
    locale: &str,
) -> std::collections::HashSet<usize> {
    let Some(Value::Array(items)) =
        binding_scope_value(scope, bindings.get("highlightIndexes"), locale)
    else {
        return std::collections::HashSet::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            Value::Number(value) => value.as_u64().map(|value| value as usize),
            Value::String(value) => value.trim().parse::<usize>().ok(),
            _ => None,
        })
        .collect()
}

fn bar_chart_data(
    scope: &Value,
    bindings: &HashMap<String, String>,
    props: &WidgetProps,
    locale: &str,
) -> Vec<BarChartDatum> {
    let Some(Value::Array(items)) = binding_scope_value(scope, bindings.get("value"), locale)
    else {
        return Vec::new();
    };
    let value_key = props.value_key.as_deref().unwrap_or("value").trim();
    let value_key = if value_key.is_empty() {
        "value"
    } else {
        value_key
    };
    let highlight_key = props.highlight_key.as_deref().unwrap_or("highlight").trim();
    let highlight_key = if highlight_key.is_empty() {
        "highlight"
    } else {
        highlight_key
    };
    let highlighted_indexes = highlighted_indexes(scope, bindings, locale);
    items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let value = numeric_chart_value(item, value_key)?;
            let object_highlight = match item {
                Value::Object(object) => truthy_chart_flag(object.get(highlight_key)),
                _ => false,
            };
            Some(BarChartDatum {
                value,
                highlighted: highlighted_indexes.contains(&index) || object_highlight,
            })
        })
        .collect()
}

fn draw_bar_chart(
    canvas: &mut IndexedCanvas,
    frame: Rect,
    data: &[BarChartDatum],
    props: &WidgetProps,
) {
    if data.is_empty() || frame.w <= 0 || frame.h <= 0 {
        return;
    }
    let color = fill_role_color(props.color_role.unwrap_or(FillRole::Accent));
    let highlight_color = fill_role_color(props.highlight_color_role.unwrap_or(FillRole::Fg));
    let auto_min = data.iter().map(|entry| entry.value).fold(0.0_f64, f64::min);
    let auto_max = data.iter().map(|entry| entry.value).fold(0.0_f64, f64::max);
    let mut min = props
        .min_value
        .filter(|value| value.is_finite())
        .unwrap_or(auto_min);
    let mut max = props
        .max_value
        .filter(|value| value.is_finite())
        .unwrap_or(auto_max);
    if (max - min).abs() < f64::EPSILON {
        min -= 1.0;
        max += 1.0;
    }
    let range = (max - min).max(0.000001);
    let baseline = props.baseline_value.unwrap_or(0.0).clamp(min, max);
    let gap = props.bar_gap_px.unwrap_or(1).max(0);
    if props.bar_orientation.as_deref() == Some("horizontal") {
        let slot = ((frame.h + gap) / data.len() as i32).max(1);
        let bar_h = (slot - gap).max(1);
        let base_x =
            frame.x + (((baseline - min) / range) * (frame.w - 1).max(0) as f64).round() as i32;
        for (index, entry) in data.iter().enumerate() {
            let clamped = entry.value.clamp(min, max);
            let target_x =
                frame.x + (((clamped - min) / range) * (frame.w - 1).max(0) as f64).round() as i32;
            let x = base_x.min(target_x);
            let w = (target_x - base_x).abs() + 1;
            let y = frame.y + index as i32 * slot;
            let h = bar_h.min(frame.y + frame.h - y).max(0);
            if h == 0 {
                continue;
            }
            canvas.fill_rect(
                Rect { x, y, w, h },
                if entry.highlighted {
                    highlight_color
                } else {
                    color
                },
            );
        }
        return;
    }
    let slot = ((frame.w + gap) / data.len() as i32).max(1);
    let bar_w = (slot - gap).max(1);
    let base_y = frame.y + frame.h
        - 1
        - (((baseline - min) / range) * (frame.h - 1).max(0) as f64).round() as i32;
    for (index, entry) in data.iter().enumerate() {
        let clamped = entry.value.clamp(min, max);
        let target_y = frame.y + frame.h
            - 1
            - (((clamped - min) / range) * (frame.h - 1).max(0) as f64).round() as i32;
        let y = base_y.min(target_y);
        let h = (target_y - base_y).abs() + 1;
        let x = frame.x + index as i32 * slot;
        let w = bar_w.min(frame.x + frame.w - x).max(0);
        if w == 0 {
            continue;
        }
        canvas.fill_rect(
            Rect { x, y, w, h },
            if entry.highlighted {
                highlight_color
            } else {
                color
            },
        );
    }
}

fn draw_text_run(
    canvas: &mut IndexedCanvas,
    run: &TextLayoutRun,
    x: i32,
    y: i32,
    color: u8,
    clip: Rect,
) {
    for glyph in &run.glyphs {
        for (gy, row) in glyph.pixels.iter().enumerate() {
            for (gx, pixel) in row.iter().enumerate() {
                if *pixel != 0 {
                    let px = x + glyph.x + gx as i32;
                    let py = y + glyph.y + gy as i32;
                    if px >= clip.x && py >= clip.y && px < clip.x + clip.w && py < clip.y + clip.h
                    {
                        canvas.set_pixel(px, py, color);
                    }
                }
            }
        }
    }
}

struct PrimitiveTextSpec {
    text: String,
    family: String,
    weight: String,
    slope: String,
    color: u8,
    tabular: bool,
    default_px: u32,
    h_align: String,
    v_align: String,
    padding: i32,
    line_spacing_px: i32,
    top_padding_px: i32,
    overflow: String,
}

fn primitive_render_spec(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<PrimitiveTextSpec>, ApiError> {
    let Node::PrimitiveInstance {
        primitive_type,
        props,
        bindings,
        style,
        ..
    } = node
    else {
        return Ok(None);
    };
    let theme = theme_for_node(project, style);
    let padding = node_padding(style, props.padding_px);
    let font_role = props
        .font_role
        .as_deref()
        .unwrap_or(if primitive_type == "number" {
            "header"
        } else {
            "normal"
        });
    let role_style = theme_font_role(theme, font_role);
    let spec = if primitive_type == "text" {
        let effective_color_role =
            if font_role == "normalEmphasis" && theme.surface.fill_role.is_some() {
                theme.text.body
            } else {
                role_style
                    .and_then(|style| style.color_role)
                    .unwrap_or(theme.text.body)
            };
        let text = if props.render_entity_state.unwrap_or(false) {
            binding_scope_text(scope, bindings.get("value"), &project.locale)
                .or_else(|| {
                    bindings
                        .get("entity")
                        .map(|entity_id| {
                            render_template(entity_id, scope, &project.locale)
                                .unwrap_or_else(|| entity_id.clone())
                        })
                        .map(|entity_id| bound_entity_text(scope, &entity_id))
                })
                .unwrap_or_default()
        } else {
            binding_scope_text(scope, bindings.get("value"), &project.locale)
                .or_else(|| {
                    props
                        .text
                        .as_deref()
                        .and_then(|value| render_template(value, scope, &project.locale))
                })
                .unwrap_or_default()
        };
        PrimitiveTextSpec {
            text,
            family: role_style
                .and_then(|style| style.family.clone())
                .or_else(|| theme.auto_fit_font_family.clone())
                .unwrap_or_else(|| "arial".into()),
            weight: role_style
                .and_then(|style| style.weight.clone())
                .unwrap_or_else(|| "regular".into()),
            slope: role_style
                .and_then(|style| style.slope.clone())
                .unwrap_or_else(|| "roman".into()),
            color: contrasted_text_color(theme, role_color(effective_color_role), theme.text.body),
            tabular: false,
            default_px: role_style
                .and_then(|style| style.pixel_size)
                .unwrap_or(project.font_presets.normal),
            h_align: props
                .horizontal_align
                .as_deref()
                .unwrap_or("left")
                .to_string(),
            v_align: props.vertical_align.as_deref().unwrap_or("top").to_string(),
            padding,
            line_spacing_px: role_style
                .and_then(|style| style.line_spacing_px)
                .unwrap_or(0),
            top_padding_px: role_style
                .and_then(|style| style.top_padding_px)
                .unwrap_or(0),
            overflow: props.overflow.as_deref().unwrap_or("wrap").to_string(),
        }
    } else if primitive_type == "number" {
        let effective_color_role =
            if font_role == "normalEmphasis" && theme.surface.fill_role.is_some() {
                theme.text.value
            } else {
                role_style
                    .and_then(|style| style.color_role)
                    .unwrap_or(theme.text.value)
            };
        let value = binding_scope_text(scope, bindings.get("value"), &project.locale)
            .or_else(|| {
                bindings
                    .get("entity")
                    .map(|entity_id| {
                        render_template(entity_id, scope, &project.locale)
                            .unwrap_or_else(|| entity_id.clone())
                    })
                    .map(|entity_id| bound_entity_text(scope, &entity_id))
            })
            .unwrap_or_default();
        let quantize_step = props.quantize_step.unwrap_or(0.0);
        let digits = props.digits.map(|value| value.max(0));
        let formatted_value = format_quantized_number(&value, quantize_step, digits);
        let text = format!(
            "{}{}{}{}",
            props
                .prefix
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default(),
            formatted_value,
            props
                .unit
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default(),
            props
                .suffix
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default()
        );
        PrimitiveTextSpec {
            text,
            family: role_style
                .and_then(|style| style.family.clone())
                .or_else(|| theme.auto_fit_font_family.clone())
                .unwrap_or_else(|| "arial".into()),
            weight: role_style
                .and_then(|style| style.weight.clone())
                .unwrap_or_else(|| "regular".into()),
            slope: role_style
                .and_then(|style| style.slope.clone())
                .unwrap_or_else(|| "roman".into()),
            color: contrasted_text_color(theme, role_color(effective_color_role), theme.text.value),
            tabular: true,
            default_px: role_style.and_then(|style| style.pixel_size).unwrap_or(
                if font_role == "tiny" {
                    project.font_presets.tiny
                } else if font_role == "normal" || font_role == "normalEmphasis" {
                    project.font_presets.normal
                } else {
                    project.font_presets.header
                },
            ),
            h_align: props
                .horizontal_align
                .as_deref()
                .unwrap_or("center")
                .to_string(),
            v_align: props
                .vertical_align
                .as_deref()
                .unwrap_or("middle")
                .to_string(),
            padding,
            line_spacing_px: role_style
                .and_then(|style| style.line_spacing_px)
                .unwrap_or(0),
            top_padding_px: role_style
                .and_then(|style| style.top_padding_px)
                .unwrap_or(0),
            overflow: "hide".to_string(),
        }
    } else {
        return Ok(None);
    };
    if spec.text.is_empty() {
        return Ok(None);
    }
    let _ = user_fonts;
    Ok(Some(spec))
}

fn measure_primitive(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<(i32, i32)>, ApiError> {
    let Some(spec) = primitive_render_spec(project, scope, node, user_fonts)? else {
        let Node::PrimitiveInstance {
            primitive_type,
            props,
            style,
            ..
        } = node
        else {
            return Ok(None);
        };
        if primitive_type == "line" {
            let chrome = add_edge_insets(
                &node_border_edges(style),
                &node_padding_edges(style, Some(props)),
            );
            return Ok(Some((
                1 + horizontal_insets(&chrome),
                1 + vertical_insets(&chrome),
            )));
        }
        if primitive_type == "icon" {
            let chrome = add_edge_insets(
                &node_border_edges(style),
                &node_padding_edges(style, Some(props)),
            );
            return Ok(Some((
                10 + horizontal_insets(&chrome),
                10 + vertical_insets(&chrome),
            )));
        }
        if primitive_type == "bar_chart" {
            let chrome = add_edge_insets(
                &node_border_edges(style),
                &node_padding_edges(style, Some(props)),
            );
            return Ok(Some((
                24 + horizontal_insets(&chrome),
                16 + vertical_insets(&chrome),
            )));
        }
        return Ok(None);
    };
    let runs = text_line_runs(
        &spec,
        spec.default_px,
        10_000,
        &project.font_presets,
        user_fonts,
    )?;
    if runs.is_empty() {
        return Ok(None);
    }
    let (text_w, text_h) = text_lines_block_size(&runs, spec.line_spacing_px);
    let chrome = if let Node::PrimitiveInstance { props, style, .. } = node {
        add_edge_insets(
            &node_border_edges(style),
            &node_padding_edges(style, Some(props)),
        )
    } else {
        EdgeInsets::default()
    };
    Ok(Some((
        text_w + horizontal_insets(&chrome).max(spec.padding * 2),
        text_h + vertical_insets(&chrome).max(spec.padding * 2) + spec.top_padding_px.max(0),
    )))
}

fn measure_node(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<(i32, i32)>, ApiError> {
    match node {
        Node::PrimitiveInstance { .. } => measure_primitive(project, scope, node, user_fonts),
        Node::Stack {
            axis,
            children,
            style,
            ..
        } => {
            let padding = style.padding_px.unwrap_or(0).max(0);
            let gap = style.gap_px.unwrap_or(0).max(0);
            let mut width = 0;
            let mut height = 0;
            let mut count = 0;
            for child in children {
                if let Some((child_w, child_h)) = measure_node(project, scope, child, user_fonts)? {
                    count += 1;
                    if axis == "vertical" {
                        width = width.max(child_w);
                        height += child_h;
                    } else {
                        width += child_w;
                        height = height.max(child_h);
                    }
                }
            }
            if count > 1 {
                if axis == "vertical" {
                    height += gap * (count - 1);
                } else {
                    width += gap * (count - 1);
                }
            }
            Ok(Some((width + padding * 2, height + padding * 2)))
        }
        Node::Script(node) => {
            let globals = globals_value(
                project,
                scope,
                Rect {
                    x: 0,
                    y: 0,
                    w: 0,
                    h: 0,
                },
            );
            let bindings = Value::Object(
                node.bindings
                    .iter()
                    .map(|(key, value)| {
                        let resolved = if value.contains("{{") {
                            render_template(value, scope, &project.locale)
                                .map(Value::String)
                                .unwrap_or(Value::Null)
                        } else {
                            scope_value(scope, value)
                                .unwrap_or_else(|| Value::String(value.clone()))
                        };
                        (key.clone(), resolved)
                    })
                    .collect(),
            );
            let derived = run_js_json(&node.source, scope, &bindings, &globals)?;
            let merged_scope = if derived.is_object() {
                merge_scope(scope, &derived)
            } else {
                scope.clone()
            };
            node.child
                .as_deref()
                .map(|child| measure_node(project, &merged_scope, child, user_fonts))
                .transpose()
                .map(|value| value.flatten())
        }
        Node::IfElse(node) => {
            let child = if evaluate_js_bool(&node.condition, scope)? {
                node.then_child.as_deref()
            } else {
                node.else_child.as_deref()
            };
            child
                .map(|child| measure_node(project, scope, child, user_fonts))
                .transpose()
                .map(|value| value.flatten())
        }
        Node::CompoundRef(node) => {
            let Some(definition) = project.widget_definitions.iter().find(|definition| {
                definition.id == node.definition_id && definition.kind == "compound"
            }) else {
                return Ok(None);
            };
            let Some(root) = definition.root_node.as_ref() else {
                return Ok(None);
            };
            let mut nested_scope = scope.clone();
            let Some(scope_object) = nested_scope.as_object_mut() else {
                return Ok(None);
            };
            for input in &definition.input_schema {
                let key = &input.id;
                let alias = &input.name;
                let value = if input.value_type == "entity" {
                    node.input_bindings
                        .get(key)
                        .or_else(|| node.input_bindings.get(alias))
                        .map(|value| {
                            render_template(value, scope, &project.locale)
                                .unwrap_or_else(|| value.clone())
                        })
                        .map(Value::String)
                        .or_else(|| node.input_values.get(key).cloned())
                        .or_else(|| node.input_values.get(alias).cloned())
                        .or_else(|| input.preview_value.clone())
                        .unwrap_or(Value::String(String::new()))
                } else {
                    node.input_values
                        .get(key)
                        .cloned()
                        .or_else(|| node.input_values.get(alias).cloned())
                        .or_else(|| input.default_value.clone())
                        .or_else(|| input.preview_value.clone())
                        .unwrap_or(Value::String(String::new()))
                };
                scope_object.insert(key.clone(), value.clone());
                scope_object.insert(alias.clone(), value);
            }
            measure_node(project, &nested_scope, root, user_fonts)
        }
        Node::DataQuery(node) => {
            let mut nested_scope = scope.clone();
            let items = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("items"))
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new()));
            let items = normalize_query_items(&node.query_kind, items);
            let date = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("meta"))
                .and_then(|value| value.get("date"))
                .cloned()
                .unwrap_or(Value::String(String::new()));
            if let Some(object) = nested_scope.as_object_mut() {
                object.insert(node.variable_name.clone(), items);
                if node.query_kind == "calendar_events" {
                    object.insert(
                        node.date_variable_name
                            .clone()
                            .unwrap_or_else(|| "date".into()),
                        date,
                    );
                }
            }
            node.child
                .as_deref()
                .map(|child| measure_node(project, &nested_scope, child, user_fonts))
                .transpose()
                .map(|value| value.flatten())
        }
        Node::ForEach(node) => {
            let values = evaluate_array_expression(
                &node.items_ref,
                scope,
                &project.locale,
                &node.item_alias,
                &node.index_alias,
            );
            let count = node.max_items.unwrap_or(values.len()).min(values.len());
            let Some(template) = node.child.as_deref() else {
                return Ok(None);
            };
            let mut width = 0;
            let mut height = 0;
            let gap = node.style.gap_px.unwrap_or(0).max(0);
            for (index, value) in values.into_iter().take(count).enumerate() {
                let item_scope = build_array_item_scope(
                    scope,
                    &value,
                    index,
                    &node.item_alias,
                    &node.index_alias,
                );
                if let Some((child_w, child_h)) =
                    measure_node(project, &item_scope, template, user_fonts)?
                {
                    if node.axis == "horizontal" {
                        width += child_w;
                        height = height.max(child_h);
                    } else {
                        width = width.max(child_w);
                        height += child_h;
                    }
                }
            }
            if count > 1 {
                if node.axis == "horizontal" {
                    width += gap * (count as i32 - 1);
                } else {
                    height += gap * (count as i32 - 1);
                }
            }
            Ok(Some((width, height)))
        }
        _ => Ok(None),
    }
}

fn render_primitive(
    canvas: &mut IndexedCanvas,
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    frame: Rect,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<(), ApiError> {
    let Node::PrimitiveInstance {
        primitive_type,
        props,
        bindings,
        style,
        ..
    } = node
    else {
        return Ok(());
    };
    let theme = theme_for_node(project, style);
    let border = node_border_edges(style);
    let padding = node_padding_edges(style, Some(props));
    let chrome = add_edge_insets(&border, &padding);
    if should_fill_node_surface(style) {
        if let Some(fill_role) = theme.surface.fill_role {
            canvas.fill_rect(inset_rect_by(frame, &border), fill_role_color(fill_role));
        }
    }
    draw_node_border(canvas, frame, style, role_color(theme.border.color_role));
    if primitive_type == "line" {
        let inner = inset_rect_by(frame, &chrome);
        let direction = props.line_direction.as_deref().unwrap_or("horizontal");
        let (x1, y1, x2, y2) = match direction {
            "vertical" => (
                inner.x + inner.w / 2,
                inner.y,
                inner.x + inner.w / 2,
                inner.y + inner.h - 1,
            ),
            "diag_down" => (
                inner.x,
                inner.y,
                inner.x + inner.w - 1,
                inner.y + inner.h - 1,
            ),
            "diag_up" => (
                inner.x,
                inner.y + inner.h - 1,
                inner.x + inner.w - 1,
                inner.y,
            ),
            _ => (
                inner.x,
                inner.y + inner.h / 2,
                inner.x + inner.w - 1,
                inner.y + inner.h / 2,
            ),
        };
        draw_line(canvas, x1, y1, x2, y2, role_color(theme.text.body));
        return Ok(());
    }
    if primitive_type == "icon" {
        let inner = inset_rect_by(frame, &chrome);
        let icon_id = binding_scope_text(scope, bindings.get("value"), &project.locale)
            .or_else(|| binding_scope_text(scope, bindings.get("icon"), &project.locale))
            .filter(|value| !value.trim().is_empty())
            .or_else(|| props.icon.clone())
            .unwrap_or_else(|| DEFAULT_ICON_ID.to_string());
        draw_icon(
            canvas,
            &icon_id,
            inner,
            role_color(theme.text.body),
            props.horizontal_align.as_deref().unwrap_or("center"),
            props.vertical_align.as_deref().unwrap_or("middle"),
        )?;
        return Ok(());
    }
    if primitive_type == "bar_chart" {
        let inner = inset_rect_by(frame, &chrome);
        let data = bar_chart_data(scope, bindings, props, &project.locale);
        draw_bar_chart(canvas, inner, &data, props);
        return Ok(());
    }
    let Some(spec) = primitive_render_spec(project, scope, node, user_fonts)? else {
        return Ok(());
    };
    let inner = inset_rect_by(frame, &chrome);
    let pixel_size = if props.auto_fit.unwrap_or(false) {
        auto_fit_pixel_size(&spec, inner, &project.font_presets, user_fonts)?
            .unwrap_or(spec.default_px)
    } else {
        props.fixed_pixel_size.unwrap_or(spec.default_px)
    };
    let runs = text_line_runs(
        &spec,
        pixel_size,
        inner.w,
        &project.font_presets,
        user_fonts,
    )?;
    if runs.is_empty() {
        return Ok(());
    }
    let (_block_w, block_h) = text_lines_block_size(&runs, spec.line_spacing_px);
    let mut cursor_y = match spec.v_align.as_str() {
        "middle" => inner.y + ((inner.h - block_h) / 2),
        "bottom" => inner.y + inner.h - block_h,
        _ => inner.y,
    } + spec.top_padding_px.max(0);
    for (index, line) in runs.iter().enumerate() {
        let draw_x = match spec.h_align.as_str() {
            "center" => inner.x + ((inner.w - line.bounds.width) / 2),
            "right" => inner.x + inner.w - line.bounds.width,
            _ => inner.x,
        } - line.bounds.min_x;
        let draw_y = cursor_y - line.bounds.min_y;
        draw_text_run(canvas, &line.run, draw_x, draw_y, spec.color, inner);
        cursor_y += line.bounds.height
            + if index + 1 < runs.len() {
                spec.line_spacing_px.max(0)
            } else {
                0
            };
    }
    Ok(())
}

fn draw_icon(
    canvas: &mut IndexedCanvas,
    icon_id: &str,
    frame: Rect,
    color: u8,
    horizontal_align: &str,
    vertical_align: &str,
) -> Result<(), ApiError> {
    let Some(path) = font_awesome_svg_path(icon_id) else {
        return Ok(());
    };
    let svg = fs::read_to_string(path).map_err(|error| ApiError::internal(error.to_string()))?;
    let options = Options::default();
    let tree =
        Tree::from_str(&svg, &options).map_err(|error| ApiError::internal(error.to_string()))?;
    let size = tree.size();
    let source_w = size.width().max(1.0);
    let source_h = size.height().max(1.0);
    let scale = (frame.w as f32 / source_w)
        .min(frame.h as f32 / source_h)
        .max(0.01);
    let draw_w = (source_w * scale).round().max(1.0) as u32;
    let draw_h = (source_h * scale).round().max(1.0) as u32;
    let offset_x = match horizontal_align {
        "left" => frame.x,
        "right" => frame.x + frame.w - draw_w as i32,
        _ => frame.x + (frame.w - draw_w as i32) / 2,
    };
    let offset_y = match vertical_align {
        "top" => frame.y,
        "bottom" => frame.y + frame.h - draw_h as i32,
        _ => frame.y + (frame.h - draw_h as i32) / 2,
    };
    let mut pixmap = Pixmap::new(draw_w, draw_h)
        .ok_or_else(|| ApiError::internal("icon pixmap alloc failed"))?;
    let transform = Transform::from_scale(scale, scale);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    for y in 0..draw_h as usize {
        for x in 0..draw_w as usize {
            if pixmap
                .pixel(x as u32, y as u32)
                .is_some_and(|pixel| pixel.alpha() >= 16)
            {
                canvas.set_pixel(offset_x + x as i32, offset_y + y as i32, color);
            }
        }
    }
    Ok(())
}

fn draw_line(canvas: &mut IndexedCanvas, mut x0: i32, mut y0: i32, x1: i32, y1: i32, color: u8) {
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        canvas.set_pixel(x0, y0, color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let error2 = error * 2;
        if error2 >= dy {
            error += dy;
            x0 += sx;
        }
        if error2 <= dx {
            error += dx;
            y0 += sy;
        }
    }
}

fn draw_error_placeholder(canvas: &mut IndexedCanvas, frame: Rect) {
    let frame = Rect {
        x: frame.x,
        y: frame.y,
        w: frame.w.max(1),
        h: frame.h.max(1),
    };
    let x0 = frame.x;
    let y0 = frame.y;
    let x1 = frame.x + frame.w - 1;
    let y1 = frame.y + frame.h - 1;
    draw_line(canvas, x0, y0, x1, y0, COLOR_ACCENT);
    draw_line(canvas, x1, y0, x1, y1, COLOR_ACCENT);
    draw_line(canvas, x1, y1, x0, y1, COLOR_ACCENT);
    draw_line(canvas, x0, y1, x0, y0, COLOR_ACCENT);
    draw_line(canvas, x0, y0, x1, y1, COLOR_ACCENT);
    draw_line(canvas, x0, y1, x1, y0, COLOR_ACCENT);
    if frame.w > 6 && frame.h > 6 {
        draw_line(canvas, x0 + 1, y0 + 1, x1 - 1, y1 - 1, COLOR_FG);
        draw_line(canvas, x0 + 1, y1 - 1, x1 - 1, y0 + 1, COLOR_FG);
    }
}

fn render_child_or_placeholder(
    canvas: &mut IndexedCanvas,
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    frame: Rect,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) {
    if render_node(canvas, project, scope, node, frame, user_fonts, None).is_err() {
        draw_error_placeholder(canvas, frame);
    }
}

fn child_rects(
    axis: &str,
    children: &[Node],
    frame: Rect,
    project: &ProjectView,
    scope: &Value,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Vec<Rect> {
    let is_vertical = axis == "vertical";
    let total = if is_vertical { frame.h } else { frame.w };
    let mut fixed = 0;
    let mut flex_count = 0;
    let mut sizes = Vec::with_capacity(children.len());
    for child in children {
        let (width, height, style, props_padding) = match child {
            Node::Stack {
                width,
                height,
                style,
                ..
            } => (width, height, style, None),
            Node::Zstack {
                width,
                height,
                style,
                ..
            } => (width, height, style, None),
            Node::Grid {
                width,
                height,
                style,
                ..
            } => (width, height, style, None),
            Node::DataQuery(node) => (&node.width, &node.height, &node.style, None),
            Node::ForEach(node) => (&node.width, &node.height, &node.style, None),
            Node::CompoundRef(node) => (&node.width, &node.height, &node.style, None),
            Node::Script(node) => (&node.width, &node.height, &node.style, None),
            Node::IfElse(node) => (&node.width, &node.height, &node.style, None),
            Node::PrimitiveInstance {
                width,
                height,
                style,
                props,
                ..
            } => (width, height, style, props.padding_px),
            Node::Spacer {
                width,
                height,
                style,
                ..
            } => (width, height, style, None),
            Node::Unsupported => {
                sizes.push(None);
                continue;
            }
        };
        let spec = if is_vertical { height } else { width };
        let padding = node_padding(style, props_padding);
        let measured = match spec.as_ref().and_then(|spec| spec.mode.as_deref()) {
            Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height") => {
                match measure_node(project, scope, child, user_fonts) {
                    Ok(Some((w, h))) => Some(if is_vertical { h } else { w }),
                    _ => None,
                }
            }
            _ => get_size_value(spec, total),
        }
        .map(|value| value.max(1 + padding * 2));
        if let Some(value) = measured {
            fixed += value;
            sizes.push(Some(value));
        } else {
            flex_count += 1;
            sizes.push(None);
        }
    }
    let remaining = (total - fixed).max(0);
    let flex_size = if flex_count > 0 {
        remaining / flex_count
    } else {
        0
    };
    let mut cursor_x = frame.x;
    let mut cursor_y = frame.y;
    children
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let size = sizes[index].unwrap_or(flex_size.max(1));
            let rect = if is_vertical {
                let rect = Rect {
                    x: frame.x,
                    y: cursor_y,
                    w: frame.w,
                    h: size,
                };
                cursor_y += size;
                rect
            } else {
                let rect = Rect {
                    x: cursor_x,
                    y: frame.y,
                    w: size,
                    h: frame.h,
                };
                cursor_x += size;
                rect
            };
            rect
        })
        .collect()
}

fn track_sizes(tracks: &[GridTrack], total: i32, gap: i32) -> Vec<i32> {
    let gap_total = gap * (tracks.len().saturating_sub(1) as i32);
    let available = (total - gap_total).max(0);
    let mut fixed = 0;
    let mut flex_count = 0;
    let mut sizes = Vec::with_capacity(tracks.len());
    for track in tracks {
        let measured =
            get_size_value(&Some(track.size.clone()), available).map(|value| value.max(1));
        if let Some(value) = measured {
            fixed += value;
            sizes.push(Some(value));
        } else {
            flex_count += 1;
            sizes.push(None);
        }
    }
    let remaining = (available - fixed).max(0);
    let flex_size = if flex_count > 0 {
        remaining / flex_count
    } else {
        0
    };
    sizes
        .into_iter()
        .map(|size| size.unwrap_or(flex_size.max(1)))
        .collect()
}

fn grid_line_offsets(sizes: &[i32], start: i32, gap: i32) -> Vec<i32> {
    let mut offsets = Vec::with_capacity(sizes.len() + 1);
    let mut cursor = start;
    offsets.push(cursor);
    for (index, size) in sizes.iter().enumerate() {
        cursor += *size;
        offsets.push(cursor);
        if index < sizes.len().saturating_sub(1) {
            cursor += gap;
        }
    }
    offsets
}

fn render_node(
    canvas: &mut IndexedCanvas,
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    frame: Rect,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
    content_insets: Option<&EdgeInsets>,
) -> Result<(), ApiError> {
    if let Some(_reason) = unsupported_node_self_reason(node) {
        draw_error_placeholder(canvas, frame);
        return Ok(());
    }
    match node {
        Node::Stack {
            axis,
            children,
            style,
            ..
        } => {
            let theme = theme_for_node(project, style);
            let gap = style.gap_px.unwrap_or(0).max(0);
            let inner = inset_rect_by_optional(
                render_box_chrome(canvas, theme, style, frame),
                content_insets,
            );
            let mut rects = child_rects(axis, children, inner, project, scope, user_fonts);
            if !rects.is_empty() && gap > 0 {
                let total_gap = gap * (rects.len().saturating_sub(1) as i32);
                if axis == "vertical" {
                    let shrink = total_gap / rects.len() as i32;
                    let mut y = inner.y;
                    for rect in &mut rects {
                        rect.y = y;
                        rect.h = (rect.h - shrink).max(1);
                        y += rect.h + gap;
                    }
                } else {
                    let shrink = total_gap / rects.len() as i32;
                    let mut x = inner.x;
                    for rect in &mut rects {
                        rect.x = x;
                        rect.w = (rect.w - shrink).max(1);
                        x += rect.w + gap;
                    }
                }
            }
            for (child, child_frame) in children.iter().zip(rects.iter()) {
                render_child_or_placeholder(
                    canvas,
                    project,
                    scope,
                    child,
                    *child_frame,
                    user_fonts,
                );
            }
            Ok(())
        }
        Node::Zstack {
            children, style, ..
        } => {
            let theme = theme_for_node(project, style);
            let inner = inset_rect_by_optional(
                render_box_chrome(canvas, theme, style, frame),
                content_insets,
            );
            for child in children {
                render_child_or_placeholder(canvas, project, scope, child, inner, user_fonts);
            }
            Ok(())
        }
        Node::Grid {
            rows,
            columns,
            children,
            style,
            ..
        } => {
            let theme = theme_for_node(project, style);
            let gap = style.gap_px.unwrap_or(0).max(0);
            let inner = inset_rect_by_optional(
                render_box_chrome(canvas, theme, style, frame),
                content_insets,
            );
            let row_sizes = track_sizes(rows, inner.h, gap);
            let col_sizes = track_sizes(columns, inner.w, gap);
            let row_offsets = grid_line_offsets(&row_sizes, inner.y, gap);
            let col_offsets = grid_line_offsets(&col_sizes, inner.x, gap);
            for child in children {
                let row = child.placement.row.max(1) as usize;
                let column = child.placement.column.max(1) as usize;
                if row > row_sizes.len() || column > col_sizes.len() {
                    continue;
                }
                let row_span = child.placement.row_span.unwrap_or(1).max(1) as usize;
                let column_span = child.placement.column_span.unwrap_or(1).max(1) as usize;
                let end_row = (row + row_span - 1).min(row_sizes.len());
                let end_col = (column + column_span - 1).min(col_sizes.len());
                let child_frame = Rect {
                    x: col_offsets[column - 1],
                    y: row_offsets[row - 1],
                    w: col_offsets[end_col] - col_offsets[column - 1],
                    h: row_offsets[end_row] - row_offsets[row - 1],
                };
                render_child_or_placeholder(
                    canvas,
                    project,
                    scope,
                    &child.node,
                    child_frame,
                    user_fonts,
                );
            }
            Ok(())
        }
        Node::DataQuery(node) => {
            let theme = theme_for_node(project, &node.style);
            let inner = inset_rect_by_optional(
                render_box_chrome(canvas, theme, &node.style, frame),
                content_insets,
            );
            let mut nested_scope = scope.clone();
            let items = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("items"))
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new()));
            let items = normalize_query_items(&node.query_kind, items);
            let date = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("meta"))
                .and_then(|value| value.get("date"))
                .cloned()
                .unwrap_or(Value::String(String::new()));
            if let Some(object) = nested_scope.as_object_mut() {
                object.insert(node.variable_name.clone(), items);
                if node.query_kind == "calendar_events" {
                    object.insert(
                        node.date_variable_name
                            .clone()
                            .unwrap_or_else(|| "date".into()),
                        date,
                    );
                }
            }
            if let Some(child) = node.child.as_deref() {
                render_child_or_placeholder(
                    canvas,
                    project,
                    &nested_scope,
                    child,
                    inner,
                    user_fonts,
                );
            }
            Ok(())
        }
        Node::ForEach(node) => {
            let values = evaluate_array_expression(
                &node.items_ref,
                scope,
                &project.locale,
                &node.item_alias,
                &node.index_alias,
            );
            let count = node.max_items.unwrap_or(values.len()).min(values.len());
            let Some(template) = node.child.as_deref() else {
                return Ok(());
            };
            let gap = node.style.gap_px.unwrap_or(0).max(0);
            let theme = theme_for_node(project, &node.style);
            let inner = inset_rect_by_optional(
                render_box_chrome(canvas, theme, &node.style, frame),
                content_insets,
            );
            let horizontal = node.axis == "horizontal";
            let available_main =
                if horizontal { inner.w } else { inner.h } - gap * (count.saturating_sub(1) as i32);
            let template_spec = if horizontal {
                node_width_spec(template)
            } else {
                node_height_spec(template)
            };
            let shared_main = match template_spec.and_then(|spec| spec.mode.as_deref()) {
                None | Some("fill") | Some("fraction") => {
                    Some((available_main.max(0) / count.max(1) as i32).max(1))
                }
                _ => None,
            };
            let mut cursor = if horizontal { inner.x } else { inner.y };
            for (index, value) in values.into_iter().take(count).enumerate() {
                let item_scope = build_array_item_scope(
                    scope,
                    &value,
                    index,
                    &node.item_alias,
                    &node.index_alias,
                );
                let measured = measure_node(project, &item_scope, template, user_fonts)
                    .ok()
                    .flatten()
                    .unwrap_or((inner.w, inner.h));
                let main = shared_main
                    .unwrap_or(if horizontal { measured.0 } else { measured.1 })
                    .max(1);
                let cross_spec = if horizontal {
                    node_height_spec(template)
                } else {
                    node_width_spec(template)
                };
                let cross_available = if horizontal { inner.h } else { inner.w };
                let cross = match cross_spec.and_then(|spec| spec.mode.as_deref()) {
                    None | Some("fill") => cross_available,
                    Some("fraction") => cross_spec
                        .and_then(|spec| spec.value)
                        .map(|value| (cross_available as f64 * value).round() as i32)
                        .unwrap_or(cross_available),
                    Some("fixed_px") => cross_spec
                        .and_then(|spec| spec.value)
                        .map(|value| value.round() as i32)
                        .unwrap_or(cross_available),
                    _ => {
                        if horizontal {
                            measured.1
                        } else {
                            measured.0
                        }
                    }
                }
                .clamp(1, cross_available.max(1));
                let child_frame = if horizontal {
                    Rect {
                        x: cursor,
                        y: inner.y,
                        w: main.min(inner.w.max(1)),
                        h: cross,
                    }
                } else {
                    Rect {
                        x: inner.x,
                        y: cursor,
                        w: cross,
                        h: main.min(inner.h.max(1)),
                    }
                };
                render_child_or_placeholder(
                    canvas,
                    project,
                    &item_scope,
                    template,
                    child_frame,
                    user_fonts,
                );
                cursor += main + gap;
            }
            Ok(())
        }
        Node::CompoundRef(node) => {
            let Some(definition) = project.widget_definitions.iter().find(|definition| {
                definition.id == node.definition_id && definition.kind == "compound"
            }) else {
                draw_error_placeholder(canvas, frame);
                return Ok(());
            };
            let Some(root) = definition.root_node.as_ref() else {
                draw_error_placeholder(canvas, frame);
                return Ok(());
            };
            let mut nested_scope = scope.clone();
            let Some(scope_object) = nested_scope.as_object_mut() else {
                draw_error_placeholder(canvas, frame);
                return Ok(());
            };
            for input in &definition.input_schema {
                let key = &input.id;
                let alias = &input.name;
                let value = if input.value_type == "entity" {
                    node.input_bindings
                        .get(key)
                        .or_else(|| node.input_bindings.get(alias))
                        .map(|value| {
                            render_template(value, scope, &project.locale)
                                .unwrap_or_else(|| value.clone())
                        })
                        .map(Value::String)
                        .or_else(|| node.input_values.get(key).cloned())
                        .or_else(|| node.input_values.get(alias).cloned())
                        .or_else(|| input.preview_value.clone())
                        .unwrap_or(Value::String(String::new()))
                } else {
                    node.input_values
                        .get(key)
                        .cloned()
                        .or_else(|| node.input_values.get(alias).cloned())
                        .or_else(|| input.default_value.clone())
                        .or_else(|| input.preview_value.clone())
                        .unwrap_or(Value::String(String::new()))
                };
                scope_object.insert(key.clone(), value.clone());
                scope_object.insert(alias.clone(), value);
            }
            if render_node(
                canvas,
                project,
                &nested_scope,
                root,
                frame,
                user_fonts,
                content_insets,
            )
            .is_err()
            {
                draw_error_placeholder(canvas, frame);
            }
            Ok(())
        }
        Node::Script(script) => {
            let globals = globals_value(project, scope, frame);
            let bindings = Value::Object(
                script
                    .bindings
                    .iter()
                    .map(|(key, value)| {
                        let resolved = if value.contains("{{") {
                            render_template(value, scope, &project.locale)
                                .map(Value::String)
                                .unwrap_or(Value::Null)
                        } else {
                            scope_value(scope, value)
                                .unwrap_or_else(|| Value::String(value.clone()))
                        };
                        (key.clone(), resolved)
                    })
                    .collect(),
            );
            let Ok(derived) = run_js_json(&script.source, scope, &bindings, &globals) else {
                draw_error_placeholder(canvas, frame);
                return Ok(());
            };
            let merged_scope = if derived.is_object() {
                merge_scope(scope, &derived)
            } else {
                scope.clone()
            };
            if let Some(child) = script.child.as_deref() {
                if render_node(
                    canvas,
                    project,
                    &merged_scope,
                    child,
                    frame,
                    user_fonts,
                    content_insets,
                )
                .is_err()
                {
                    draw_error_placeholder(canvas, frame);
                }
            }
            Ok(())
        }
        Node::IfElse(node) => {
            let Ok(condition_matches) = evaluate_js_bool(&node.condition, scope) else {
                draw_error_placeholder(canvas, frame);
                return Ok(());
            };
            let child = if condition_matches {
                node.then_child.as_deref()
            } else {
                node.else_child.as_deref()
            };
            if let Some(child) = child {
                if render_node(
                    canvas,
                    project,
                    scope,
                    child,
                    frame,
                    user_fonts,
                    content_insets,
                )
                .is_err()
                {
                    draw_error_placeholder(canvas, frame);
                }
            }
            Ok(())
        }
        Node::PrimitiveInstance { .. } => {
            let frame = inset_rect_by_optional(frame, content_insets);
            render_primitive(canvas, project, scope, node, frame, user_fonts)
        }
        Node::Spacer { .. } => Ok(()),
        Node::Unsupported => {
            draw_error_placeholder(canvas, frame);
            Ok(())
        }
    }
}

fn render_layout_preview(
    project_value: &Value,
    user_fonts_value: &Value,
    data_value: &Value,
    layout_id: &str,
    popup_layout_id: Option<&str>,
    default_theme_id: Option<&str>,
    display_type_id: Option<&str>,
    data_source_message: Option<String>,
) -> Result<Option<NativeRenderedPreview>, ApiError> {
    let mut project: ProjectView = serde_json::from_value(project_value.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let user_fonts: HashMap<String, RuntimeFontFamilyData> =
        serde_json::from_value(user_fonts_value.clone())
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let layout = match project
        .layout_definitions
        .iter()
        .find(|layout| layout.id == layout_id)
    {
        Some(layout) => layout,
        None => return Ok(None),
    };
    let root = match &layout.root_node {
        Some(root) => root,
        _ => return Ok(None),
    };
    let mut script_warnings = unsupported_node_reason(&project, root, "root")
        .map(|reason| vec![format!("Native preview rendered placeholder: {reason}")])
        .unwrap_or_default();
    project.active_theme_id = default_theme_id
        .filter(|theme_id| *theme_id != "inherit")
        .map(str::to_string)
        .or_else(|| {
            node_theme_id(root)
                .filter(|theme_id| *theme_id != "inherit")
                .map(str::to_string)
        });
    let popup = match popup_layout_id {
        Some(popup_layout_id) => match project
            .layout_definitions
            .iter()
            .find(|layout| layout.id == popup_layout_id)
        {
            Some(layout) => match &layout.root_node {
                Some(root) => {
                    if let Some(reason) = unsupported_node_reason(&project, root, "popup") {
                        script_warnings.push(format!(
                            "Native popup preview rendered placeholder: {reason}"
                        ));
                    }
                    Some((layout, root))
                }
                _ => return Ok(None),
            },
            None => return Ok(None),
        },
        None => None,
    };
    let display_type = match project.display_types.iter().find(|display_type| {
        Some(display_type.id.as_str())
            == display_type_id
                .or(layout.display_type_id.as_deref())
                .or_else(|| project.display_types.first().map(|entry| entry.id.as_str()))
    }) {
        Some(display_type) => display_type,
        None => return Ok(None),
    };
    let mut canvas = IndexedCanvas::new(display_type.width, display_type.height, COLOR_BG);
    if let Some(theme_id) = project.active_theme_id.as_deref() {
        if let Some(theme) = project.themes.iter().find(|theme| theme.id == theme_id) {
            if let Some(fill_role) = theme.surface.fill_role {
                canvas.fill_rect(
                    Rect {
                        x: 0,
                        y: 0,
                        w: display_type.width as i32,
                        h: display_type.height as i32,
                    },
                    fill_role_color(fill_role),
                );
            }
        }
    }
    let root_content_padding = if layout.kind == "fullscreen" {
        display_type.content_padding.as_ref()
    } else {
        None
    };
    if render_node(
        &mut canvas,
        &project,
        data_value,
        root,
        Rect {
            x: 0,
            y: 0,
            w: display_type.width as i32,
            h: display_type.height as i32,
        },
        &user_fonts,
        root_content_padding,
    )
    .is_err()
    {
        draw_error_placeholder(
            &mut canvas,
            Rect {
                x: 0,
                y: 0,
                w: display_type.width as i32,
                h: display_type.height as i32,
            },
        );
    }
    if let Some((popup_layout, popup_root)) = popup {
        if render_node(
            &mut canvas,
            &project,
            data_value,
            popup_root,
            Rect {
                x: 0,
                y: 0,
                w: display_type.width as i32,
                h: display_type.height as i32,
            },
            &user_fonts,
            None,
        )
        .is_err()
        {
            draw_error_placeholder(
                &mut canvas,
                Rect {
                    x: 0,
                    y: 0,
                    w: display_type.width as i32,
                    h: display_type.height as i32,
                },
            );
        }
        let _ = popup_layout;
    }
    let [bg_r, bg_g, bg_b] = parse_hex_color(&display_type.palette.bg)?;
    let [fg_r, fg_g, fg_b] = parse_hex_color(&display_type.palette.fg)?;
    let [accent_r, accent_g, accent_b] = parse_hex_color(&display_type.palette.accent)?;
    let mut rgba = vec![0u8; display_type.width as usize * display_type.height as usize * 4];
    for (index, pixel) in canvas.pixels.iter().enumerate() {
        let offset = index * 4;
        let (r, g, b) = match *pixel {
            COLOR_FG => (fg_r, fg_g, fg_b),
            COLOR_ACCENT => (accent_r, accent_g, accent_b),
            _ => (bg_r, bg_g, bg_b),
        };
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
        rgba[offset + 3] = 255;
    }
    let png_bytes = rgba_to_png(&rgba, display_type.width, display_type.height)?;
    Ok(Some(NativeRenderedPreview {
        width: display_type.width,
        height: display_type.height,
        hash: format!(
            "native-layout:{}:{}:{}",
            layout.id,
            display_type.id,
            preview_image_hash(&png_bytes)
        ),
        active_screen_id: layout.id.clone(),
        active_overlay_id: popup_layout_id.map(str::to_string),
        data_source_message,
        script_warnings: if script_warnings.is_empty() {
            None
        } else {
            Some(script_warnings)
        },
        png_bytes,
    }))
}

fn render_empty_display_preview(
    project: &ProjectView,
    display_type_id: &str,
    data_source_message: Option<String>,
) -> Result<Option<NativeRenderedPreview>, ApiError> {
    let display_type = match project
        .display_types
        .iter()
        .find(|display_type| display_type.id == display_type_id)
    {
        Some(display_type) => display_type,
        None => return Ok(None),
    };
    let [bg_r, bg_g, bg_b] = parse_hex_color(&display_type.palette.bg)?;
    let mut rgba = vec![0u8; display_type.width as usize * display_type.height as usize * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[0] = bg_r;
        pixel[1] = bg_g;
        pixel[2] = bg_b;
        pixel[3] = 255;
    }
    let png_bytes = rgba_to_png(&rgba, display_type.width, display_type.height)?;
    Ok(Some(NativeRenderedPreview {
        width: display_type.width,
        height: display_type.height,
        hash: format!(
            "native-empty:{}:{}",
            display_type.id,
            preview_image_hash(&png_bytes)
        ),
        active_screen_id: String::new(),
        active_overlay_id: None,
        data_source_message,
        script_warnings: None,
        png_bytes,
    }))
}

pub(crate) fn preview_value(rendered: &NativeRenderedPreview) -> Value {
    json!({
        "width": rendered.width,
        "height": rendered.height,
        "hash": rendered.hash,
        "activeScreenId": rendered.active_screen_id,
        "activeOverlayId": rendered.active_overlay_id,
        "dataSourceMessage": rendered.data_source_message,
        "scriptWarnings": rendered.script_warnings,
        "pngBase64": base64::engine::general_purpose::STANDARD.encode(&rendered.png_bytes),
    })
}

pub(crate) fn try_render_layout_preview_value(
    project_value: &Value,
    user_fonts_value: &Value,
    body: &Value,
    data_value: &Value,
) -> Result<Option<Value>, ApiError> {
    if body
        .get("includeInspection")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Ok(None);
    }
    if body.get("displayId").and_then(Value::as_str).is_some() {
        return Ok(None);
    }
    let layout_id = match body.get("layoutId").and_then(Value::as_str) {
        Some(value) => value,
        None => return Ok(None),
    };
    Ok(render_layout_preview(
        project_value,
        user_fonts_value,
        data_value,
        layout_id,
        body.get("popupLayoutId").and_then(Value::as_str),
        body.get("themeId").and_then(Value::as_str),
        body.get("displayTypeId").and_then(Value::as_str),
        None,
    )?
    .map(|rendered| preview_value(&rendered)))
}

pub(crate) fn try_render_assigned_preview(
    project_value: &Value,
    user_fonts_value: &Value,
    data_value: &Value,
    display_id: &str,
    data_source_message: Option<String>,
) -> Result<Option<NativeRenderedPreview>, ApiError> {
    let project: ProjectView = serde_json::from_value(project_value.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let display = match project
        .devices
        .iter()
        .find(|display| display.id == display_id)
    {
        Some(display) => display,
        None => return Ok(None),
    };
    let assignment = project
        .device_assignments
        .iter()
        .find(|assignment| assignment.display_id == display_id);
    let Some(assignment) = assignment else {
        return Ok(None);
    };
    let layout_for_display = |layout_id: &str| {
        project
            .layout_definitions
            .iter()
            .find(|layout| layout.id == layout_id && layout.kind != "popup")
            .map(|layout| layout.id.as_str())
    };
    let selected_rule_layout_id = select_rule_layout_id(
        &assignment.fullscreen_rules,
        "activate_fullscreen_layout",
        data_value,
    )
    .and_then(layout_for_display);
    let default_layout_id = assignment
        .default_fullscreen_layout_id
        .as_deref()
        .and_then(layout_for_display);
    let fallback_layout_id = project
        .layout_definitions
        .iter()
        .find(|layout| layout.kind != "popup" && layout.root_node.is_some())
        .map(|layout| layout.id.as_str());
    let layout_id = selected_rule_layout_id
        .or(default_layout_id)
        .or(fallback_layout_id);
    let Some(layout_id) = layout_id else {
        return render_empty_display_preview(
            &project,
            &display.display_type_id,
            data_source_message,
        );
    };
    let popup_layout_id =
        select_rule_layout_id(&assignment.popup_rules, "activate_popup_layout", data_value);
    let rendered = render_layout_preview(
        project_value,
        user_fonts_value,
        data_value,
        layout_id,
        popup_layout_id,
        assignment.default_theme_id.as_deref(),
        Some(display.display_type_id.as_str()),
        data_source_message,
    )?;
    let Some(mut rendered) = rendered else {
        return Ok(None);
    };
    if let Some(theme_id) = &assignment.default_theme_id {
        rendered.hash = format!("{}:{theme_id}", rendered.hash);
    }
    Ok(Some(rendered))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_unsupported(project: &ProjectView, node: &Node) -> Option<String> {
        match node {
            Node::Stack { children, .. } | Node::Zstack { children, .. } => {
                if let Some(found) = children
                    .iter()
                    .find_map(|child| first_unsupported(project, child))
                {
                    return Some(found);
                }
            }
            Node::Grid { children, .. } => {
                if let Some(found) = children
                    .iter()
                    .find_map(|child| first_unsupported(project, &child.node))
                {
                    return Some(found);
                }
            }
            Node::CompoundRef(node) => {
                let definition = project.widget_definitions.iter().find(|definition| {
                    definition.id == node.definition_id && definition.kind == "compound"
                });
                let Some(definition) = definition else {
                    return Some(format!("missing-definition:{}", node.definition_id));
                };
                let Some(root) = definition.root_node.as_ref() else {
                    return Some(format!("missing-root:{}", node.definition_id));
                };
                if let Some(found) = first_unsupported(project, root) {
                    return Some(found);
                }
            }
            Node::Script(node) => {
                if let Some(found) = node
                    .child
                    .as_deref()
                    .and_then(|child| first_unsupported(project, child))
                {
                    return Some(found);
                }
            }
            Node::IfElse(node) => {
                if let Some(found) = node
                    .then_child
                    .as_deref()
                    .and_then(|child| first_unsupported(project, child))
                    .or_else(|| {
                        node.else_child
                            .as_deref()
                            .and_then(|child| first_unsupported(project, child))
                    })
                {
                    return Some(found);
                }
            }
            _ => {}
        }
        if !node_supported(node) {
            Some(format!("self:{node:?}"))
        } else {
            None
        }
    }

    fn demo_project() -> Value {
        serde_json::from_str(include_str!("seed/demo-home.json")).unwrap()
    }

    #[test]
    fn preview_image_hash_uses_full_image_bytes() {
        let mut first = vec![0u8; 64];
        let mut second = first.clone();
        first[40] = 1;
        second[40] = 2;

        assert_ne!(preview_image_hash(&first), preview_image_hash(&second));
    }

    #[test]
    fn compound_ref_layout_supported_natively() {
        let project_value = demo_project();
        let project: ProjectView = serde_json::from_value(project_value.clone()).unwrap();
        let root = json!({
            "type": "compound_ref",
            "id": "node-compound",
            "definitionId": "widget-efd4b992",
            "inputValues": { "input-eb402e73": "Bathroom" },
            "inputBindings": {
                "input-1a1d2a4a": "sensor.bathroom_climate_temperature",
                "input-82491d75": "sensor.bathroom_climate_humidity"
            },
            "style": { "borderToken": "none", "paddingPx": 0 },
            "width": { "mode": "fill" },
            "height": { "mode": "fill" }
        });
        let node: Node = serde_json::from_value(root).unwrap();
        assert!(
            node_supported_with_project(&project, &node),
            "{:?}",
            first_unsupported(&project, &node)
        );
    }

    #[test]
    fn render_layout_preview_handles_compound_ref_layout() {
        let mut project_value = demo_project();
        project_value["layoutDefinitions"] = json!([{
            "id": "layout-climate-native",
            "displayTypeId": "oel-ap-hw-01-296x128",
            "rootNode": {
                "type": "compound_ref",
                "id": "node-compound",
                "definitionId": "widget-efd4b992",
                "inputValues": { "input-eb402e73": "Bathroom" },
                "inputBindings": {
                    "input-1a1d2a4a": "sensor.bathroom_climate_temperature",
                    "input-82491d75": "sensor.bathroom_climate_humidity"
                },
                "style": { "borderToken": "none", "paddingPx": 0 },
                "width": { "mode": "fill" },
                "height": { "mode": "fill" }
            }
        }]);
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({
                "entities": {
                    "sensor.bathroom_climate_temperature": { "state": "21.4" },
                    "sensor.bathroom_climate_humidity": { "state": "87" }
                },
                "now": "2026-04-24T22:00:00+02:00"
            }),
            "layout-climate-native",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(rendered.is_some());
        assert!(rendered.unwrap().hash.starts_with("native-layout:"));
    }

    #[test]
    fn render_layout_preview_respects_display_type_content_padding() {
        let mut project_value = demo_project();
        project_value["displayTypes"] = json!([{
            "id": "padded",
            "width": 40,
            "height": 24,
            "rotation": 0,
            "contentPadding": { "top": 5, "right": 6, "bottom": 7, "left": 8 },
            "palette": { "bg": "#ffffff", "fg": "#111111", "accent": "#d7261b" }
        }]);
        project_value["layoutDefinitions"] = json!([{
            "id": "layout-padded-native",
            "kind": "fullscreen",
            "displayTypeId": "padded",
            "rootNode": {
                "id": "root",
                "type": "stack",
                "axis": "vertical",
                "style": { "borderToken": "none", "paddingPx": 0 },
                "width": { "mode": "fill" },
                "height": { "mode": "fill" },
                "children": [{
                    "id": "line",
                    "type": "primitive_instance",
                    "primitiveType": "line",
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "props": { "paddingPx": 0 },
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" }
                }]
            }
        }]);
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({}),
            "layout-padded-native",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        let image = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgba8();

        assert_eq!(image.get_pixel(8, 4).0, [255, 255, 255, 255]);
        assert_eq!(image.get_pixel(8, 11).0, [17, 17, 17, 255]);
        assert_eq!(image.get_pixel(1, 11).0, [255, 255, 255, 255]);
    }

    #[test]
    fn render_layout_preview_handles_weather_data_query() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tri296x128-red",
                "width": 296,
                "height": 128,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-weather",
                "displayTypeId": "tri296x128-red",
                "rootNode": {
                    "id": "query-weather",
                    "type": "data_query",
                    "queryKind": "weather_forecast",
                    "variableName": "weather",
                    "sourceProviderInstanceId": "open-meteo-default",
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "child": {
                        "id": "weather-text",
                        "type": "primitive_instance",
                        "primitiveType": "text",
                        "width": { "mode": "fill" },
                        "height": { "mode": "fill" },
                        "style": { "borderToken": "none", "paddingPx": 4 },
                        "bindings": {},
                        "props": {
                            "text": "{{weather.temperature}}",
                            "autoFit": true,
                            "horizontalAlign": "left",
                            "verticalAlign": "top",
                            "overflow": "wrap"
                        }
                    }
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({
                "metaQueries": {
                    "query-weather": {
                        "items": [{ "temperature": "16.6" }]
                    }
                },
                "now": "2026-04-24T22:00:00+02:00"
            }),
            "layout-weather",
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert!(rendered.is_some());
        assert!(rendered.unwrap().hash.starts_with("native-layout:"));
    }

    #[test]
    fn foreach_vertical_fill_child_uses_full_cross_axis() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tiny",
                "width": 32,
                "height": 8,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-foreach-fill",
                "displayTypeId": "tiny",
                "rootNode": {
                    "id": "query",
                    "type": "data_query",
                    "queryKind": "calendar_events",
                    "variableName": "items",
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "child": {
                        "id": "each",
                        "type": "foreach",
                        "itemsRef": "items",
                        "itemAlias": "item",
                        "indexAlias": "index",
                        "axis": "vertical",
                        "maxItems": 1,
                        "width": { "mode": "fill" },
                        "height": { "mode": "fill" },
                        "style": { "borderToken": "none", "paddingPx": 0 },
                        "child": {
                            "id": "line",
                            "type": "primitive_instance",
                            "primitiveType": "line",
                            "width": { "mode": "fill" },
                            "height": { "mode": "fixed_px", "value": 1 },
                            "style": { "borderToken": "none", "paddingPx": 0 },
                            "props": { "lineDirection": "horizontal" }
                        }
                    }
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({
                "metaQueries": {
                    "query": {
                        "items": [{ "summary": "one" }]
                    }
                },
                "now": "2026-04-24T22:00:00+02:00"
            }),
            "layout-foreach-fill",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        let image = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgba8();
        let black_pixels = (0..32)
            .filter(|x| image.get_pixel(*x, 0).0[0..3] == [0, 0, 0])
            .count();
        assert_eq!(black_pixels, 32);
    }

    #[test]
    fn bar_chart_rejects_query_binding() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tiny",
                "width": 32,
                "height": 16,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-bar-chart",
                "displayTypeId": "tiny",
                "rootNode": {
                    "id": "script",
                    "type": "script",
                    "source": "return { chart: [1, 2, 3] };",
                    "outputMode": "merge_object",
                    "bindings": {},
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "child": {
                        "id": "bars",
                        "type": "primitive_instance",
                        "primitiveType": "bar_chart",
                        "width": { "mode": "fill" },
                        "height": { "mode": "fill" },
                        "style": { "borderToken": "none", "paddingPx": 0 },
                        "bindings": { "value": "chart", "query": "" },
                        "props": { "valueKey": "value" }
                    }
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({ "now": "2026-04-24T22:00:00+02:00" }),
            "layout-bar-chart",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        assert!(rendered
            .script_warnings
            .unwrap_or_default()
            .iter()
            .any(|warning| warning.contains("rendered placeholder")));
        let reason = unsupported_layout_preview_reason(
            &project_value,
            &json!({ "layoutId": "layout-bar-chart" }),
        );
        assert!(reason.contains("unsupported primitive binding keys"));
        assert!(reason.contains("query"));
    }

    #[test]
    fn bar_chart_renders_json_literal_data() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "accentRole": "fg",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tiny",
                "width": 40,
                "height": 20,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-bar-chart",
                "displayTypeId": "tiny",
                "rootNode": {
                    "id": "bars",
                    "type": "primitive_instance",
                    "primitiveType": "bar_chart",
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "bindings": { "value": "[1,2,3,4,5,6,7,8,9,10]" },
                    "props": { "minValue": 0, "maxValue": 10, "baselineValue": 0, "barGapPx": 1, "colorRole": "fg" }
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({ "now": "2026-04-24T22:00:00+02:00" }),
            "layout-bar-chart",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        let image = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgba8();
        let black_pixels = image
            .pixels()
            .filter(|pixel| pixel.0[0..3] == [0, 0, 0])
            .count();
        assert!(black_pixels > 20, "bar chart should draw visible bars");
    }

    #[test]
    fn bar_chart_highlights_indexes_and_object_flags() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "accentRole": "fg",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tiny",
                "width": 30,
                "height": 10,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-bar-chart",
                "displayTypeId": "tiny",
                "rootNode": {
                    "id": "bars",
                    "type": "primitive_instance",
                    "primitiveType": "bar_chart",
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "bindings": { "value": "[1,1,1]", "highlightIndexes": "[1]" },
                    "props": { "minValue": 0, "maxValue": 1, "baselineValue": 0, "barGapPx": 0, "colorRole": "fg", "highlightColorRole": "accent" }
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({}),
            "layout-bar-chart",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        let image = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgba8();
        assert_eq!(image.get_pixel(5, 9).0, [0, 0, 0, 255]);
        assert_eq!(image.get_pixel(15, 9).0, [255, 0, 0, 255]);
        assert_eq!(image.get_pixel(25, 9).0, [0, 0, 0, 255]);

        let mut object_project = project_value.clone();
        object_project["layoutDefinitions"][0]["rootNode"]["bindings"] =
            json!({ "value": "[{\"value\":1},{\"value\":1,\"highlight\":true},{\"value\":1}]" });
        object_project["layoutDefinitions"][0]["rootNode"]["props"]["valueKey"] = json!("value");
        object_project["layoutDefinitions"][0]["rootNode"]["props"]["highlightKey"] =
            json!("highlight");
        let rendered = render_layout_preview(
            &object_project,
            &json!({}),
            &json!({}),
            "layout-bar-chart",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        let image = image::load_from_memory(&rendered.png_bytes)
            .unwrap()
            .to_rgba8();
        assert_eq!(image.get_pixel(15, 9).0, [255, 0, 0, 255]);
    }

    #[test]
    fn render_layout_preview_draws_placeholder_for_unsupported_node() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tri296x128-red",
                "width": 296,
                "height": 128,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-unsupported",
                "displayTypeId": "tri296x128-red",
                "rootNode": {
                    "id": "unsupported-primitive",
                    "type": "primitive_instance",
                    "primitiveType": "graph",
                    "width": { "mode": "fill" },
                    "height": { "mode": "fill" },
                    "style": { "borderToken": "none", "paddingPx": 0 },
                    "props": {}
                }
            }]
        });
        let rendered = render_layout_preview(
            &project_value,
            &json!({}),
            &json!({ "entities": {}, "now": "2026-04-24T22:00:00+02:00" }),
            "layout-unsupported",
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .unwrap();
        assert!(rendered.hash.starts_with("native-layout:"));
        assert!(rendered
            .script_warnings
            .unwrap_or_default()
            .iter()
            .any(|warning| warning.contains("rendered placeholder")));
    }

    #[test]
    fn assigned_preview_ignores_mismatched_default_layout_size() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [
                {
                    "id": "small",
                    "width": 296,
                    "height": 128,
                    "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
                },
                {
                    "id": "large",
                    "width": 400,
                    "height": 300,
                    "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
                }
            ],
            "devices": [{
                "id": "display-large",
                "displayTypeId": "large",
                "managed": true,
                "virtual": false
            }],
            "deviceAssignments": [{
                "id": "assignment-large",
                "displayId": "display-large",
                "defaultFullscreenLayoutId": "layout-small",
                "fullscreenRules": [],
                "popupRules": []
            }],
            "layoutDefinitions": [
                {
                    "id": "layout-small",
                    "kind": "fullscreen",
                    "displayTypeId": "small",
                    "rootNode": {
                        "id": "small-root",
                        "type": "stack",
                        "axis": "vertical",
                        "children": []
                    }
                },
                {
                    "id": "layout-large",
                    "kind": "fullscreen",
                    "displayTypeId": "large",
                    "rootNode": {
                        "id": "large-root",
                        "type": "stack",
                        "axis": "vertical",
                        "children": []
                    }
                }
            ]
        });
        let rendered = try_render_assigned_preview(
            &project_value,
            &json!({}),
            &json!({ "entities": {}, "now": "2026-04-25T10:00:00Z" }),
            "display-large",
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(rendered.width, 400);
        assert_eq!(rendered.height, 300);
    }

    #[test]
    fn assigned_preview_renders_layout_at_assigned_display_size() {
        let project_value = json!({
            "id": "demo",
            "name": "Demo",
            "locale": "en-US",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [
                {
                    "id": "small",
                    "width": 296,
                    "height": 128,
                    "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
                },
                {
                    "id": "large",
                    "width": 400,
                    "height": 300,
                    "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
                }
            ],
            "devices": [{
                "id": "display-large",
                "displayTypeId": "large",
                "managed": true,
                "virtual": false
            }],
            "deviceAssignments": [{
                "id": "assignment-large",
                "displayId": "display-large",
                "defaultFullscreenLayoutId": "layout-small",
                "fullscreenRules": [],
                "popupRules": []
            }],
            "layoutDefinitions": [{
                "id": "layout-small",
                "kind": "fullscreen",
                "displayTypeId": "small",
                "rootNode": {
                    "id": "small-root",
                    "type": "stack",
                    "axis": "vertical",
                    "children": []
                }
            }]
        });
        let rendered = try_render_assigned_preview(
            &project_value,
            &json!({}),
            &json!({ "entities": {}, "now": "2026-04-25T10:00:00Z" }),
            "display-large",
            Some("Live data unavailable".into()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(rendered.width, 400);
        assert_eq!(rendered.height, 300);
        assert!(rendered
            .hash
            .starts_with("native-layout:layout-small:large:"));
        assert_eq!(
            rendered.data_source_message.as_deref(),
            Some("Live data unavailable")
        );
    }

    #[test]
    fn calendar_layout_supported_natively() {
        let project_value = demo_project();
        let project: ProjectView = serde_json::from_value(project_value.clone()).unwrap();
        let root = project
            .layout_definitions
            .iter()
            .find(|layout| layout.id == "layout-a93ccdde")
            .and_then(|layout| layout.root_node.as_ref())
            .unwrap();
        assert!(
            node_supported_with_project(&project, root),
            "{:?}",
            first_unsupported(&project, root)
        );
    }

    #[test]
    fn dutch_format_tokens_do_not_corrupt_weekday_or_month() {
        let value = Value::String("2026-04-25".into());
        assert_eq!(
            format_scope_value(&value, "dddd", "nl-NL"),
            Value::String("zaterdag".into())
        );
        assert_eq!(
            format_scope_value(&value, "d mmmm", "nl-NL"),
            Value::String("25 april".into())
        );
    }

    #[test]
    fn template_to_json_filter_serializes_objects() {
        let rendered = render_template(
            "{{ weather |to_json }}",
            &json!({ "weather": { "temperature": "16.6", "condition": "cloudy" } }),
            "en-US",
        )
        .unwrap();
        assert_eq!(
            rendered,
            "{\"condition\":\"cloudy\",\"temperature\":\"16.6\"}"
        );
    }

    #[test]
    fn widget_value_binding_resolves_scope_paths_and_filters() {
        let scope = json!({
            "weather": {
                "current": {
                    "temperature_2m": 16.6,
                    "icon": "fa-solid:cloud"
                }
            }
        });
        assert_eq!(
            binding_scope_text(
                &scope,
                Some(&"weather.current.temperature_2m".to_string()),
                "en-US"
            ),
            Some("16.6".into())
        );
        assert_eq!(
            binding_scope_text(&scope, Some(&"weather.current.icon".to_string()), "en-US"),
            Some("fa-solid:cloud".into())
        );
        assert_eq!(
            binding_scope_text(
                &scope,
                Some(&"weather.current | to_json".to_string()),
                "en-US"
            ),
            Some(r#"{"icon":"fa-solid:cloud","temperature_2m":16.6}"#.into())
        );
    }

    #[test]
    fn primitive_value_binding_supported_natively() {
        let node: Node = serde_json::from_value(json!({
            "id": "node-value-text",
            "type": "primitive_instance",
            "primitiveType": "text",
            "bindings": {
                "entity": "",
                "value": "weather.current.temperature_2m"
            },
            "props": {
                "text": "",
                "renderEntityState": false,
                "autoFit": true
            },
            "style": { "borderToken": "none", "paddingPx": 4 },
            "width": { "mode": "fill" },
            "height": { "mode": "fill" }
        }))
        .unwrap();
        assert!(node_supported(&node));
        assert_eq!(unsupported_node_self_reason(&node), None);
    }

    #[test]
    fn line_layout_supported_natively() {
        let project: ProjectView = serde_json::from_value(json!({
            "id": "demo",
            "name": "Demo",
            "locale": "nl-NL",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tri296x128-red",
                "width": 296,
                "height": 128,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-line",
                "displayTypeId": "tri296x128-red",
                "rootNode": {
                    "id": "root",
                    "type": "stack",
                    "axis": "vertical",
                    "children": [{
                        "id": "line1",
                        "type": "primitive_instance",
                        "primitiveType": "line",
                        "props": { "lineDirection": "diag_down" },
                        "width": { "mode": "fill" },
                        "height": { "mode": "fill" }
                    }]
                }
            }]
        }))
        .unwrap();
        let root = project.layout_definitions[0].root_node.as_ref().unwrap();
        assert!(
            node_supported_with_project(&project, root),
            "{:?}",
            first_unsupported(&project, root)
        );
    }

    #[test]
    fn icon_layout_supported_natively() {
        let project: ProjectView = serde_json::from_value(json!({
            "id": "demo",
            "name": "Demo",
            "locale": "nl-NL",
            "fontPresets": { "tiny": 8, "normal": 12, "header": 24 },
            "themes": [{
                "id": "classic-outline",
                "text": { "title": "fg", "body": "fg", "value": "fg" }
            }],
            "displayTypes": [{
                "id": "tri296x128-red",
                "width": 296,
                "height": 128,
                "palette": { "bg": "#ffffff", "fg": "#000000", "accent": "#ff0000" }
            }],
            "layoutDefinitions": [{
                "id": "layout-icon",
                "displayTypeId": "tri296x128-red",
                "rootNode": {
                    "id": "root",
                    "type": "stack",
                    "axis": "vertical",
                    "children": [{
                        "id": "icon1",
                        "type": "primitive_instance",
                        "primitiveType": "icon",
                        "props": { "icon": "fa-solid:bolt" },
                        "width": { "mode": "fill" },
                        "height": { "mode": "fill" }
                    }]
                }
            }]
        }))
        .unwrap();
        let root = project.layout_definitions[0].root_node.as_ref().unwrap();
        assert!(
            node_supported_with_project(&project, root),
            "{:?}",
            first_unsupported(&project, root)
        );
    }
}
