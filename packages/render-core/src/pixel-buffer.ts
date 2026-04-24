import { DEFAULT_FONT_PRESETS } from "./font-presets.js";
import { layoutText, resolveTextStyle } from "./bitmap-font.js";
import { resolveIconDefinition } from "./icons.js";
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

const iconPixelSizeCache = new Map<string, number>();

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
    const icon = resolveIconDefinition(name);
    if (!icon) {
      return;
    }
    const boxSize = Math.max(1, scale * 10);
    const pixelSize = this.pickIconPixelSize(icon.id, icon.char, icon.fontFamily, boxSize, boxSize);
    const style = {
      family: icon.fontFamily,
      weight: "regular",
      slope: "roman",
      size: "normal",
      pixelSize,
      bypassAllowedPixelSizes: true
    } satisfies Partial<TextStyle>;
    const run = layoutText(icon.char, resolveTextStyle(style), this.fontPresets);
    const drawX = x + Math.floor((boxSize - run.width) / 2);
    const drawY = y + Math.floor((boxSize - run.height) / 2);
    this.drawText(icon.char, drawX, drawY, style, color, clip);
  }

  private pickIconPixelSize(
    iconId: string,
    char: string,
    family: string,
    boxWidth: number,
    boxHeight: number
  ): number {
    const cacheKey = `${iconId}:${boxWidth}x${boxHeight}`;
    const cached = iconPixelSizeCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    let low = 1;
    let high = Math.max(boxWidth, boxHeight) * 3;
    let best = 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const metrics = this.measureText(char, {
        family,
        weight: "regular",
        slope: "roman",
        size: "normal",
        pixelSize: mid,
        bypassAllowedPixelSizes: true
      });
      if (metrics.width <= boxWidth && metrics.height <= boxHeight) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    iconPixelSizeCache.set(cacheKey, best);
    return best;
  }
}
