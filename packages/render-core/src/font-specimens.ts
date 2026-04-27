import { layoutText, supportsFontVariant } from "./text-layout.js";
import { PixelBuffer, COLOR_ACCENT, COLOR_BG, COLOR_FG } from "./pixel-buffer.js";
import type { DisplayProfile, FontFamily, FontOption, FontSlope, FontVariantKey, FontWeight, Project } from "./types.js";

export interface FontSpecimenTile {
  size: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface FontSpecimenVariantGroup {
  weight: FontWeight;
  slope: FontSlope;
  variantKey: FontVariantKey;
  tiles: FontSpecimenTile[];
}

export interface FontSpecimenFamilyGroup {
  family: FontFamily;
  label: string;
  source: FontOption["source"];
  variants: FontSpecimenVariantGroup[];
  allowedPixelSizes?: number[];
}

const SPECIMEN_VARIANTS: Array<{ weight: FontWeight; slope: FontSlope; variantKey: FontVariantKey }> = [
  { weight: "regular", slope: "roman", variantKey: "regular" },
  { weight: "regular", slope: "italic", variantKey: "italic" },
  { weight: "bold", slope: "roman", variantKey: "bold" },
  { weight: "bold", slope: "italic", variantKey: "boldItalic" }
];

function parseHexColor(value: string): [number, number, number] {
  const safe = value.startsWith("#") ? value.slice(1) : value;
  const numeric = Number.parseInt(safe, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function rgbaFromPixels(buffer: PixelBuffer, profile: DisplayProfile): Uint8ClampedArray {
  const colors = [
    parseHexColor(profile.palette.bg),
    parseHexColor(profile.palette.fg),
    parseHexColor(profile.palette.accent)
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

function allowedOrAllSizes(font: FontOption, minSize: number, maxSize: number, includeAllSizes = false): number[] {
  if (includeAllSizes) {
    return Array.from({ length: maxSize - minSize + 1 }, (_entry, index) => minSize + index);
  }
  const allowed = (font.allowedPixelSizes ?? []).filter((size) => size >= minSize && size <= maxSize);
  if (allowed.length) {
    return allowed;
  }
  return Array.from({ length: maxSize - minSize + 1 }, (_entry, index) => minSize + index);
}

function renderSpecimenTile(
  profile: DisplayProfile,
  project: Project,
  family: FontFamily,
  weight: FontWeight,
  slope: FontSlope,
  sampleText: string,
  size: number
): FontSpecimenTile {
  const metrics = layoutText(
    `${size}px ${sampleText}`,
    { family, weight, slope, size: "normal", pixelSize: size, bypassAllowedPixelSizes: true },
    project.fontPresets
  );
  const width = Math.max(64, Math.min(profile.width, metrics.width + 8));
  const height = Math.max(18, metrics.lineHeight + 6);
  const buffer = new PixelBuffer(width, height, COLOR_BG, project.fontPresets);
  buffer.fill(COLOR_BG);
  const baseline = 2 + metrics.ascent;
  for (let x = 2; x < width - 2; x += 1) {
    buffer.setPixel(x, baseline, COLOR_ACCENT);
  }
  buffer.drawText(
    `${size}px ${sampleText}`,
    2,
    2,
    { family, weight, slope, size: "normal", pixelSize: size, bypassAllowedPixelSizes: true },
    COLOR_FG
  );
  return {
    size,
    width,
    height,
    rgba: rgbaFromPixels(buffer, profile)
  };
}

export function renderFontSpecimenSheets(
  profile: DisplayProfile,
  project: Project,
  sampleText: string,
  minSize = 4,
  maxSize = 36,
  fonts: FontOption[] = [],
  includeAllSizes = false
): FontSpecimenFamilyGroup[] {
  return fonts.map((font) => ({
    family: font.id,
    label: font.label,
    source: font.source,
    allowedPixelSizes: font.allowedPixelSizes,
    variants: SPECIMEN_VARIANTS
      .filter((variant) => supportsFontVariant(font.id, variant.weight, variant.slope))
      .map((variant) => ({
        weight: variant.weight,
        slope: variant.slope,
        variantKey: variant.variantKey,
        tiles: allowedOrAllSizes(font, minSize, maxSize, includeAllSizes).map((size) =>
          renderSpecimenTile(profile, project, font.id, variant.weight, variant.slope, sampleText, size)
        )
      }))
  }));
}
