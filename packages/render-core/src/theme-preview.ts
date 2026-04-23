import { PixelBuffer, COLOR_BG, COLOR_FG, COLOR_ACCENT } from "./pixel-buffer.js";
import type { DisplayType, FontPresetValues, PaletteRole, TextColorRole, TextStyle, WidgetTheme } from "./types.js";

export interface ThemePreviewImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

function parseHexColor(value: string): [number, number, number] {
  const safe = value.startsWith("#") ? value.slice(1) : value;
  const numeric = Number.parseInt(safe, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function colorForRole(role: PaletteRole): number {
  if (role === "bg") return COLOR_BG;
  if (role === "accent") return COLOR_ACCENT;
  return COLOR_FG;
}

function textColorForRole(role: TextColorRole | undefined, fallback: PaletteRole): number | undefined {
  if (role === "transparent") {
    return undefined;
  }
  return colorForRole((role ?? fallback) as PaletteRole);
}

function rgbaFromPixels(buffer: PixelBuffer, displayType: DisplayType): Uint8ClampedArray {
  const colors = [
    parseHexColor(displayType.palette.bg),
    parseHexColor(displayType.palette.fg),
    parseHexColor(displayType.palette.accent)
  ];
  const rgba = new Uint8ClampedArray(buffer.width * buffer.height * 4);
  for (let index = 0; index < buffer.pixels.length; index += 1) {
    const [r, g, b] = colors[buffer.pixels[index]] ?? colors[0];
    const offset = index * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function drawOutlinedText(
  buffer: PixelBuffer,
  text: string,
  x: number,
  y: number,
  style: Partial<TextStyle>,
  fillColor: number,
  outlineColor: number | undefined,
  thickness = 1
): void {
  const maskColor = COLOR_FG;
  if (outlineColor === undefined || thickness <= 0) {
    buffer.drawText(text, x, y, style, fillColor);
    return;
  }

  const metrics = buffer.measureText(text, style);
  const frame = {
    x: Math.max(0, x - thickness),
    y: Math.max(0, y - thickness),
    w: Math.min(buffer.width - Math.max(0, x - thickness), metrics.width + thickness * 2),
    h: Math.min(buffer.height - Math.max(0, y - thickness), metrics.height + thickness * 2)
  };
  const temp = new PixelBuffer(buffer.width, buffer.height, COLOR_BG, buffer.fontPresets);
  temp.drawText(text, x, y, style, maskColor);

  for (let py = frame.y; py < frame.y + frame.h; py += 1) {
    for (let px = frame.x; px < frame.x + frame.w; px += 1) {
      if (temp.getPixel(px, py) !== maskColor) {
        continue;
      }
      for (let oy = -thickness; oy <= thickness; oy += 1) {
        for (let ox = -thickness; ox <= thickness; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const tx = px + ox;
          const ty = py + oy;
          if (tx < frame.x || ty < frame.y || tx >= frame.x + frame.w || ty >= frame.y + frame.h) {
            continue;
          }
          if (temp.getPixel(tx, ty) === COLOR_BG) {
            buffer.setPixel(tx, ty, outlineColor);
          }
        }
      }
    }
  }

  for (let py = frame.y; py < frame.y + frame.h; py += 1) {
    for (let px = frame.x; px < frame.x + frame.w; px += 1) {
      if (temp.getPixel(px, py) === maskColor) {
        buffer.setPixel(px, py, fillColor);
      }
    }
  }
}

export function renderThemePreviewImage(
  theme: WidgetTheme,
  displayType: DisplayType,
  fontPresets: FontPresetValues,
  width = displayType.width,
  height = displayType.height
): ThemePreviewImage {
  const buffer = new PixelBuffer(width, height, COLOR_BG, fontPresets);
  const background = theme.surface.fillRole ? colorForRole(theme.surface.fillRole) : COLOR_BG;
  const border = colorForRole(theme.border.colorRole);
  const title = textColorForRole(theme.fontRoles?.tiny?.colorRole, theme.text.title);
  const body = textColorForRole(theme.fontRoles?.normal?.colorRole, theme.text.body);
  const emphasis = textColorForRole(theme.fontRoles?.normalEmphasis?.colorRole, theme.text.body);
  const value = textColorForRole(theme.fontRoles?.header?.colorRole, theme.text.value);
  const accent = colorForRole(theme.accentRole);
  const outline = theme.textOutline?.enabled ? colorForRole(theme.textOutline.colorRole) : undefined;
  const outlineThickness = theme.textOutline?.enabled ? Math.max(1, theme.textOutline.thicknessPx ?? 1) : 0;

  buffer.fill(background);
  if (theme.border.visible) {
    const thickness = theme.borderTokens?.thin?.thicknessPx ?? 1;
    for (let offset = 0; offset < thickness; offset += 1) {
      buffer.drawRect(offset, offset, width - offset * 2, height - offset * 2, border, false);
    }
  }

  if (title !== undefined) {
    drawOutlinedText(buffer, "TINY SAMPLE", 8, 8, {
    family: theme.fontRoles?.tiny?.family ?? "px-sans",
    weight: theme.fontRoles?.tiny?.weight ?? "regular",
    slope: theme.fontRoles?.tiny?.slope ?? "roman",
    size: "tiny",
    pixelSize: theme.fontRoles?.tiny?.pixelSize ?? fontPresets.tiny
    }, title, outline, outlineThickness);
  }
  drawOutlinedText(buffer, "ACCENT", width - 54, 8, {
    family: theme.fontRoles?.tiny?.family ?? "px-sans",
    weight: theme.fontRoles?.tiny?.weight ?? "regular",
    slope: theme.fontRoles?.tiny?.slope ?? "roman",
    size: "tiny",
    pixelSize: theme.fontRoles?.tiny?.pixelSize ?? fontPresets.tiny
  }, accent, outline, outlineThickness);
  if (body !== undefined) {
    drawOutlinedText(buffer, "Normal sample text", 8, 28, {
    family: theme.fontRoles?.normal?.family ?? "px-sans",
    weight: theme.fontRoles?.normal?.weight ?? "regular",
    slope: theme.fontRoles?.normal?.slope ?? "roman",
    size: "normal",
    pixelSize: theme.fontRoles?.normal?.pixelSize ?? fontPresets.normal
    }, body, outline, outlineThickness);
  }
  if (emphasis !== undefined) {
    drawOutlinedText(buffer, "Emphasis sample", 8, 42, {
    family: theme.fontRoles?.normalEmphasis?.family ?? theme.fontRoles?.normal?.family ?? "px-sans",
    weight: theme.fontRoles?.normalEmphasis?.weight ?? theme.fontRoles?.normal?.weight ?? "bold",
    slope: theme.fontRoles?.normalEmphasis?.slope ?? theme.fontRoles?.normal?.slope ?? "roman",
    size: "normal",
    pixelSize: theme.fontRoles?.normalEmphasis?.pixelSize ?? theme.fontRoles?.normal?.pixelSize ?? fontPresets.normal
    }, emphasis, outline, outlineThickness);
  }
  if (value !== undefined) {
    drawOutlinedText(buffer, "Header 21.5", 8, 58, {
    family: theme.fontRoles?.header?.family ?? "px-sans",
    weight: theme.fontRoles?.header?.weight ?? "regular",
    slope: theme.fontRoles?.header?.slope ?? "roman",
    size: "header",
    pixelSize: theme.fontRoles?.header?.pixelSize ?? fontPresets.header
    }, value, outline, outlineThickness);
  }
  if (body !== undefined) {
    drawOutlinedText(buffer, "body / accent", 8, height - 18, {
    family: theme.fontRoles?.tiny?.family ?? "px-sans",
    weight: theme.fontRoles?.tiny?.weight ?? "regular",
    slope: theme.fontRoles?.tiny?.slope ?? "roman",
    size: "tiny",
    pixelSize: theme.fontRoles?.tiny?.pixelSize ?? fontPresets.tiny
    }, body, outline, outlineThickness);
  }
  drawOutlinedText(buffer, "*", width - 14, height - 22, {
    family: theme.fontRoles?.header?.family ?? "px-sans",
    weight: theme.fontRoles?.header?.weight ?? "regular",
    slope: theme.fontRoles?.header?.slope ?? "roman",
    size: "header",
    pixelSize: theme.fontRoles?.header?.pixelSize ?? fontPresets.header
  }, accent, outline, outlineThickness);

  return {
    width,
    height,
    rgba: rgbaFromPixels(buffer, displayType)
  };
}
