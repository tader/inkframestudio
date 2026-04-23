use std::io::{Read, Write};

use base64::Engine;
use freetype::face::LoadFlag;
use freetype::{Library, RenderMode};
use harfbuzz_rs::{shape, Face as HbFace, Font as HbFont, UnicodeBuffer};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontFamilyData {
    regular: Option<String>,
    italic: Option<String>,
    bold: Option<String>,
    bold_italic: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextStyle {
    #[serde(rename = "family")]
    _family: String,
    weight: String,
    slope: String,
    size: String,
    tabular_numbers: Option<bool>,
    pixel_size: Option<u32>,
    #[serde(rename = "bypassAllowedPixelSizes")]
    _bypass_allowed_pixel_sizes: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FontPresets {
    tiny: u32,
    normal: u32,
    header: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayoutRequest {
    op: String,
    text: String,
    style: TextStyle,
    font_presets: FontPresets,
    font_family_data: FontFamilyData,
    render_mode: String,
    threshold: u8,
    oversample_factor: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionedGlyph {
    width: i32,
    height: i32,
    pixels: Vec<Vec<u8>>,
    advance: i32,
    bearing_x: i32,
    top: i32,
    char: String,
    x: i32,
    y: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TextLayoutRun {
    width: i32,
    height: i32,
    ascent: i32,
    descent: i32,
    line_height: i32,
    baseline: i32,
    glyphs: Vec<PositionedGlyph>,
}

fn variant_bytes<'a>(family: &'a FontFamilyData, weight: &str, slope: &str) -> Option<&'a str> {
    match (weight, slope) {
        ("bold", "italic") => family.bold_italic.as_deref().or(family.bold.as_deref()).or(family.italic.as_deref()).or(family.regular.as_deref()),
        ("bold", _) => family.bold.as_deref().or(family.regular.as_deref()),
        (_, "italic") => family.italic.as_deref().or(family.regular.as_deref()),
        _ => family.regular.as_deref().or(family.bold.as_deref()).or(family.italic.as_deref()),
    }
}

fn pixel_size(style: &TextStyle, presets: &FontPresets) -> u32 {
    if let Some(size) = style.pixel_size {
        return size;
    }
    match style.size.as_str() {
        "tiny" => presets.tiny,
        "header" => presets.header,
        _ => presets.normal,
    }
}

fn threshold_bitmap(bitmap: &[u8], width: usize, rows: usize, pitch: usize, threshold: u8) -> Vec<Vec<u8>> {
    let mut pixels = vec![vec![0u8; width]; rows];
    for y in 0..rows {
        for x in 0..width {
            let value = bitmap[y * pitch + x];
            if value >= threshold {
                pixels[y][x] = 1;
            }
        }
    }
    pixels
}

fn mono_bitmap(bitmap: &[u8], width: usize, rows: usize, pitch: usize) -> Vec<Vec<u8>> {
    let mut pixels = vec![vec![0u8; width]; rows];
    for y in 0..rows {
        for x in 0..width {
            let byte = bitmap[y * pitch + (x / 8)];
            let mask = 0x80 >> (x % 8);
            if (byte & mask) != 0 {
                pixels[y][x] = 1;
            }
        }
    }
    pixels
}

fn downsample_bitmap(input: &[Vec<u8>], factor: usize, threshold: u8) -> Vec<Vec<u8>> {
    if factor <= 1 {
      return input.to_vec();
    }
    let src_h = input.len();
    let src_w = input.first().map(|row| row.len()).unwrap_or(0);
    let out_h = (src_h + factor - 1) / factor;
    let out_w = (src_w + factor - 1) / factor;
    let mut output = vec![vec![0u8; out_w]; out_h];
    for oy in 0..out_h {
        for ox in 0..out_w {
            let mut sum = 0u32;
            let mut count = 0u32;
            for sy in 0..factor {
                for sx in 0..factor {
                    let y = oy * factor + sy;
                    let x = ox * factor + sx;
                    if y >= src_h || x >= src_w {
                        continue;
                    }
                    sum += u32::from(input[y][x]);
                    count += 1;
                }
            }
            let coverage = if count == 0 { 0 } else { (sum * 255 / count) as u8 };
            if coverage >= threshold {
                output[oy][ox] = 1;
            }
        }
    }
    output
}

fn scale_fixed(value: i32, scale: f32) -> i32 {
    ((value as f32) * scale / 64.0).round() as i32
}

fn render(request: LayoutRequest) -> Result<TextLayoutRun, String> {
    if request.op != "layout" {
        return Err(format!("unsupported op {}", request.op));
    }
    let base64_font = variant_bytes(&request.font_family_data, &request.style.weight, &request.style.slope)
        .ok_or_else(|| "missing font bytes for requested variant".to_string())?;
    let font_bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_font.as_bytes())
        .map_err(|error| format!("invalid font data: {error}"))?;
    let size_px = pixel_size(&request.style, &request.font_presets);
    let oversample = if request.render_mode == "gray_oversample" {
        request.oversample_factor.max(1)
    } else {
        1
    };
    let render_px = size_px.saturating_mul(oversample);

    let library = Library::init().map_err(|error| format!("freetype init failed: {error}"))?;
    let face = library
        .new_memory_face(font_bytes.clone(), 0)
        .map_err(|error| format!("load face failed: {error}"))?;
    face.set_pixel_sizes(0, render_px)
        .map_err(|error| format!("set pixel size failed: {error}"))?;

    let hb_face = HbFace::from_bytes(font_bytes.as_slice(), 0);
    let mut hb_font = HbFont::new(hb_face);
    let upem = face.em_size() as f32;
    let hb_scale = ((render_px as f32) * 64.0) as i32;
    hb_font.set_scale(hb_scale, hb_scale);
    let output = shape(&hb_font, UnicodeBuffer::new().add_str(&request.text), &[]);
    let infos = output.get_glyph_infos();
    let positions = output.get_glyph_positions();

    let ascender = (face.ascender() as f32 * render_px as f32 / upem).ceil() as i32;
    let descender = ((-face.descender()) as f32 * render_px as f32 / upem).ceil() as i32;
    let line_height = (face.height() as f32 * render_px as f32 / upem).ceil() as i32;
    let baseline = ascender;
    let out_scale = 1.0 / oversample as f32;

    let mut glyphs = Vec::new();
    let mut cursor_x = 0i32;
    let mut max_right = 0i32;
    let tabular = request.style.tabular_numbers.unwrap_or(false);
    let mut max_digit_advance = 0i32;

    if tabular {
        for digit in '0'..='9' {
            face.load_char(digit as usize, LoadFlag::DEFAULT)
                .map_err(|error| format!("digit load failed: {error}"))?;
            let advance = scale_fixed(face.glyph().advance().x as i32, out_scale);
            max_digit_advance = max_digit_advance.max(advance);
        }
    }

    for ((info, position), ch) in infos.iter().zip(positions.iter()).zip(request.text.chars()) {
        let mut load_flags = LoadFlag::DEFAULT;
        let render_mode = match request.render_mode.as_str() {
            "gray_threshold" | "gray_oversample" => RenderMode::Normal,
            _ => {
                load_flags |= LoadFlag::TARGET_MONO;
                RenderMode::Mono
            }
        };
        face.load_glyph(info.codepoint, load_flags)
            .map_err(|error| format!("glyph load failed: {error}"))?;
        face.glyph()
            .render_glyph(render_mode)
            .map_err(|error| format!("glyph render failed: {error}"))?;
        let glyph = face.glyph();
        let bitmap = glyph.bitmap();
        let raw = bitmap.buffer().to_vec();
        let mut pixels = match request.render_mode.as_str() {
            "gray_threshold" => threshold_bitmap(
                &raw,
                bitmap.width() as usize,
                bitmap.rows() as usize,
                bitmap.pitch().unsigned_abs() as usize,
                request.threshold,
            ),
            "gray_oversample" => {
                let gray = threshold_bitmap(
                    &raw,
                    bitmap.width() as usize,
                    bitmap.rows() as usize,
                    bitmap.pitch().unsigned_abs() as usize,
                    1,
                );
                downsample_bitmap(&gray, oversample as usize, request.threshold)
            }
            _ => mono_bitmap(
                &raw,
                bitmap.width() as usize,
                bitmap.rows() as usize,
                bitmap.pitch().unsigned_abs() as usize,
            ),
        };
        let width = pixels.first().map(|row| row.len()).unwrap_or(0) as i32;
        let height = pixels.len() as i32;
        let x_offset = scale_fixed(position.x_offset, out_scale);
        let y_offset = scale_fixed(position.y_offset, out_scale);
        let advance = if tabular && ch.is_ascii_digit() {
            max_digit_advance.max(1)
        } else {
            scale_fixed(position.x_advance, out_scale).max(1)
        };
        let bearing_x = (glyph.bitmap_left() as f32 * out_scale).round() as i32;
        let top = (glyph.bitmap_top() as f32 * out_scale).round() as i32;
        let x = cursor_x + x_offset + bearing_x;
        let y = baseline - top - y_offset;
        max_right = max_right.max(x + width);
        glyphs.push(PositionedGlyph {
            width,
            height,
            pixels: std::mem::take(&mut pixels),
            advance,
            bearing_x,
            top,
            char: ch.to_string(),
            x,
            y,
        });
        cursor_x += advance;
    }

    Ok(TextLayoutRun {
        width: cursor_x.max(max_right),
        height: line_height.max(ascender + descender),
        ascent: (ascender as f32 * out_scale).round() as i32,
        descent: (descender as f32 * out_scale).round() as i32,
        line_height: (line_height as f32 * out_scale).round() as i32,
        baseline: (baseline as f32 * out_scale).round() as i32,
        glyphs,
    })
}

fn main() {
    if std::env::args().any(|arg| arg == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        let _ = writeln!(std::io::stderr(), "stdin read failed: {error}");
        std::process::exit(1);
    }
    let request: LayoutRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "request parse failed: {error}");
            std::process::exit(1);
        }
    };
    match render(request) {
        Ok(result) => {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            if let Err(error) = serde_json::to_writer(&mut handle, &result) {
                let _ = writeln!(std::io::stderr(), "response write failed: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "{error}");
            std::process::exit(1);
        }
    }
}
