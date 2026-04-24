use std::collections::HashMap;

use base64::Engine;
use epd_text_engine::{
    render as render_text_layout, FontFamilyData as EngineFontFamilyData,
    FontPresets as EngineFontPresets, LayoutRequest, TextStyle as EngineTextStyle,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{rgba_to_png, ApiError, DisplayProfile, FontOption};

const SPECIMEN_VARIANTS: [(&str, &str, &str); 4] = [
    ("regular", "roman", "regular"),
    ("regular", "italic", "italic"),
    ("bold", "roman", "bold"),
    ("bold", "italic", "boldItalic"),
];

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontPresetValues {
    tiny: u32,
    normal: u32,
    header: u32,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontSpecimenProject {
    #[serde(rename = "fontPresets")]
    font_presets: FontPresetValues,
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

fn resolve_font_family_data(
    family: &str,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
) -> Option<RuntimeFontFamilyData> {
    user_fonts.get(family).cloned()
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

fn allowed_or_all_sizes(
    font: &FontOption,
    min_size: i32,
    max_size: i32,
    include_all_sizes: bool,
) -> Vec<i32> {
    if include_all_sizes {
        return (min_size..=max_size).collect();
    }
    let allowed = font
        .allowed_pixel_sizes
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|size| *size >= min_size && *size <= max_size)
        .collect::<Vec<_>>();
    if allowed.is_empty() {
        (min_size..=max_size).collect()
    } else {
        allowed
    }
}

fn render_specimen_tile(
    profile: &DisplayProfile,
    presets: &FontPresetValues,
    user_fonts: &HashMap<String, RuntimeFontFamilyData>,
    family: &str,
    weight: &str,
    slope: &str,
    sample_text: &str,
    size: i32,
) -> Result<Value, ApiError> {
    let Some(family_data) = resolve_font_family_data(family, user_fonts) else {
        return Ok(json!({
            "size": size,
            "width": 0,
            "height": 0,
            "pngBase64": "",
        }));
    };
    let run = render_text_layout(LayoutRequest {
        op: "layout".into(),
        text: sample_text.into(),
        style: EngineTextStyle {
            family: family.into(),
            weight: weight.into(),
            slope: slope.into(),
            size: "normal".into(),
            tabular_numbers: Some(false),
            pixel_size: Some(size.max(1) as u32),
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

    let padding = 2i32;
    let (content_width, content_height, origin_x, origin_y) = if min_x <= max_x && min_y <= max_y
    {
        (
            (max_x - min_x).max(1),
            (max_y - min_y).max(1),
            padding - min_x,
            padding - min_y,
        )
    } else {
        (
            run.width.max(1),
            run.height.max(1),
            padding,
            padding + run.baseline - run.ascent,
        )
    };

    let width = (content_width + padding * 2).max(1) as u32;
    let height = (content_height + padding * 2).max(1) as u32;
    let [bg_r, bg_g, bg_b] = parse_hex_color(&profile.palette.bg)?;
    let [fg_r, fg_g, fg_b] = parse_hex_color(&profile.palette.fg)?;
    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for pixel in rgba.chunks_exact_mut(4) {
        pixel[0] = bg_r;
        pixel[1] = bg_g;
        pixel[2] = bg_b;
        pixel[3] = 255;
    }

    for glyph in &run.glyphs {
        for (gy, row) in glyph.pixels.iter().enumerate() {
            for (gx, pixel) in row.iter().enumerate() {
                if *pixel == 0 {
                    continue;
                }
                let x = origin_x + glyph.x + gx as i32;
                let y = origin_y + glyph.y + gy as i32;
                if x < 0 || y < 0 || x >= width as i32 || y >= height as i32 {
                    continue;
                }
                let offset = (y as usize * width as usize + x as usize) * 4;
                rgba[offset] = fg_r;
                rgba[offset + 1] = fg_g;
                rgba[offset + 2] = fg_b;
                rgba[offset + 3] = 255;
            }
        }
    }

    Ok(json!({
        "size": size,
        "width": width,
        "height": height,
        "pngBase64": base64::engine::general_purpose::STANDARD.encode(rgba_to_png(&rgba, width, height)?),
    }))
}

pub(crate) fn render_font_specimens_value(
    project_value: &Value,
    user_fonts_value: &Value,
    profile: &DisplayProfile,
    sample_text: &str,
    min_size: i32,
    max_size: i32,
    fonts: &[FontOption],
    family_id: Option<&str>,
    include_all_sizes: bool,
) -> Result<Value, ApiError> {
    let project: FontSpecimenProject = serde_json::from_value(project_value.clone())
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    let user_fonts: HashMap<String, RuntimeFontFamilyData> =
        serde_json::from_value(user_fonts_value.clone())
            .map_err(|error| ApiError::bad_request(error.to_string()))?;

    let families = fonts
        .iter()
        .filter(|font| family_id.is_none_or(|target| font.id == target))
        .map(|font| {
            let variants = SPECIMEN_VARIANTS
                .iter()
                .filter(|(_, _, variant_key)| font.variants.iter().any(|entry| entry == *variant_key))
                .map(|(weight, slope, variant_key)| {
                    let tiles = allowed_or_all_sizes(font, min_size, max_size, include_all_sizes)
                        .into_iter()
                        .map(|size| {
                            render_specimen_tile(
                                profile,
                                &project.font_presets,
                                &user_fonts,
                                &font.id,
                                weight,
                                slope,
                                sample_text,
                                size,
                            )
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    Ok(json!({
                        "weight": weight,
                        "slope": slope,
                        "variantKey": variant_key,
                        "tiles": tiles,
                    }))
                })
                .collect::<Result<Vec<Value>, ApiError>>()?;

            Ok(json!({
                "family": font.id,
                "label": font.label,
                "source": font.source,
                "allowedPixelSizes": font.allowed_pixel_sizes,
                "importSource": font.import_source,
                "sourceUrl": font.source_url,
                "previewUrl": font.preview_url,
                "declaredPixelSize": font.declared_pixel_size,
                "licenseCategory": font.license_category,
                "variants": variants,
            }))
        })
        .collect::<Result<Vec<Value>, ApiError>>()?;

    Ok(json!({ "families": families }))
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use serde_json::json;
    use std::path::PathBuf;

    use crate::DisplayProfile;

    use super::render_font_specimens_value;

    fn fixture_font_base64() -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../data/fonts/arial-regular.ttf");
        base64::engine::general_purpose::STANDARD.encode(
            std::fs::read(path).expect("fixture font"),
        )
    }

    #[test]
    fn renders_unbordered_exact_fit_specimen_png() {
        let project = json!({
            "fontPresets": { "tiny": 6, "normal": 10, "header": 14 }
        });
        let user_fonts = json!({
            "arial": { "regular": fixture_font_base64() }
        });
        let profile = DisplayProfile {
            id: "tri296x128-red".into(),
            width: 296,
            height: 128,
            rotation: 0,
            palette: crate::Palette {
                bg: "#ffffff".into(),
                fg: "#111111".into(),
                accent: "#d7261b".into(),
            },
            content_padding: crate::EdgeInsets {
                top: 4,
                right: 4,
                bottom: 4,
                left: 4,
            },
            grid_unit_px: 8,
            recommended_font_scale: 2,
        };
        let fonts = vec![crate::FontOption {
            id: "arial".into(),
            label: "Arial".into(),
            source: "user".into(),
            variants: vec!["regular".into()],
            allowed_pixel_sizes: None,
            import_source: None,
            source_url: None,
            preview_url: None,
            declared_pixel_size: None,
            license_category: None,
        }];
        let rendered = render_font_specimens_value(
            &project,
            &user_fonts,
            &profile,
            "Ag 09:45 bdpq RH 21.5C",
            12,
            12,
            &fonts,
            Some("arial"),
            false,
        )
        .expect("font specimens");
        let family = rendered["families"][0].clone();
        let tile = family["variants"][0]["tiles"][0].clone();
        assert_eq!(tile["size"], 12);
        assert!(tile["width"].as_u64().unwrap_or(0) > 64);
        assert!(tile["height"].as_u64().unwrap_or(0) > 8);
        assert!(tile["pngBase64"]
            .as_str()
            .is_some_and(|value| !value.is_empty()));
    }
}
