import type { DisplayProfile } from "./types.js";

export const DISPLAY_PROFILES: DisplayProfile[] = [
  {
    id: "tri296x128-red",
    width: 296,
    height: 128,
    rotation: 0,
    palette: { bg: "#ffffff", fg: "#111111", accent: "#d7261b" },
    contentPadding: { top: 4, right: 4, bottom: 4, left: 4 },
    gridUnitPx: 8,
    recommendedFontScale: 2
  },
  {
    id: "tri296x128-yellow",
    width: 296,
    height: 128,
    rotation: 0,
    palette: { bg: "#ffffff", fg: "#111111", accent: "#d5a000" },
    contentPadding: { top: 4, right: 4, bottom: 4, left: 4 },
    gridUnitPx: 8,
    recommendedFontScale: 2
  },
  {
    id: "tri400x300-red",
    width: 400,
    height: 300,
    rotation: 0,
    palette: { bg: "#ffffff", fg: "#111111", accent: "#d7261b" },
    contentPadding: { top: 8, right: 8, bottom: 8, left: 8 },
    gridUnitPx: 10,
    recommendedFontScale: 3
  },
  {
    id: "tri400x300-yellow",
    width: 400,
    height: 300,
    rotation: 0,
    palette: { bg: "#ffffff", fg: "#111111", accent: "#d5a000" },
    contentPadding: { top: 8, right: 8, bottom: 8, left: 8 },
    gridUnitPx: 10,
    recommendedFontScale: 3
  }
];

export function getDisplayProfile(profileId: string): DisplayProfile {
  const profile = DISPLAY_PROFILES.find((candidate) => candidate.id === profileId);
  if (!profile) {
    throw new Error(`Unknown display profile: ${profileId}`);
  }
  return profile;
}
