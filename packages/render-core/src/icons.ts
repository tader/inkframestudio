import { FONT_AWESOME_ICON_DEFINITIONS, FONT_AWESOME_ICON_GLYPHS, type FontAwesomeIconGlyphDefinition } from "./generated-font-awesome-icons.js";
import type { IconDefinition } from "./types.js";

const LEGACY_ICON_ALIASES: Record<string, string> = {
  garage: "fa-solid:warehouse",
  warning: "fa-solid:triangle-exclamation",
  calendar: "fa-regular:calendar",
  door: "fa-solid:door-open",
  lock: "fa-solid:lock",
  thermometer: "fa-solid:temperature-half",
  humidity: "fa-solid:droplet",
  power: "fa-solid:power-off",
  clock: "fa-regular:clock",
  bolt: "fa-solid:bolt",
  window: "fa-regular:window-maximize",
  battery: "fa-solid:battery-half"
};

const DEFAULT_ICON_ID = "fa-solid:triangle-exclamation";

export const ICON_DEFINITIONS: IconDefinition[] = FONT_AWESOME_ICON_DEFINITIONS;

export function normalizeIconId(iconId: string | undefined): string {
  const raw = String(iconId ?? "").trim();
  if (!raw) {
    return DEFAULT_ICON_ID;
  }
  return LEGACY_ICON_ALIASES[raw] ?? raw;
}

export function resolveIconDefinition(iconId: string | undefined): FontAwesomeIconGlyphDefinition | undefined {
  const normalized = normalizeIconId(iconId);
  return FONT_AWESOME_ICON_GLYPHS[normalized] ?? FONT_AWESOME_ICON_GLYPHS[DEFAULT_ICON_ID];
}

export function defaultIconId(): string {
  return DEFAULT_ICON_ID;
}
