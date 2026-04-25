use std::collections::HashMap;

use base64::Engine;
use epd_text_engine::{
    render as render_text_layout, FontFamilyData as EngineFontFamilyData,
    FontPresets as EngineFontPresets, LayoutRequest, TextStyle as EngineTextStyle,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{rgba_to_png, ApiError};

const COLOR_BG: u8 = 0;
const COLOR_FG: u8 = 1;
const COLOR_ACCENT: u8 = 2;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisplayType {
    id: String,
    width: u32,
    height: u32,
    palette: Palette,
}

#[derive(Clone, Debug, Deserialize)]
struct Palette {
    bg: String,
    fg: String,
    accent: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontPresetValues {
    tiny: u32,
    normal: u32,
    header: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemePreviewProject {
    themes: Vec<WidgetTheme>,
    #[serde(rename = "displayTypes")]
    display_types: Vec<DisplayType>,
    #[serde(rename = "fontPresets")]
    font_presets: FontPresetValues,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetTheme {
    id: String,
    surface: Option<ThemeSurface>,
    border: ThemeBorder,
    text: ThemeTextRoles,
    accent_role: PaletteRole,
    font_roles: Option<ThemeFontRoles>,
    text_outline: Option<TextOutline>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeSurface {
    fill_role: Option<FillRole>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeBorder {
    color_role: PaletteRole,
    visible: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeTextRoles {
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
    weight: Option<String>,
    slope: Option<String>,
    pixel_size: Option<u32>,
    color_role: Option<TextColorRole>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextOutline {
    enabled: bool,
    color_role: PaletteRole,
    thickness_px: Option<i32>,
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
enum HalftoneRole {
    Gray,
    LightAccent,
    DarkAccent,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(untagged)]
enum FillRole {
    Palette(PaletteRole),
    Halftone(HalftoneRole),
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum TextColorRole {
    Bg,
    Fg,
    Accent,
    Transparent,
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

#[derive(Clone, Debug)]
struct ResolvedTextStyle {
    family: String,
    weight: String,
    slope: String,
    pixel_size: u32,
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

    fn draw_rect_outline(&mut self, x: i32, y: i32, w: i32, h: i32, color: u8) {
        for px in x..(x + w) {
            self.set_pixel(px, y, color);
            self.set_pixel(px, y + h - 1, color);
        }
        for py in y..(y + h) {
            self.set_pixel(x, py, color);
            self.set_pixel(x + w - 1, py, color);
        }
    }

    fn fill_solid(&mut self, color: u8) {
        self.pixels.fill(color);
    }

    fn fill_checker(&mut self, primary: u8, secondary: u8) {
        for y in 0..self.height as i32 {
            for x in 0..self.width as i32 {
                self.set_pixel(x, y, if (x + y) % 2 == 0 { primary } else { secondary });
            }
        }
    }

    fn draw_text(
        &mut self,
        text: &str,
        x: i32,
        y: i32,
        style: &ResolvedTextStyle,
        presets: &FontPresetValues,
        fonts: &HashMap<String, RuntimeFontFamilyData>,
        color: u8,
    ) -> Result<(), ApiError> {
        let Some(family_data) = resolve_font_family_data(&style.family, fonts) else {
            return Ok(());
        };
        let run = render_text_layout(LayoutRequest {
            op: "layout".into(),
            text: text.into(),
            style: EngineTextStyle {
                family: style.family.clone(),
                weight: style.weight.clone(),
                slope: style.slope.clone(),
                size: "normal".into(),
                tabular_numbers: Some(false),
                pixel_size: Some(style.pixel_size),
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
        for glyph in run.glyphs {
            for (gy, row) in glyph.pixels.iter().enumerate() {
                for (gx, pixel) in row.iter().enumerate() {
                    if *pixel != 0 {
                        self.set_pixel(x + glyph.x + gx as i32, y + glyph.y + gy as i32, color);
                    }
                }
            }
        }
        Ok(())
    }

    fn draw_outlined_text(
        &mut self,
        text: &str,
        x: i32,
        y: i32,
        style: &ResolvedTextStyle,
        presets: &FontPresetValues,
        fonts: &HashMap<String, RuntimeFontFamilyData>,
        fill_color: u8,
        outline_color: Option<u8>,
        thickness: i32,
    ) -> Result<(), ApiError> {
        if let Some(outline) = outline_color {
            if thickness > 0 {
                for oy in -thickness..=thickness {
                    for ox in -thickness..=thickness {
                        if ox == 0 && oy == 0 {
                            continue;
                        }
                        self.draw_text(text, x + ox, y + oy, style, presets, fonts, outline)?;
                    }
                }
            }
        }
        self.draw_text(text, x, y, style, presets, fonts, fill_color)
    }

    fn to_rgba(&self, display_type: &DisplayType) -> Result<Vec<u8>, ApiError> {
        let palette = [
            parse_hex_color(&display_type.palette.bg)?,
            parse_hex_color(&display_type.palette.fg)?,
            parse_hex_color(&display_type.palette.accent)?,
        ];
        let mut rgba = vec![0u8; self.width as usize * self.height as usize * 4];
        for (index, color_index) in self.pixels.iter().enumerate() {
            let [r, g, b] = palette[*color_index as usize];
            let offset = index * 4;
            rgba[offset] = r;
            rgba[offset + 1] = g;
            rgba[offset + 2] = b;
            rgba[offset + 3] = 255;
        }
        Ok(rgba)
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

fn fill_role_paint(role: Option<FillRole>) -> (u8, Option<u8>) {
    match role.unwrap_or(FillRole::Palette(PaletteRole::Bg)) {
        FillRole::Palette(role) => (role_color(role), None),
        FillRole::Halftone(HalftoneRole::Gray) => (COLOR_BG, Some(COLOR_FG)),
        FillRole::Halftone(HalftoneRole::LightAccent) => (COLOR_BG, Some(COLOR_ACCENT)),
        FillRole::Halftone(HalftoneRole::DarkAccent) => (COLOR_FG, Some(COLOR_ACCENT)),
    }
}

fn text_color_role(role: Option<TextColorRole>, fallback: PaletteRole) -> Option<u8> {
    match role.unwrap_or(match fallback {
        PaletteRole::Bg => TextColorRole::Bg,
        PaletteRole::Fg => TextColorRole::Fg,
        PaletteRole::Accent => TextColorRole::Accent,
    }) {
        TextColorRole::Transparent => None,
        TextColorRole::Bg => Some(COLOR_BG),
        TextColorRole::Fg => Some(COLOR_FG),
        TextColorRole::Accent => Some(COLOR_ACCENT),
    }
}

fn resolve_text_style(
    partial: Option<&PartialTextStyle>,
    defaults: &ResolvedTextStyle,
) -> ResolvedTextStyle {
    ResolvedTextStyle {
        family: partial
            .and_then(|value| value.family.clone())
            .unwrap_or_else(|| defaults.family.clone()),
        weight: partial
            .and_then(|value| value.weight.clone())
            .unwrap_or_else(|| defaults.weight.clone()),
        slope: partial
            .and_then(|value| value.slope.clone())
            .unwrap_or_else(|| defaults.slope.clone()),
        pixel_size: partial
            .and_then(|value| value.pixel_size)
            .unwrap_or(defaults.pixel_size),
    }
}

fn resolve_font_family_data(
    family: &str,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Option<RuntimeFontFamilyData> {
    user_fonts.get(family).cloned()
}

fn runtime_font_variants(data: &RuntimeFontFamilyData) -> HashMap<String, String> {
    data.variants
        .iter()
        .filter_map(|(key, value)| value.as_str().map(|font| (key.clone(), font.to_string())))
        .collect()
}

pub(crate) fn render_theme_preview_value(
    project_value: &Value,
    user_fonts_value: &Value,
    theme_id: &str,
    display_type_id: &str,
) -> Result<Value, ApiError> {
    let project: ThemePreviewProject = serde_json::from_value(project_value.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let user_fonts: HashMap<String, RuntimeFontFamilyData> =
        serde_json::from_value(user_fonts_value.clone())
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let theme = project
        .themes
        .iter()
        .find(|entry| entry.id == theme_id)
        .cloned()
        .ok_or_else(|| ApiError::bad_request("Unknown theme preview target"))?;
    let display_type = project
        .display_types
        .iter()
        .find(|entry| entry.id == display_type_id)
        .cloned()
        .ok_or_else(|| ApiError::bad_request("Unknown theme preview target"))?;

    let mut canvas = IndexedCanvas::new(display_type.width, display_type.height, COLOR_BG);
    let (fill_primary, fill_secondary) =
        fill_role_paint(theme.surface.as_ref().and_then(|value| value.fill_role));
    if let Some(secondary) = fill_secondary {
        canvas.fill_checker(fill_primary, secondary);
    } else {
        canvas.fill_solid(fill_primary);
    }

    if theme.border.visible {
        canvas.draw_rect_outline(
            0,
            0,
            display_type.width as i32,
            display_type.height as i32,
            role_color(theme.border.color_role),
        );
    }

    let font_roles = theme.font_roles.clone().unwrap_or_default();
    let tiny_default = ResolvedTextStyle {
        family: "missing-font".into(),
        weight: "regular".into(),
        slope: "roman".into(),
        pixel_size: project.font_presets.tiny,
    };
    let normal_default = ResolvedTextStyle {
        family: "missing-font".into(),
        weight: "regular".into(),
        slope: "roman".into(),
        pixel_size: project.font_presets.normal,
    };
    let emphasis_default = ResolvedTextStyle {
        family: font_roles
            .normal
            .as_ref()
            .and_then(|value| value.family.clone())
            .unwrap_or_else(|| "missing-font".into()),
        weight: font_roles
            .normal
            .as_ref()
            .and_then(|value| value.weight.clone())
            .unwrap_or_else(|| "bold".into()),
        slope: font_roles
            .normal
            .as_ref()
            .and_then(|value| value.slope.clone())
            .unwrap_or_else(|| "roman".into()),
        pixel_size: font_roles
            .normal
            .as_ref()
            .and_then(|value| value.pixel_size)
            .unwrap_or(project.font_presets.normal),
    };
    let header_default = ResolvedTextStyle {
        family: "missing-font".into(),
        weight: "regular".into(),
        slope: "roman".into(),
        pixel_size: project.font_presets.header,
    };

    let tiny_style = resolve_text_style(font_roles.tiny.as_ref(), &tiny_default);
    let normal_style = resolve_text_style(font_roles.normal.as_ref(), &normal_default);
    let emphasis_style = resolve_text_style(font_roles.normal_emphasis.as_ref(), &emphasis_default);
    let header_style = resolve_text_style(font_roles.header.as_ref(), &header_default);

    let outline_color = theme
        .text_outline
        .as_ref()
        .filter(|value| value.enabled)
        .map(|value| role_color(value.color_role));
    let outline_thickness = theme
        .text_outline
        .as_ref()
        .filter(|value| value.enabled)
        .and_then(|value| value.thickness_px)
        .unwrap_or(1);

    if let Some(color) = text_color_role(
        font_roles.tiny.as_ref().and_then(|value| value.color_role),
        theme.text.title,
    ) {
        canvas.draw_outlined_text(
            "TINY SAMPLE",
            8,
            8,
            &tiny_style,
            &project.font_presets,
            &user_fonts,
            color,
            outline_color,
            outline_thickness,
        )?;
    }
    canvas.draw_outlined_text(
        "ACCENT",
        display_type.width as i32 - 54,
        8,
        &tiny_style,
        &project.font_presets,
        &user_fonts,
        role_color(theme.accent_role),
        outline_color,
        outline_thickness,
    )?;
    if let Some(color) = text_color_role(
        font_roles
            .normal
            .as_ref()
            .and_then(|value| value.color_role),
        theme.text.body,
    ) {
        canvas.draw_outlined_text(
            "Normal sample text",
            8,
            28,
            &normal_style,
            &project.font_presets,
            &user_fonts,
            color,
            outline_color,
            outline_thickness,
        )?;
    }
    if let Some(color) = text_color_role(
        font_roles
            .normal_emphasis
            .as_ref()
            .and_then(|value| value.color_role),
        theme.text.body,
    ) {
        canvas.draw_outlined_text(
            "Emphasis sample",
            8,
            42,
            &emphasis_style,
            &project.font_presets,
            &user_fonts,
            color,
            outline_color,
            outline_thickness,
        )?;
    }
    if let Some(color) = text_color_role(
        font_roles
            .header
            .as_ref()
            .and_then(|value| value.color_role),
        theme.text.value,
    ) {
        canvas.draw_outlined_text(
            "Header 21.5",
            8,
            58,
            &header_style,
            &project.font_presets,
            &user_fonts,
            color,
            outline_color,
            outline_thickness,
        )?;
    }
    if let Some(color) = text_color_role(
        font_roles.tiny.as_ref().and_then(|value| value.color_role),
        theme.text.body,
    ) {
        canvas.draw_outlined_text(
            "body / accent",
            8,
            display_type.height as i32 - 18,
            &tiny_style,
            &project.font_presets,
            &user_fonts,
            color,
            outline_color,
            outline_thickness,
        )?;
    }
    canvas.draw_outlined_text(
        "*",
        display_type.width as i32 - 14,
        display_type.height as i32 - 22,
        &header_style,
        &project.font_presets,
        &user_fonts,
        role_color(theme.accent_role),
        outline_color,
        outline_thickness,
    )?;

    let rgba = canvas.to_rgba(&display_type)?;
    Ok(serde_json::json!({
        "width": display_type.width,
        "height": display_type.height,
        "hash": format!("theme:{}:{}", theme.id, display_type.id),
        "activeScreenId": format!("theme-preview:{}", theme.id),
        "dataSourceMessage": "Theme preview",
        "pngBase64": base64::engine::general_purpose::STANDARD.encode(rgba_to_png(&rgba, display_type.width, display_type.height)?),
    }))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use serde_json::{json, Value};
    use std::path::PathBuf;

    use super::render_theme_preview_value;

    fn fixture_font_base64() -> String {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/fonts/arial-regular.ttf");
        base64::engine::general_purpose::STANDARD.encode(std::fs::read(path).expect("fixture font"))
    }

    #[test]
    fn renders_theme_preview_png() {
        let project = json!({
            "themes": [{
                "id": "default",
                "surface": {},
                "border": { "colorRole": "fg", "visible": true },
                "text": { "title": "fg", "body": "fg", "value": "accent" },
                "accentRole": "accent",
                "fontRoles": {
                    "tiny": { "family": "arial", "pixelSize": 8, "weight": "regular", "slope": "roman" },
                    "normal": { "family": "arial", "pixelSize": 8, "weight": "regular", "slope": "roman" },
                    "header": { "family": "arial", "pixelSize": 8, "weight": "regular", "slope": "roman" }
                },
                "textOutline": { "enabled": false, "colorRole": "bg", "thicknessPx": 1 }
            }],
            "displayTypes": [{
                "id": "demo",
                "width": 64,
                "height": 32,
                "palette": { "bg": "#ffffff", "fg": "#111111", "accent": "#d7261b" }
            }],
            "fontPresets": { "tiny": 8, "normal": 8, "header": 8 }
        });
        let user_fonts = json!({
            "arial": { "regular": fixture_font_base64() }
        });
        let value =
            render_theme_preview_value(&project, &user_fonts, "default", "demo").expect("render");
        let png = value.get("pngBase64").and_then(Value::as_str).expect("png");
        assert!(!png.is_empty());
    }
}
