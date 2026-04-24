use std::collections::HashMap;

use base64::Engine;
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
    themes: Vec<WidgetTheme>,
    #[serde(rename = "displayTypes")]
    display_types: Vec<DisplayType>,
    #[serde(rename = "fontPresets")]
    font_presets: FontPresetValues,
    #[serde(rename = "layoutDefinitions")]
    layout_definitions: Vec<LayoutDefinition>,
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
struct SizeSpec {
    mode: Option<String>,
    value: Option<f64>,
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
            if style.border_token.is_some() {
                return false;
            }
            if !matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction")) {
                return false;
            }
            if !matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction")) {
                return false;
            }
            children.iter().all(node_supported)
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
            if style.border_token.is_some() {
                return false;
            }
            if !matches!(width.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction")) {
                return false;
            }
            if !matches!(height.as_ref().and_then(|spec| spec.mode.as_deref()), None | Some("fill") | Some("fixed_px") | Some("fraction")) {
                return false;
            }
            if props.text.as_deref().is_some_and(|value| value.contains("{{") || value.contains('\n')) {
                return false;
            }
            if props.prefix.as_deref().is_some_and(|value| value.contains("{{")) {
                return false;
            }
            if props.suffix.as_deref().is_some_and(|value| value.contains("{{")) {
                return false;
            }
            if props.unit.as_deref().is_some_and(|value| value.contains("{{")) {
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

fn render_primitive(
    canvas: &mut IndexedCanvas,
    project: &ProjectView,
    data: &Value,
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
    } = node else {
        return Ok(());
    };
    let theme = theme_for_node(project, style);
    let padding = node_padding(style, props.padding_px);
    let inner = Rect {
        x: frame.x + padding,
        y: frame.y + padding,
        w: (frame.w - padding * 2).max(1),
        h: (frame.h - padding * 2).max(1),
    };
    let (text, family, color, tabular, default_px, h_align, v_align) = if primitive_type == "text" {
        let text = if props.render_entity_state.unwrap_or(false) {
            bindings
                .get("entity")
                .map(|entity_id| entity_state_text(data, entity_id))
                .unwrap_or_default()
        } else {
            props.text.clone().unwrap_or_default()
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
            props.horizontal_align.as_deref().unwrap_or("left"),
            props.vertical_align.as_deref().unwrap_or("top"),
        )
    } else {
        let mut value = bindings
            .get("entity")
            .map(|entity_id| entity_state_text(data, entity_id))
            .unwrap_or_default();
        if let Some(unit) = &props.unit {
            value.push_str(unit);
        }
        let text = format!(
            "{}{}{}",
            props.prefix.clone().unwrap_or_default(),
            value,
            props.suffix.clone().unwrap_or_default()
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
            props.horizontal_align.as_deref().unwrap_or("center"),
            props.vertical_align.as_deref().unwrap_or("middle"),
        )
    };
    if text.is_empty() {
        return Ok(());
    }
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
    let draw_x = match h_align {
        "center" => inner.x + ((inner.w - painted_w) / 2),
        "right" => inner.x + inner.w - painted_w,
        _ => inner.x,
    };
    let draw_y = match v_align {
        "middle" => inner.y + ((inner.h - painted_h) / 2),
        "bottom" => inner.y + inner.h - painted_h,
        _ => inner.y,
    };
    draw_text_run(canvas, &run, draw_x, draw_y, color);
    Ok(())
}

fn child_rects(axis: &str, children: &[Node], frame: Rect) -> Vec<Rect> {
    let is_vertical = axis == "vertical";
    let total = if is_vertical { frame.h } else { frame.w };
    let mut fixed = 0;
    let mut flex_count = 0;
    let mut sizes = Vec::with_capacity(children.len());
    for child in children {
        let (width, height, style, props_padding) = match child {
            Node::Stack { width, height, style, .. } => (width, height, style, None),
            Node::PrimitiveInstance { width, height, style, props, .. } => (width, height, style, props.padding_px),
            Node::Spacer { width, height, style, .. } => (width, height, style, None),
            Node::Unsupported => {
                sizes.push(None);
                continue;
            }
        };
        let spec = if is_vertical { height } else { width };
        let padding = node_padding(style, props_padding);
        let measured = get_size_value(spec, total).map(|value| value.max(1 + padding * 2));
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

fn render_node(
    canvas: &mut IndexedCanvas,
    project: &ProjectView,
    data: &Value,
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
            let mut rects = child_rects(axis, children, inner);
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
                render_node(canvas, project, data, child, *child_frame, user_fonts)?;
            }
            Ok(())
        }
        Node::PrimitiveInstance { .. } => render_primitive(canvas, project, data, node, frame, user_fonts),
        Node::Spacer { .. } => Ok(()),
        Node::Unsupported => Ok(()),
    }
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
        Some(root) if node_supported(root) => root,
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
    render_node(
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
    )?;
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
    let png = rgba_to_png(&rgba, display_type.width, display_type.height)?;
    Ok(Some(json!({
        "width": display_type.width,
        "height": display_type.height,
        "hash": format!("native-layout:{}:{}:{}", layout.id, display_type.id, base64::engine::general_purpose::STANDARD.encode(&png[..png.len().min(24)])),
        "activeScreenId": layout.id,
        "pngBase64": base64::engine::general_purpose::STANDARD.encode(png),
    })))
}
