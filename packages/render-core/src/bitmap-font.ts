import * as fontkit from "fontkit";
import { DEFAULT_FONT_PRESETS } from "./font-presets.js";
import { FONT_BINARY_BASE64 } from "./generated-font-data.js";
import type { FontFamily, FontOption, FontPresetValues, FontSize, FontSlope, FontVariantKey, FontWeight, TextStyle } from "./types.js";

type FontkitFont = {
  ascent: number;
  descent: number;
  lineGap: number;
  unitsPerEm: number;
  glyphForCodePoint(codePoint: number): FontkitGlyph;
  layout(text: string): {
    glyphs: FontkitGlyph[];
    positions: Array<{
      xAdvance: number;
      yAdvance: number;
      xOffset: number;
      yOffset: number;
    }>;
  };
};

type FontkitGlyph = {
  id: number;
  advanceWidth: number;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  path: {
    commands: Array<{ command: string; args?: number[] }>;
  };
};

type ResolvedFontFamily = string;
type EmbeddedFontFamilyData = {
  regular: string;
  italic?: string;
  bold?: string;
  boldItalic?: string;
};

interface GlyphCacheEntry {
  width: number;
  height: number;
  pixels: number[][];
  advance: number;
  bearingX: number;
  top: number;
}

export interface Glyph {
  width: number;
  height: number;
  pixels: number[][];
  advance: number;
  bearingX: number;
  top: number;
}

export interface PositionedGlyph extends Glyph {
  char: string;
  x: number;
  y: number;
}

export interface TextLayoutRun {
  width: number;
  height: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  baseline: number;
  glyphs: PositionedGlyph[];
}

interface Point {
  x: number;
  y: number;
}

const TABULAR_DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const COMPACT_NUMERIC_PUNCTUATION = new Set([".", ":", "-", "/", "%"]);

const fontCache = new Map<string, FontkitFont>();
const glyphCache = new Map<string, GlyphCacheEntry>();
const tabularAdvanceCache = new Map<string, number>();
const layoutCache = new Map<string, TextLayoutRun>();
const userFontData = new Map<string, { regular?: string; italic?: string; bold?: string; boldItalic?: string; label?: string; allowedPixelSizes?: number[] }>();
const missingFontFamilyWarnings = new Set<string>();
let textLayoutAdapter: TextLayoutAdapter | undefined;
const DEFAULT_FALLBACK_FAMILY: ResolvedFontFamily = "px-sans";

export interface FontFamilyData {
  regular?: string;
  italic?: string;
  bold?: string;
  boldItalic?: string;
  label?: string;
  allowedPixelSizes?: number[];
}

export interface TextLayoutAdapterRequest {
  text: string;
  style: TextStyle;
  fontPresets: FontPresetValues;
  fontFamilyData: FontFamilyData;
}

export type TextLayoutAdapter = (request: TextLayoutAdapterRequest) => TextLayoutRun | undefined;

export const BUILT_IN_FONT_OPTIONS: FontOption[] = [
  { id: "px-sans", label: "PX Sans", source: "built-in", variants: ["regular", "bold"] },
  { id: "px-mono-special", label: "PX Mono Special", source: "built-in", variants: ["regular"] },
  { id: "ui-sans", label: "Legacy UI Sans", source: "built-in", variants: ["regular", "bold"] }
];

function clearFontCaches(): void {
  fontCache.clear();
  glyphCache.clear();
  tabularAdvanceCache.clear();
  layoutCache.clear();
}

export function setTextLayoutAdapter(adapter: TextLayoutAdapter | undefined): void {
  textLayoutAdapter = adapter;
  clearFontCaches();
}

export function registerUserFonts(fonts: Record<string, { regular?: string; italic?: string; bold?: string; boldItalic?: string; label?: string; allowedPixelSizes?: number[] }>): void {
  userFontData.clear();
  for (const [id, value] of Object.entries(fonts)) {
    userFontData.set(id, value);
  }
  clearFontCaches();
}

function resolveFamily(family: FontFamily): ResolvedFontFamily {
  const resolved = family === "ui-sans" ? "px-sans" : family;
  if (userFontData.has(resolved) || FONT_BINARY_BASE64[resolved as keyof typeof FONT_BINARY_BASE64]) {
    return resolved;
  }
  if (!missingFontFamilyWarnings.has(resolved)) {
    missingFontFamilyWarnings.add(resolved);
    console.warn(`Unknown font family ${resolved}; falling back to ${DEFAULT_FALLBACK_FAMILY}`);
  }
  return DEFAULT_FALLBACK_FAMILY;
}

function variantKeyFor(weight: FontWeight, slope: FontSlope): FontVariantKey {
  if (weight === "bold" && slope === "italic") {
    return "boldItalic";
  }
  if (weight === "bold") {
    return "bold";
  }
  if (slope === "italic") {
    return "italic";
  }
  return "regular";
}

function fontDataFor(family: ResolvedFontFamily, weight: FontWeight, slope: FontSlope): string {
  const preferredVariant = variantKeyFor(weight, slope);
  const imported = userFontData.get(family);
  if (imported) {
    return imported[preferredVariant] ?? imported.regular ?? imported.bold ?? "";
  }
  const familyData =
    (FONT_BINARY_BASE64[family as keyof typeof FONT_BINARY_BASE64] as EmbeddedFontFamilyData | undefined) ??
    (FONT_BINARY_BASE64[DEFAULT_FALLBACK_FAMILY as keyof typeof FONT_BINARY_BASE64] as EmbeddedFontFamilyData);
  return familyData[preferredVariant] ?? familyData.regular;
}

function fontFamilyDataFor(family: ResolvedFontFamily): FontFamilyData {
  const imported = userFontData.get(family);
  if (imported) {
    return imported;
  }
  const familyData = FONT_BINARY_BASE64[family as keyof typeof FONT_BINARY_BASE64] as EmbeddedFontFamilyData | undefined;
  if (!familyData) {
    return {};
  }
  return {
    regular: familyData.regular,
    italic: familyData.italic,
    bold: familyData.bold,
    boldItalic: familyData.boldItalic
  };
}

function hasRealVariant(family: ResolvedFontFamily, weight: FontWeight, slope: FontSlope): boolean {
  const preferredVariant = variantKeyFor(weight, slope);
  const imported = userFontData.get(family);
  if (imported) {
    return Boolean(imported[preferredVariant]);
  }
  const familyData = FONT_BINARY_BASE64[family as keyof typeof FONT_BINARY_BASE64] as EmbeddedFontFamilyData | undefined;
  if (!familyData) {
    return false;
  }
  return Boolean(familyData[preferredVariant]);
}

function decodeBase64FontData(base64: string): Uint8Array {
  if (typeof globalThis.Buffer !== "undefined") {
    return Uint8Array.from(globalThis.Buffer.from(base64, "base64"));
  }
  if (typeof globalThis.atob !== "undefined") {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  throw new Error("No base64 decoder available for font loading");
}

function getFont(family: FontFamily, weight: FontWeight, slope: FontSlope): FontkitFont {
  const resolvedFamily = resolveFamily(family);
  const cacheKey = `${resolvedFamily}:${weight}:${slope}:${hasRealVariant(resolvedFamily, weight, slope) ? "native" : "fallback"}`;
  const existing = fontCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const font = fontkit.create(decodeBase64FontData(fontDataFor(resolvedFamily, weight, slope))) as unknown as FontkitFont;
  fontCache.set(cacheKey, font);
  return font;
}

function syntheticBoldEnabled(style: TextStyle): boolean {
  const family = resolveFamily(style.family);
  return style.weight === "bold" && style.slope === "roman" && !hasRealVariant(family, style.weight, style.slope);
}

export function scaleForFontSize(size: FontSize): number {
  if (size === "tiny") return 1;
  if (size === "normal") return 2;
  return 3;
}

function nearestAllowedPixelSize(family: FontFamily, pixelSize: number): number {
  const allowed = userFontData.get(resolveFamily(family))?.allowedPixelSizes;
  if (!allowed?.length) {
    return pixelSize;
  }
  return allowed.reduce((best, current) =>
    Math.abs(current - pixelSize) < Math.abs(best - pixelSize) ? current : best
  );
}

function pixelSizeForStyle(style: TextStyle, fontPresets: FontPresetValues): number {
  if (style.bypassAllowedPixelSizes) {
    return style.pixelSize ?? fontPresets[style.size];
  }
  return nearestAllowedPixelSize(style.family, style.pixelSize ?? fontPresets[style.size]);
}

function fontScale(style: TextStyle, fontPresets: FontPresetValues): number {
  const font = getFont(style.family, style.weight, style.slope);
  return pixelSizeForStyle(style, fontPresets) / font.unitsPerEm;
}

function roundUnit(value: number): number {
  return Math.round(value);
}

function clonePixels(pixels: number[][]): number[][] {
  return pixels.map((row) => row.slice());
}

function emboldenPixels(input: number[][]): number[][] {
  if (!input.length || !input[0]?.length) {
    return input;
  }
  const width = input[0].length;
  const output = input.map((row) => row.slice());
  for (let y = 0; y < input.length; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!input[y][x]) {
        continue;
      }
      if (x + 1 < width) {
        output[y][x + 1] = 1;
      }
    }
  }
  return output;
}

function transformPoint(point: Point, scale: number, left: number, top: number): Point {
  return {
    x: point.x * scale - left,
    y: top - point.y * scale
  };
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
  };
}

function cubicPoint(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse * inverse * inverse * start.x +
      3 * inverse * inverse * t * control1.x +
      3 * inverse * t * t * control2.x +
      t * t * t * end.x,
    y:
      inverse * inverse * inverse * start.y +
      3 * inverse * inverse * t * control1.y +
      3 * inverse * t * t * control2.y +
      t * t * t * end.y
  };
}

function dedupeContour(points: Point[]): Point[] {
  const deduped: Point[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.001 && Math.abs(last.y - point.y) < 0.001) {
      continue;
    }
    deduped.push(point);
  }
  if (deduped.length > 1) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (Math.abs(first.x - last.x) < 0.001 && Math.abs(first.y - last.y) < 0.001) {
      deduped.pop();
    }
  }
  return deduped;
}

function flattenGlyphPath(glyph: FontkitGlyph, scale: number, left: number, top: number): Point[][] {
  const contours: Point[][] = [];
  let currentContour: Point[] = [];
  let currentPoint: Point | undefined;
  let contourStart: Point | undefined;

  const finishContour = (): void => {
    const deduped = dedupeContour(currentContour);
    if (deduped.length >= 3) {
      contours.push(deduped);
    }
    currentContour = [];
    contourStart = undefined;
  };

  for (const command of glyph.path.commands) {
    switch (command.command) {
      case "moveTo": {
        const [x = 0, y = 0] = command.args ?? [];
        if (currentContour.length) {
          finishContour();
        }
        currentPoint = { x, y };
        contourStart = currentPoint;
        currentContour.push(transformPoint(currentPoint, scale, left, top));
        break;
      }
      case "lineTo": {
        const [x = 0, y = 0] = command.args ?? [];
        currentPoint = { x, y };
        currentContour.push(transformPoint(currentPoint, scale, left, top));
        break;
      }
      case "quadraticCurveTo": {
        const [cpx = 0, cpy = 0, x = 0, y = 0] = command.args ?? [];
        if (!currentPoint) {
          currentPoint = { x, y };
          break;
        }
        const start = currentPoint;
        const control = { x: cpx, y: cpy };
        const end = { x, y };
        for (let step = 1; step <= 10; step += 1) {
          currentContour.push(transformPoint(quadraticPoint(start, control, end, step / 10), scale, left, top));
        }
        currentPoint = end;
        break;
      }
      case "bezierCurveTo": {
        const [cp1x = 0, cp1y = 0, cp2x = 0, cp2y = 0, x = 0, y = 0] = command.args ?? [];
        if (!currentPoint) {
          currentPoint = { x, y };
          break;
        }
        const start = currentPoint;
        const control1 = { x: cp1x, y: cp1y };
        const control2 = { x: cp2x, y: cp2y };
        const end = { x, y };
        for (let step = 1; step <= 12; step += 1) {
          currentContour.push(transformPoint(cubicPoint(start, control1, control2, end, step / 12), scale, left, top));
        }
        currentPoint = end;
        break;
      }
      case "closePath": {
        if (contourStart) {
          currentContour.push(transformPoint(contourStart, scale, left, top));
        }
        finishContour();
        currentPoint = contourStart;
        break;
      }
      default:
        break;
    }
  }

  if (currentContour.length) {
    finishContour();
  }

  return contours;
}

function pointInContours(sampleX: number, sampleY: number, contours: Point[][]): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let index = 0, prev = contour.length - 1; index < contour.length; prev = index, index += 1) {
      const current = contour[index];
      const previous = contour[prev];
      const intersects =
        (current.y > sampleY) !== (previous.y > sampleY) &&
        sampleX < ((previous.x - current.x) * (sampleY - current.y)) / ((previous.y - current.y) || 1e-9) + current.x;
      if (intersects) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function rasterizeContours(width: number, height: number, contours: Point[][]): number[][] {
  if (width <= 0 || height <= 0 || contours.length === 0) {
    return [];
  }
  const pixels = Array.from({ length: height }, () => Array<number>(width).fill(0));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pointInContours(x + 0.5, y + 0.5, contours)) {
        pixels[y][x] = 1;
      }
    }
  }
  return pixels;
}

function numericAdvance(style: TextStyle, fontPresets: FontPresetValues): number {
  const resolvedFamily = resolveFamily(style.family);
  const cacheKey = `${resolvedFamily}:${style.weight}:${style.slope}:${style.size}:${style.pixelSize ?? "preset"}:${fontPresets.tiny}:${fontPresets.normal}:${fontPresets.header}`;
  const cached = tabularAdvanceCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const font = getFont(style.family, style.weight, style.slope);
  const scale = fontScale(style, fontPresets);
  const widest = Math.max(
    1,
    ...Array.from(TABULAR_DIGITS).map((entry) => roundUnit(font.glyphForCodePoint(entry.codePointAt(0) ?? 32).advanceWidth * scale))
  );
  const syntheticPadding = syntheticBoldEnabled(style) ? 1 : 0;
  const resolved = widest + syntheticPadding;
  tabularAdvanceCache.set(cacheKey, resolved);
  return resolved;
}

function rasterizeGlyph(glyph: FontkitGlyph, style: TextStyle, fontPresets: FontPresetValues): GlyphCacheEntry {
  const cacheKey = `${resolveFamily(style.family)}:${style.weight}:${style.slope}:${style.size}:${style.pixelSize ?? "preset"}:${fontPresets.tiny}:${fontPresets.normal}:${fontPresets.header}:${glyph.id}:${syntheticBoldEnabled(style) ? "sb" : "native"}`;
  const cached = glyphCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      pixels: clonePixels(cached.pixels)
    };
  }

  const scale = fontScale(style, fontPresets);
  const minX = Number.isFinite(glyph.bbox.minX) ? glyph.bbox.minX : 0;
  const minY = Number.isFinite(glyph.bbox.minY) ? glyph.bbox.minY : 0;
  const maxX = Number.isFinite(glyph.bbox.maxX) ? glyph.bbox.maxX : 0;
  const maxY = Number.isFinite(glyph.bbox.maxY) ? glyph.bbox.maxY : 0;
  const left = Math.floor(minX * scale);
  const top = Math.ceil(maxY * scale);
  const right = Math.ceil(maxX * scale);
  const bottom = Math.floor(minY * scale);
  const width = Math.max(0, right - left);
  const height = Math.max(0, top - bottom);
  const contours = flattenGlyphPath(glyph, scale, left, top);
  const basePixels = rasterizeContours(width, height, contours);
  const pixels = syntheticBoldEnabled(style) ? emboldenPixels(basePixels) : basePixels;
  const advance = Math.max(1, roundUnit(glyph.advanceWidth * scale) + (syntheticBoldEnabled(style) ? 1 : 0));

  const entry: GlyphCacheEntry = {
    width,
    height,
    pixels,
    advance,
    bearingX: left,
    top
  };
  glyphCache.set(cacheKey, entry);
  return {
    ...entry,
    pixels: clonePixels(entry.pixels)
  };
}

function compactNumericPunctuationAdvance(glyph: GlyphCacheEntry): number {
  return Math.max(1, Math.min(glyph.advance, glyph.bearingX + glyph.width + 2));
}

export function resolveTextStyle(style?: Partial<TextStyle>): TextStyle {
  return {
    family: style?.family ?? (style?.tabularNumbers ? "px-mono-special" : "px-sans"),
    weight: style?.weight ?? "regular",
    slope: style?.slope ?? "roman",
    size: style?.size ?? "normal",
    tabularNumbers: style?.tabularNumbers ?? false,
    pixelSize: style?.pixelSize,
    bypassAllowedPixelSizes: style?.bypassAllowedPixelSizes ?? false
  };
}

export function supportsFontVariant(family: FontFamily, weight: FontWeight, slope: FontSlope): boolean {
  return hasRealVariant(resolveFamily(family), weight, slope);
}

export function lineHeightForStyle(style?: Partial<TextStyle>, fontPresets: FontPresetValues = DEFAULT_FONT_PRESETS): number {
  return layoutText("Hg", style, fontPresets).lineHeight;
}

export function getGlyph(char: string, style?: Partial<TextStyle>, fontPresets: FontPresetValues = DEFAULT_FONT_PRESETS): Glyph {
  const resolved = resolveTextStyle(style);
  const font = getFont(resolved.family, resolved.weight, resolved.slope);
  const codePoint = char.codePointAt(0) ?? 32;
  const glyph = rasterizeGlyph(font.glyphForCodePoint(codePoint), resolved, fontPresets);
  const advance =
    resolved.tabularNumbers && TABULAR_DIGITS.has(char)
      ? numericAdvance(resolved, fontPresets)
      : resolved.tabularNumbers && COMPACT_NUMERIC_PUNCTUATION.has(char)
        ? compactNumericPunctuationAdvance(glyph)
        : glyph.advance;
  return {
    ...glyph,
    advance
  };
}

export function layoutText(
  text: string,
  style?: Partial<TextStyle>,
  fontPresets: FontPresetValues = DEFAULT_FONT_PRESETS
): TextLayoutRun {
  const resolved = resolveTextStyle(style);
  const cacheKey = JSON.stringify({
    text,
    family: resolved.family,
    weight: resolved.weight,
    slope: resolved.slope,
    size: resolved.size,
    tabularNumbers: resolved.tabularNumbers ?? false,
    pixelSize: resolved.pixelSize ?? null,
    bypassAllowedPixelSizes: resolved.bypassAllowedPixelSizes ?? false,
    fontPresets
  });
  const cached = layoutCache.get(cacheKey);
  if (cached) {
    return {
      ...cached,
      glyphs: cached.glyphs.map((glyph) => ({
        ...glyph,
        pixels: clonePixels(glyph.pixels)
      }))
    };
  }

  if (textLayoutAdapter) {
    const adapted = textLayoutAdapter({
      text,
      style: resolved,
      fontPresets,
      fontFamilyData: fontFamilyDataFor(resolveFamily(resolved.family))
    });
    if (adapted) {
      layoutCache.set(cacheKey, {
        ...adapted,
        glyphs: adapted.glyphs.map((glyph) => ({
          ...glyph,
          pixels: clonePixels(glyph.pixels)
        }))
      });
      return {
        ...adapted,
        glyphs: adapted.glyphs.map((glyph) => ({
          ...glyph,
          pixels: clonePixels(glyph.pixels)
        }))
      };
    }
  }

  const font = getFont(resolved.family, resolved.weight, resolved.slope);
  const scale = fontScale(resolved, fontPresets);
  const baseline = Math.ceil(font.ascent * scale);
  const ascent = baseline;
  const descent = Math.ceil(Math.abs(font.descent * scale));
  const lineHeight = Math.max(ascent + descent, Math.ceil((font.ascent - font.descent + font.lineGap) * scale));
  const run = font.layout(text);
  const chars = Array.from(text);
  const tabularAdvancePx = resolved.tabularNumbers ? numericAdvance(resolved, fontPresets) : 0;
  const glyphs: PositionedGlyph[] = [];
  let cursorX = 0;
  let maxRight = 0;

  for (let index = 0; index < run.glyphs.length; index += 1) {
    const char = chars[index] ?? "";
    const glyph = rasterizeGlyph(run.glyphs[index], resolved, fontPresets);
    const position = run.positions[index] ?? { xAdvance: 0, yAdvance: 0, xOffset: 0, yOffset: 0 };
    const xOffset = roundUnit(position.xOffset * scale);
    const yOffset = roundUnit(position.yOffset * scale);
    const effectiveAdvance =
      resolved.tabularNumbers && TABULAR_DIGITS.has(char)
        ? tabularAdvancePx
        : resolved.tabularNumbers && COMPACT_NUMERIC_PUNCTUATION.has(char)
          ? compactNumericPunctuationAdvance(glyph)
          : Math.max(1, roundUnit(position.xAdvance * scale) + (syntheticBoldEnabled(resolved) ? 1 : 0));
    const x = cursorX + xOffset + glyph.bearingX;
    const y = baseline - glyph.top - yOffset;
    glyphs.push({
      ...glyph,
      advance: effectiveAdvance,
      char,
      x,
      y
    });
    maxRight = Math.max(maxRight, x + glyph.width);
    cursorX += effectiveAdvance;
  }

  const result: TextLayoutRun = {
    width: Math.max(cursorX, maxRight),
    height: Math.max(lineHeight, ascent + descent),
    ascent,
    descent,
    lineHeight,
    baseline,
    glyphs
  };

  layoutCache.set(cacheKey, {
    ...result,
    glyphs: result.glyphs.map((glyph) => ({
      ...glyph,
      pixels: clonePixels(glyph.pixels)
    }))
  });

  return result;
}
