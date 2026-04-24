use std::collections::HashMap;

use base64::Engine;
use boa_engine::{Context as BoaContext, Source};
use epd_text_engine::{
    render as render_text_layout, FontFamilyData as EngineFontFamilyData,
    FontPresets as EngineFontPresets, LayoutRequest, TextLayoutRun,
    TextStyle as EngineTextStyle,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{rgba_to_png, ApiError};

const COLOR_BG: u8 = 0;
const COLOR_FG: u8 = 1;
const COLOR_ACCENT: u8 = 2;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectView {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    locale: String,
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
    #[serde(rename = "autoFitFontFamily")]
    auto_fit_font_family: Option<String>,
    #[serde(rename = "fontRoles")]
    font_roles: Option<ThemeFontRoles>,
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
    normal: Option<PartialTextStyle>,
    header: Option<PartialTextStyle>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartialTextStyle {
    family: Option<String>,
    pixel_size: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PaletteRole {
    #[default]
    Bg,
    Fg,
    Accent,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFontFamilyData {
    regular: Option<String>,
    italic: Option<String>,
    bold: Option<String>,
    #[serde(rename = "boldItalic")]
    bold_italic: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutDefinition {
    id: String,
    #[serde(rename = "displayTypeId")]
    display_type_id: String,
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
    #[serde(rename = "themeId")]
    theme_id: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetProps {
    text: Option<String>,
    prefix: Option<String>,
    suffix: Option<String>,
    unit: Option<String>,
    #[serde(rename = "fixedPixelSize")]
    fixed_pixel_size: Option<u32>,
    #[serde(rename = "renderEntityState")]
    render_entity_state: Option<bool>,
    #[serde(rename = "paddingPx")]
    padding_px: Option<i32>,
    #[allow(dead_code)]
    #[serde(rename = "fontRole")]
    font_role: Option<String>,
    #[serde(rename = "horizontalAlign")]
    horizontal_align: Option<String>,
    #[serde(rename = "verticalAlign")]
    vertical_align: Option<String>,
    #[serde(rename = "autoFit")]
    auto_fit: Option<bool>,
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

fn role_color(role: PaletteRole) -> u8 {
    match role {
        PaletteRole::Bg => COLOR_BG,
        PaletteRole::Fg => COLOR_FG,
        PaletteRole::Accent => COLOR_ACCENT,
    }
}

fn resolve_font_family_data(
    family: &str,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Option<RuntimeFontFamilyData> {
    user_fonts.get(family).cloned()
}

fn get_size_value(spec: &Option<SizeSpec>, total: i32) -> Option<i32> {
    let spec = spec.as_ref()?;
    match spec.mode.as_deref() {
        Some("fixed_px") => spec.value.map(|value| value.round() as i32),
        Some("fraction") => spec.value.map(|value| (value * total as f64).round() as i32),
        _ => None,
    }
}

fn node_padding(style: &LayoutStyle, props_padding: Option<i32>) -> i32 {
    props_padding.unwrap_or(style.padding_px.unwrap_or(0)).max(0)
}

fn unsupported_border(style: &LayoutStyle) -> bool {
    style
        .border_token
        .as_deref()
        .is_some_and(|value| value != "none")
}

fn node_width_spec(node: &Node) -> Option<&SizeSpec> {
    match node {
        Node::Stack { width, .. } | Node::Zstack { width, .. } | Node::Grid { width, .. } => width.as_ref(),
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
        Node::Stack { height, .. } | Node::Zstack { height, .. } | Node::Grid { height, .. } => height.as_ref(),
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

fn theme_for_node<'a>(project: &'a ProjectView, style: &LayoutStyle) -> &'a WidgetTheme {
    if let Some(theme_id) = style.theme_id.as_deref() {
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
            if !matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
                return false;
            }
            if !matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
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
            if !matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
                return false;
            }
            if !matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
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
            if !matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
                return false;
            }
            if !matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content") | Some("fit_glyph_bounds") | Some("intrinsic_font_height")) {
                return false;
            }
            rows.iter().all(|track| matches!(track.size.mode.as_deref(), None | Some("fill") | Some("fixed_px") | Some("fraction")))
                && columns.iter().all(|track| matches!(track.size.mode.as_deref(), None | Some("fill") | Some("fixed_px") | Some("fraction")))
                && children.iter().all(|child| node_supported(&child.node))
        }
        Node::DataQuery(node) => {
            if unsupported_border(&node.style) || node.query_kind != "calendar_events" {
                return false;
            }
            matches!(node.width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
                && matches!(node.height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
                && node.child.as_deref().is_some_and(node_supported)
        }
        Node::ForEach(node) => {
            if unsupported_border(&node.style) || !matches!(node.axis.as_str(), "horizontal" | "vertical") {
                return false;
            }
            matches!(node.width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
                && matches!(node.height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
                && node.child.as_deref().is_some_and(node_supported)
        }
        Node::CompoundRef(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            matches!(node.width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
                && matches!(node.height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content"))
        }
        Node::Script(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            if !matches!(node.width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")) {
                return false;
            }
            if !matches!(node.height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")) {
                return false;
            }
            node.bindings.values().all(|value| binding_supported(value))
                && node.child.as_deref().is_some_and(node_supported)
        }
        Node::IfElse(node) => {
            if unsupported_border(&node.style) {
                return false;
            }
            if !matches!(node.width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")) {
                return false;
            }
            if !matches!(node.height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction") | Some("fit_content")) {
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
            if !matches!(primitive_type.as_str(), "text" | "number") {
                return false;
            }
            if unsupported_border(style) {
                return false;
            }
            if !matches!(
                width.as_ref().and_then(|spec| spec.mode.as_deref()),
                None
                    | Some("fill")
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
                None
                    | Some("fill")
                    | Some("fixed_px")
                    | Some("fraction")
                    | Some("fit_content")
                    | Some("fit_glyph_bounds")
                    | Some("intrinsic_font_height")
            ) {
                return false;
            }
            if props.text.as_deref().is_some_and(|value| value.contains("{{") || value.contains('\n')) {
                if !props.text.as_deref().is_some_and(template_supported) {
                    return false;
                }
            }
            if props.prefix.as_deref().is_some_and(|value| !template_supported(value)) {
                return false;
            }
            if props.suffix.as_deref().is_some_and(|value| !template_supported(value)) {
                return false;
            }
            if props.unit.as_deref().is_some_and(|value| !template_supported(value)) {
                return false;
            }
            bindings.keys().all(|key| key == "entity")
        }
        Node::Spacer { width, height, .. } => {
            matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction"))
                && matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction"))
        }
        Node::Unsupported => false,
    }
}

fn node_supported_with_project(project: &ProjectView, node: &Node) -> bool {
    if !node_supported(node) {
        return false;
    }
    match node {
        Node::Stack { children, .. } | Node::Zstack { children, .. } => {
            children.iter().all(|child| node_supported_with_project(project, child))
        }
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
        if !base.trim().split('.').all(simple_identifier) {
            return false;
        }
        for filter in segments {
            let trimmed = filter.trim();
            if trimmed == "title" || trimmed == "downcase" || trimmed == "upcase" {
                continue;
            }
            if let Some(args) = trimmed.strip_prefix("format(").and_then(|rest| rest.strip_suffix(')')) {
                let arg = args.trim();
                if ((arg.starts_with('"') && arg.ends_with('"')) || (arg.starts_with('\'') && arg.ends_with('\'')))
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

fn format_date_part(date: chrono::DateTime<chrono::Utc>, locale: &str, options: chrono::format::StrftimeItems<'_>) -> String {
    let _ = locale;
    date.format_with_items(options).to_string()
}

fn parse_date_like_parts(value: &Value, locale: &str) -> Option<HashMap<String, String>> {
    let _ = locale;
    if let Some(object) = value.as_object() {
        for key in ["dateTime", "datetime", "date", "iso", "value", "start", "start_time"] {
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
    let parsed = chrono::DateTime::parse_from_rfc3339(&text)
        .map(|value| value.with_timezone(&chrono::Utc))
        .or_else(|_| chrono::NaiveDate::parse_from_str(&text, "%Y-%m-%d").map(|value| value.and_hms_opt(0, 0, 0).unwrap().and_utc()))
        .ok()?;
    let mut parts = HashMap::new();
    parts.insert("dddd".into(), parsed.format("%A").to_string());
    parts.insert("ddd".into(), parsed.format("%a").to_string());
    parts.insert("mmmm".into(), parsed.format("%B").to_string());
    parts.insert("mmm".into(), parsed.format("%b").to_string());
    parts.insert("yyyy".into(), parsed.format("%Y").to_string());
    parts.insert("yy".into(), parsed.format("%y").to_string());
    parts.insert("mm".into(), parsed.format("%m").to_string());
    parts.insert("m".into(), parsed.format("%-m").to_string());
    parts.insert("dd".into(), parsed.format("%d").to_string());
    parts.insert("d".into(), parsed.format("%-d").to_string());
    parts.insert("HH".into(), parsed.format("%H").to_string());
    parts.insert("H".into(), parsed.format("%-H").to_string());
    parts.insert("hh".into(), parsed.format("%I").to_string());
    parts.insert("h".into(), parsed.format("%-I").to_string());
    parts.insert("MM".into(), parsed.format("%M").to_string());
    parts.insert("M".into(), parsed.format("%-M").to_string());
    parts.insert("ss".into(), parsed.format("%S").to_string());
    parts.insert("s".into(), parsed.format("%-S").to_string());
    Some(parts)
}

fn format_scope_value(value: &Value, pattern: &str, locale: &str) -> Value {
    let _ = format_date_part; // keep helper anchored
    let Some(parts) = parse_date_like_parts(value, locale) else {
        return value.clone();
    };
    let mut out = pattern.to_string();
    for token in ["dddd", "ddd", "mmmm", "mmm", "yyyy", "yy", "HH", "H", "hh", "h", "MM", "M", "ss", "s", "mm", "m", "dd", "d"] {
        out = out.replace(token, parts.get(token).map(String::as_str).unwrap_or(token));
    }
    Value::String(out)
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
    if let Some(args) = trimmed.strip_prefix("format(").and_then(|rest| rest.strip_suffix(')')) {
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
    if (trimmed.starts_with('"') && trimmed.ends_with('"')) || (trimmed.starts_with('\'') && trimmed.ends_with('\'')) {
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
    let base = segments.first().map(String::as_str).unwrap_or(trimmed).trim();
    let mut current = scope_value(scope, base).unwrap_or(Value::Null);
    for segment in segments.into_iter().skip(1) {
        current = apply_template_filter(current, &segment, locale);
    }
    current
}

fn scope_value(scope: &Value, path: &str) -> Option<Value> {
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
    if let (Some(scope_object), Some(derived_object)) = (merged.as_object_mut(), derived.as_object()) {
        for (key, value) in derived_object {
            scope_object.insert(key.clone(), value.clone());
        }
    }
    merged
}

fn build_array_item_scope(scope: &Value, value: &Value, index: usize, item_alias: &str, index_alias: &str) -> Value {
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

fn evaluate_array_expression(expression: &str, scope: &Value, locale: &str, item_alias: &str, index_alias: &str) -> Vec<Value> {
    let segments = split_top_level(expression, '|');
    let base = segments.first().cloned().unwrap_or_default();
    let mut current = match resolve_scope_or_literal_expression(&base, scope, locale) {
        Value::Array(items) => items,
        _ => Vec::new(),
    };
    for stage in segments.into_iter().skip(1) {
        let trimmed = stage.trim();
        if let Some(condition) = trimmed.strip_prefix("filter(").and_then(|rest| rest.strip_suffix(')')) {
            current = current
                .into_iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let item_scope = build_array_item_scope(scope, &value, index, item_alias, index_alias);
                    match evaluate_js_bool(condition, &item_scope) {
                        Ok(true) => Some(value),
                        _ => None,
                    }
                })
                .collect();
            continue;
        }
        if let Some(template_expr) = trimmed.strip_prefix("unique_by(").and_then(|rest| rest.strip_suffix(')')) {
            let template = match resolve_scope_or_literal_expression(template_expr, scope, locale) {
                Value::String(text) => text,
                other => stringify_scope_value(&other),
            };
            let mut seen = std::collections::HashSet::new();
            current = current
                .into_iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let item_scope = build_array_item_scope(scope, &value, index, item_alias, index_alias);
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

fn run_js_json(script: &str, scope: &Value, bindings: &Value, globals: &Value) -> Result<Value, ApiError> {
    let mut context = BoaContext::default();
    let scope_json = serde_json::to_string(scope).map_err(|error| ApiError::internal(error.to_string()))?;
    let bindings_json = serde_json::to_string(bindings).map_err(|error| ApiError::internal(error.to_string()))?;
    let globals_json = serde_json::to_string(globals).map_err(|error| ApiError::internal(error.to_string()))?;
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
    let scope_json = serde_json::to_string(scope).map_err(|error| ApiError::internal(error.to_string()))?;
    let source = format!(
        "(function(){{ const scope = {scope_json}; {decls} return Boolean({expression}); }})()",
        decls = scope_declarations(scope)
    );
    let value = context
        .eval(Source::from_bytes(source.as_bytes()))
        .map_err(|error| ApiError::internal(error.to_string()))?;
    Ok(value.to_boolean())
}

fn text_run(
    text: &str,
    family: &str,
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
            weight: "regular".into(),
            slope: "roman".into(),
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
            regular: family_data.regular,
            italic: family_data.italic,
            bold: family_data.bold,
            bold_italic: family_data.bold_italic,
        },
        render_mode: "mono_hint".into(),
        threshold: 128,
        oversample_factor: 1,
    })
    .map_err(ApiError::internal)?;
    Ok(Some(run))
}

fn painted_bounds(run: &TextLayoutRun) -> (i32, i32) {
    let mut max_x = 0;
    let mut max_y = 0;
    for glyph in &run.glyphs {
        if glyph.width <= 0 || glyph.height <= 0 {
            continue;
        }
        max_x = max_x.max(glyph.x + glyph.width);
        max_y = max_y.max(glyph.y + glyph.height);
    }
    (max_x.max(1), max_y.max(1))
}

fn auto_fit_pixel_size(
    text: &str,
    family: &str,
    tabular: bool,
    frame: Rect,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<u32>, ApiError> {
    let mut low = 4u32;
    let mut high = frame.h.max(4) as u32;
    let mut best = None;
    while low <= high {
        let mid = low + (high - low) / 2;
        let Some(run) = text_run(text, family, mid, tabular, presets, user_fonts)? else {
            return Ok(None);
        };
        let (w, h) = painted_bounds(&run);
        if w <= frame.w && h <= frame.h {
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

fn draw_text_run(canvas: &mut IndexedCanvas, run: &TextLayoutRun, x: i32, y: i32, color: u8) {
    for glyph in &run.glyphs {
        for (gy, row) in glyph.pixels.iter().enumerate() {
            for (gx, pixel) in row.iter().enumerate() {
                if *pixel != 0 {
                    canvas.set_pixel(x + glyph.x + gx as i32, y + glyph.y + gy as i32, color);
                }
            }
        }
    }
}

fn primitive_render_spec(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<(String, String, u8, bool, u32, String, String, i32)>, ApiError> {
    let Node::PrimitiveInstance {
        primitive_type,
        props,
        bindings,
        style,
        ..
    } = node else {
        return Ok(None);
    };
    let theme = theme_for_node(project, style);
    let padding = node_padding(style, props.padding_px);
    let (text, family, color, tabular, default_px, h_align, v_align) = if primitive_type == "text" {
        let text = if props.render_entity_state.unwrap_or(false) {
            bindings
                .get("entity")
                .map(|entity_id| render_template(entity_id, scope, &project.locale).unwrap_or_else(|| entity_id.clone()))
                .map(|entity_id| entity_state_text(scope, &entity_id))
                .unwrap_or_default()
        } else {
            props
                .text
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default()
        };
        (
            text,
            theme
                .font_roles
                .as_ref()
                .and_then(|roles| roles.normal.as_ref())
                .and_then(|style| style.family.clone())
                .or_else(|| theme.auto_fit_font_family.clone())
                .unwrap_or_else(|| "arial".into()),
            role_color(theme.text.body),
            false,
            theme
                .font_roles
                .as_ref()
                .and_then(|roles| roles.normal.as_ref())
                .and_then(|style| style.pixel_size)
                .unwrap_or(project.font_presets.normal),
            props.horizontal_align.as_deref().unwrap_or("left").to_string(),
            props.vertical_align.as_deref().unwrap_or("top").to_string(),
        )
    } else {
        let mut value = bindings
            .get("entity")
            .map(|entity_id| render_template(entity_id, scope, &project.locale).unwrap_or_else(|| entity_id.clone()))
            .map(|entity_id| entity_state_text(scope, &entity_id))
            .unwrap_or_default();
        if let Some(unit) = &props.unit {
            value.push_str(&render_template(unit, scope, &project.locale).unwrap_or_else(|| unit.clone()));
        }
        let text = format!(
            "{}{}{}",
            props
                .prefix
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default(),
            value,
            props
                .suffix
                .as_deref()
                .and_then(|value| render_template(value, scope, &project.locale))
                .unwrap_or_default()
        );
        (
            text,
            theme
                .font_roles
                .as_ref()
                .and_then(|roles| roles.header.as_ref())
                .and_then(|style| style.family.clone())
                .or_else(|| theme.auto_fit_font_family.clone())
                .unwrap_or_else(|| "arial".into()),
            role_color(theme.text.value),
            true,
            theme
                .font_roles
                .as_ref()
                .and_then(|roles| roles.header.as_ref())
                .and_then(|style| style.pixel_size)
                .unwrap_or(project.font_presets.header),
            props.horizontal_align.as_deref().unwrap_or("center").to_string(),
            props.vertical_align.as_deref().unwrap_or("middle").to_string(),
        )
    };
    if text.is_empty() {
        return Ok(None);
    }
    let _ = user_fonts;
    Ok(Some((text, family, color, tabular, default_px, h_align, v_align, padding)))
}

fn measure_primitive(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<(i32, i32)>, ApiError> {
    let Some((text, family, _color, tabular, pixel_size, _h_align, _v_align, padding)) =
        primitive_render_spec(project, scope, node, user_fonts)?
    else {
        return Ok(None);
    };
    let Some(run) = text_run(&text, &family, pixel_size, tabular, &project.font_presets, user_fonts)? else {
        return Ok(None);
    };
    let (painted_w, painted_h) = painted_bounds(&run);
    Ok(Some((painted_w + padding * 2, painted_h + padding * 2)))
}

fn measure_node(
    project: &ProjectView,
    scope: &Value,
    node: &Node,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Result<Option<(i32, i32)>, ApiError> {
    match node {
        Node::PrimitiveInstance { .. } => measure_primitive(project, scope, node, user_fonts),
        Node::Stack { axis, children, style, .. } => {
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
            let globals = globals_value(project, scope, Rect { x: 0, y: 0, w: 0, h: 0 });
            let bindings = Value::Object(
                node.bindings
                    .iter()
                    .map(|(key, value)| {
                        let resolved = if value.contains("{{") {
                            render_template(value, scope, &project.locale)
                                .map(Value::String)
                                .unwrap_or(Value::Null)
                        } else {
                            scope_value(scope, value).unwrap_or_else(|| Value::String(value.clone()))
                        };
                        (key.clone(), resolved)
                    })
                    .collect(),
            );
            let derived = run_js_json(&node.source, scope, &bindings, &globals)?;
            let merged_scope = if derived.is_object() { merge_scope(scope, &derived) } else { scope.clone() };
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
            let Some(definition) = project
                .widget_definitions
                .iter()
                .find(|definition| definition.id == node.definition_id && definition.kind == "compound")
            else {
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
                        .map(|value| render_template(value, scope, &project.locale).unwrap_or_else(|| value.clone()))
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
            let date = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("meta"))
                .and_then(|value| value.get("date"))
                .cloned()
                .unwrap_or(Value::String(String::new()));
            if let Some(object) = nested_scope.as_object_mut() {
                object.insert(node.variable_name.clone(), items);
                object.insert(
                    node.date_variable_name.clone().unwrap_or_else(|| "date".into()),
                    date,
                );
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
                let item_scope = build_array_item_scope(scope, &value, index, &node.item_alias, &node.index_alias);
                if let Some((child_w, child_h)) = measure_node(project, &item_scope, template, user_fonts)? {
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
    let Node::PrimitiveInstance { props, .. } = node else {
        return Ok(());
    };
    let Some((text, family, color, tabular, default_px, h_align, v_align, padding)) =
        primitive_render_spec(project, scope, node, user_fonts)?
    else {
        return Ok(());
    };
    let inner = Rect {
        x: frame.x + padding,
        y: frame.y + padding,
        w: (frame.w - padding * 2).max(1),
        h: (frame.h - padding * 2).max(1),
    };
    let pixel_size = if props.auto_fit.unwrap_or(false) {
        auto_fit_pixel_size(&text, &family, tabular, inner, &project.font_presets, user_fonts)?
            .unwrap_or(default_px)
    } else {
        props.fixed_pixel_size.unwrap_or(default_px)
    };
    let Some(run) = text_run(&text, &family, pixel_size, tabular, &project.font_presets, user_fonts)? else {
        return Ok(());
    };
    let (painted_w, painted_h) = painted_bounds(&run);
    let draw_x = match h_align.as_str() {
        "center" => inner.x + ((inner.w - painted_w) / 2),
        "right" => inner.x + inner.w - painted_w,
        _ => inner.x,
    };
    let draw_y = match v_align.as_str() {
        "middle" => inner.y + ((inner.h - painted_h) / 2),
        "bottom" => inner.y + inner.h - painted_h,
        _ => inner.y,
    };
    draw_text_run(canvas, &run, draw_x, draw_y, color);
    Ok(())
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
            Node::Stack { width, height, style, .. } => (width, height, style, None),
            Node::Zstack { width, height, style, .. } => (width, height, style, None),
            Node::Grid { width, height, style, .. } => (width, height, style, None),
            Node::DataQuery(node) => (&node.width, &node.height, &node.style, None),
            Node::ForEach(node) => (&node.width, &node.height, &node.style, None),
            Node::CompoundRef(node) => (&node.width, &node.height, &node.style, None),
            Node::Script(node) => (&node.width, &node.height, &node.style, None),
            Node::IfElse(node) => (&node.width, &node.height, &node.style, None),
            Node::PrimitiveInstance { width, height, style, props, .. } => (width, height, style, props.padding_px),
            Node::Spacer { width, height, style, .. } => (width, height, style, None),
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
    let flex_size = if flex_count > 0 { remaining / flex_count } else { 0 };
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
        let measured = get_size_value(&Some(track.size.clone()), available).map(|value| value.max(1));
        if let Some(value) = measured {
            fixed += value;
            sizes.push(Some(value));
        } else {
            flex_count += 1;
            sizes.push(None);
        }
    }
    let remaining = (available - fixed).max(0);
    let flex_size = if flex_count > 0 { remaining / flex_count } else { 0 };
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
) -> Result<(), ApiError> {
    match node {
        Node::Stack {
            axis,
            children,
            style,
            ..
        } => {
            let padding = style.padding_px.unwrap_or(0).max(0);
            let gap = style.gap_px.unwrap_or(0).max(0);
            let inner = Rect {
                x: frame.x + padding,
                y: frame.y + padding,
                w: (frame.w - padding * 2).max(1),
                h: (frame.h - padding * 2).max(1),
            };
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
                render_node(canvas, project, scope, child, *child_frame, user_fonts)?;
            }
            Ok(())
        }
        Node::Zstack { children, style, .. } => {
            let padding = style.padding_px.unwrap_or(0).max(0);
            let inner = Rect {
                x: frame.x + padding,
                y: frame.y + padding,
                w: (frame.w - padding * 2).max(1),
                h: (frame.h - padding * 2).max(1),
            };
            for child in children {
                render_node(canvas, project, scope, child, inner, user_fonts)?;
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
            let padding = style.padding_px.unwrap_or(0).max(0);
            let gap = style.gap_px.unwrap_or(0).max(0);
            let inner = Rect {
                x: frame.x + padding,
                y: frame.y + padding,
                w: (frame.w - padding * 2).max(1),
                h: (frame.h - padding * 2).max(1),
            };
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
                render_node(canvas, project, scope, &child.node, child_frame, user_fonts)?;
            }
            Ok(())
        }
        Node::DataQuery(node) => {
            let mut nested_scope = scope.clone();
            let items = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("items"))
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new()));
            let date = scope
                .get("metaQueries")
                .and_then(|value| value.get(&node.id))
                .and_then(|value| value.get("meta"))
                .and_then(|value| value.get("date"))
                .cloned()
                .unwrap_or(Value::String(String::new()));
            if let Some(object) = nested_scope.as_object_mut() {
                object.insert(node.variable_name.clone(), items);
                object.insert(
                    node.date_variable_name.clone().unwrap_or_else(|| "date".into()),
                    date,
                );
            }
            if let Some(child) = node.child.as_deref() {
                render_node(canvas, project, &nested_scope, child, frame, user_fonts)?;
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
            let padding = node.style.padding_px.unwrap_or(0).max(0);
            let inner = Rect {
                x: frame.x + padding,
                y: frame.y + padding,
                w: (frame.w - padding * 2).max(1),
                h: (frame.h - padding * 2).max(1),
            };
            let horizontal = node.axis == "horizontal";
            let available_main = if horizontal { inner.w } else { inner.h } - gap * (count.saturating_sub(1) as i32);
            let template_spec = if horizontal { node_width_spec(template) } else { node_height_spec(template) };
            let shared_main = match template_spec.and_then(|spec| spec.mode.as_deref()) {
                None | Some("fill") | Some("fraction") => Some((available_main.max(0) / count.max(1) as i32).max(1)),
                _ => None,
            };
            let mut cursor = if horizontal { inner.x } else { inner.y };
            for (index, value) in values.into_iter().take(count).enumerate() {
                let item_scope = build_array_item_scope(scope, &value, index, &node.item_alias, &node.index_alias);
                let measured = measure_node(project, &item_scope, template, user_fonts)?.unwrap_or((inner.w, inner.h));
                let main = shared_main.unwrap_or(if horizontal { measured.0 } else { measured.1 }).max(1);
                let cross = if horizontal { measured.1.min(inner.h) } else { measured.0.min(inner.w) }.max(1);
                let child_frame = if horizontal {
                    Rect { x: cursor, y: inner.y, w: main.min(inner.w.max(1)), h: cross }
                } else {
                    Rect { x: inner.x, y: cursor, w: cross, h: main.min(inner.h.max(1)) }
                };
                render_node(canvas, project, &item_scope, template, child_frame, user_fonts)?;
                cursor += main + gap;
            }
            Ok(())
        }
        Node::CompoundRef(node) => {
            let Some(definition) = project
                .widget_definitions
                .iter()
                .find(|definition| definition.id == node.definition_id && definition.kind == "compound")
            else {
                return Ok(());
            };
            let Some(root) = definition.root_node.as_ref() else {
                return Ok(());
            };
            let mut nested_scope = scope.clone();
            let Some(scope_object) = nested_scope.as_object_mut() else {
                return Ok(());
            };
            for input in &definition.input_schema {
                let key = &input.id;
                let alias = &input.name;
                let value = if input.value_type == "entity" {
                    node.input_bindings
                        .get(key)
                        .or_else(|| node.input_bindings.get(alias))
                        .map(|value| render_template(value, scope, &project.locale).unwrap_or_else(|| value.clone()))
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
            render_node(canvas, project, &nested_scope, root, frame, user_fonts)
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
                            scope_value(scope, value).unwrap_or_else(|| Value::String(value.clone()))
                        };
                        (key.clone(), resolved)
                    })
                    .collect(),
            );
            let derived = run_js_json(&script.source, scope, &bindings, &globals)?;
            let merged_scope = if derived.is_object() {
                merge_scope(scope, &derived)
            } else {
                scope.clone()
            };
            if let Some(child) = script.child.as_deref() {
                render_node(canvas, project, &merged_scope, child, frame, user_fonts)?;
            }
            Ok(())
        }
        Node::IfElse(node) => {
            let child = if evaluate_js_bool(&node.condition, scope)? {
                node.then_child.as_deref()
            } else {
                node.else_child.as_deref()
            };
            if let Some(child) = child {
                render_node(canvas, project, scope, child, frame, user_fonts)?;
            }
            Ok(())
        }
        Node::PrimitiveInstance { .. } => render_primitive(canvas, project, scope, node, frame, user_fonts),
        Node::Spacer { .. } => Ok(()),
        Node::Unsupported => Ok(()),
    }
}

fn render_layout_preview(
    project_value: &Value,
    user_fonts_value: &Value,
    data_value: &Value,
    layout_id: &str,
    data_source_message: Option<String>,
) -> Result<Option<NativeRenderedPreview>, ApiError> {
    let project: ProjectView = serde_json::from_value(project_value.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let user_fonts: HashMap<String, RuntimeFontFamilyData> =
        serde_json::from_value(user_fonts_value.clone())
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let layout = match project.layout_definitions.iter().find(|layout| layout.id == layout_id) {
        Some(layout) => layout,
        None => return Ok(None),
    };
    let root = match &layout.root_node {
        Some(root) if node_supported_with_project(&project, root) => root,
        _ => return Ok(None),
    };
    let display_type = match project
        .display_types
        .iter()
        .find(|display_type| display_type.id == layout.display_type_id)
    {
        Some(display_type) => display_type,
        None => return Ok(None),
    };
    let mut canvas = IndexedCanvas::new(display_type.width, display_type.height, COLOR_BG);
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
    )
    .is_err()
    {
        return Ok(None);
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
            base64::engine::general_purpose::STANDARD.encode(&png_bytes[..png_bytes.len().min(24)])
        ),
        active_screen_id: layout.id.clone(),
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
    if body.get("includeInspection").and_then(Value::as_bool).unwrap_or(false) {
        return Ok(None);
    }
    if body.get("popupLayoutId").and_then(Value::as_str).is_some() {
        return Ok(None);
    }
    if body.get("displayId").and_then(Value::as_str).is_some() {
        return Ok(None);
    }
    let layout_id = match body.get("layoutId").and_then(Value::as_str) {
        Some(value) => value,
        None => return Ok(None),
    };
    Ok(render_layout_preview(project_value, user_fonts_value, data_value, layout_id, None)?
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
    let display = match project.devices.iter().find(|display| display.id == display_id) {
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
    if !assignment.fullscreen_rules.is_empty() || !assignment.popup_rules.is_empty() {
        return Ok(None);
    }
    let layout_id = assignment
        .default_fullscreen_layout_id
        .as_deref()
        .or_else(|| {
            project
                .layout_definitions
                .iter()
                .find(|layout| layout.display_type_id == display.display_type_id)
                .map(|layout| layout.id.as_str())
        });
    let Some(layout_id) = layout_id else {
        return Ok(None);
    };
    let rendered =
        render_layout_preview(project_value, user_fonts_value, data_value, layout_id, data_source_message)?;
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
                if let Some(found) = children.iter().find_map(|child| first_unsupported(project, child)) {
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
                let definition = project
                    .widget_definitions
                    .iter()
                    .find(|definition| definition.id == node.definition_id && definition.kind == "compound");
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
                    .or_else(|| node.else_child.as_deref().and_then(|child| first_unsupported(project, child)))
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
        serde_json::from_str(include_str!("../../../data/projects/demo-home.json")).unwrap()
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
            "displayTypeId": "tri296x128-red",
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
        )
        .unwrap();
        assert!(rendered.is_some());
        assert!(rendered.unwrap().hash.starts_with("native-layout:"));
    }

    #[test]
    fn calendar_layout_supported_natively() {
        let project_value = demo_project();
        let project: ProjectView = serde_json::from_value(project_value.clone()).unwrap();
        let root = project
            .layout_definitions
            .iter()
            .find(|layout| layout.id == "layout-fef18f50")
            .and_then(|layout| layout.root_node.as_ref())
            .unwrap();
        assert!(
            node_supported_with_project(&project, root),
            "{:?}",
            first_unsupported(&project, root)
        );
    }
}
