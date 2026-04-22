import type { FontPresetValues } from "./types.js";

export const DEFAULT_FONT_PRESETS: FontPresetValues = {
  tiny: 8,
  normal: 12,
  header: 16
};

export function normalizeFontPresets(presets?: Partial<FontPresetValues>): FontPresetValues {
  return {
    tiny: clampFontPreset(presets?.tiny ?? DEFAULT_FONT_PRESETS.tiny),
    normal: clampFontPreset(presets?.normal ?? DEFAULT_FONT_PRESETS.normal),
    header: clampFontPreset(presets?.header ?? DEFAULT_FONT_PRESETS.header)
  };
}

function clampFontPreset(value: number): number {
  return Math.max(4, Math.min(36, Math.round(value)));
}
