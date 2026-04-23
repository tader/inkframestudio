import { DEFAULT_FONT_PRESETS } from "./font-presets.js";
import { layoutText, resolveTextStyle } from "./bitmap-font.js";
import { ICONS } from "./icons.js";
import type { FontPresetValues, TextStyle } from "./types.js";

export const COLOR_BG = 0;
export const COLOR_FG = 1;
export const COLOR_ACCENT = 2;

export interface PixelClipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PixelPaint =
  | { kind: "solid"; color: number }
  | { kind: "checker"; primary: number; secondary: number };

function clipContains(clip: PixelClipRect | undefined, x: number, y: number): boolean {
  if (!clip) {
    return true;
  }
  return x >= clip.x && y >= clip.y && x < clip.x + clip.w && y < clip.y + clip.h;
}

export class PixelBuffer {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill = COLOR_BG,
    readonly fontPresets: FontPresetValues = DEFAULT_FONT_PRESETS
  ) {
    this.pixels = new Uint8Array(width * height);
    this.pixels.fill(fill);
  }

  clone(): PixelBuffer {
    const next = new PixelBuffer(this.width, this.height, COLOR_BG, this.fontPresets);
    next.pixels.set(this.pixels);
    return next;
  }

  fill(color: number): void {
    this.pixels.fill(color);
  }

  setPixel(x: number, y: number, color: number, clip?: PixelClipRect): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }
    if (!clipContains(clip, x, y)) {
      return;
    }
    this.pixels[y * this.width + x] = color;
  }

  getPixel(x: number, y: number): number {
    return this.pixels[y * this.width + x] ?? COLOR_BG;
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    filled = false,
    clip?: PixelClipRect
  ): void {
    if (filled) {
      for (let py = y; py < y + h; py += 1) {
        for (let px = x; px < x + w; px += 1) {
          this.setPixel(px, py, color, clip);
        }
      }
      return;
    }
    for (let px = x; px < x + w; px += 1) {
      this.setPixel(px, y, color, clip);
      this.setPixel(px, y + h - 1, color, clip);
    }
    for (let py = y; py < y + h; py += 1) {
      this.setPixel(x, py, color, clip);
      this.setPixel(x + w - 1, py, color, clip);
    }
  }

  drawPaintRect(
    x: number,
    y: number,
    w: number,
    h: number,
    paint: PixelPaint,
    clip?: PixelClipRect
  ): void {
    if (paint.kind === "solid") {
      this.drawRect(x, y, w, h, paint.color, true, clip);
      return;
    }
    for (let py = y; py < y + h; py += 1) {
      for (let px = x; px < x + w; px += 1) {
        this.setPixel(px, py, (px + py) % 2 === 0 ? paint.primary : paint.secondary, clip);
      }
    }
  }

  drawText(
    text: string,
    x: number,
    y: number,
    style: Partial<TextStyle> | undefined,
    color: number,
    clip?: PixelClipRect
  ): void {
    const resolved = resolveTextStyle(style);
    const run = layoutText(text, resolved, this.fontPresets);
    for (const glyph of run.glyphs) {
      for (let gy = 0; gy < glyph.height; gy += 1) {
        for (let gx = 0; gx < glyph.width; gx += 1) {
          if (!glyph.pixels[gy]?.[gx]) {
            continue;
          }
          this.setPixel(x + glyph.x + gx, y + glyph.y + gy, color, clip);
        }
      }
    }
  }

  measureText(text: string, style?: Partial<TextStyle>): {
    width: number;
    height: number;
    ascent: number;
    descent: number;
    lineHeight: number;
  } {
    const resolved = resolveTextStyle(style);
    const metrics = layoutText(text, resolved, this.fontPresets);
    return {
      width: metrics.width,
      height: metrics.height,
      ascent: metrics.ascent,
      descent: metrics.descent,
      lineHeight: metrics.lineHeight
    };
  }

  drawIcon(
    name: string,
    x: number,
    y: number,
    scale: number,
    color: number,
    clip?: PixelClipRect
  ): void {
    const icon = ICONS[name];
    if (!icon) {
      return;
    }
    for (let py = 0; py < icon.length; py += 1) {
      for (let px = 0; px < icon[py].length; px += 1) {
        if (icon[py][px] !== "1") {
          continue;
        }
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            this.setPixel(x + px * scale + sx, y + py * scale + sy, color, clip);
          }
        }
      }
    }
  }
}
