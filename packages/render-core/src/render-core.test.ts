import { describe, expect, it } from "vitest";
import {
  DISPLAY_PROFILES,
  SAMPLE_DATA,
  SAMPLE_PROJECT,
  renderLegacyProject,
  renderThemePreviewImage,
  renderFontSpecimenSheets,
  resolveLegacyProjectState
} from "./index.js";
import { normalizeProject } from "./themes.js";
import { registerFixtureFonts } from "./test-font-fixture.js";
import type { Project, RenderData } from "./types.js";

registerFixtureFonts();

const LEGACY_PROJECT: Project = {
  id: "legacy-home-demo",
  name: "Legacy Home Demo",
  version: 1,
  locale: SAMPLE_PROJECT.locale,
  fontPresets: SAMPLE_PROJECT.fontPresets,
  themes: SAMPLE_PROJECT.themes,
  screens: [
    {
      id: "calendar-main-296",
      name: "Calendar Main 296",
      displayProfileId: "tri296x128-red",
      default: true,
      widgetThemeId: "classic-outline",
      baseWidgetIds: ["agenda-main", "datetime-main", "status-main"],
      overlayIds: ["garage-warning-overlay"],
      rules: [
        {
          id: "overlay-garage-warning",
          scope: "overlay_activation",
          priority: 100,
          condition: {
            kind: "entity_duration_ge",
            entityId: "cover.garage_door",
            state: "open",
            minutes: 15
          },
          action: { type: "activate_overlay", overlayId: "garage-warning-overlay" }
        }
      ]
    },
    {
      id: "calendar-empty-296",
      name: "Calendar Empty 296",
      displayProfileId: "tri296x128-red",
      default: false,
      widgetThemeId: "accent-header",
      baseWidgetIds: ["empty-banner", "datetime-main"],
      overlayIds: [],
      rules: [
        {
          id: "show-empty-calendar",
          scope: "screen_activation",
          priority: 50,
          condition: { kind: "entity_state", entityId: "binary_sensor.calendar_empty", equals: "on" },
          action: { type: "activate_screen", screenId: "calendar-empty-296" }
        }
      ]
    },
    {
      id: "overview-400",
      name: "Overview 400",
      displayProfileId: "tri400x300-red",
      default: true,
      widgetThemeId: "classic-outline",
      baseWidgetIds: ["agenda-large", "garage-state-large", "history-large"],
      overlayIds: [],
      rules: []
    }
  ],
  overlays: [
    {
      id: "garage-warning-overlay",
      name: "Garage Warning",
      screenId: "calendar-main-296",
      frame: { x: 4, y: 4, w: 28, h: 8 },
      widgetIds: ["garage-warning-widget"],
      priority: 100
    }
  ],
  widgets: [
    {
      id: "agenda-main",
      type: "agenda_list",
      screenId: "calendar-main-296",
      frame: { x: 0, y: 0, w: 25, h: 12 },
      bindings: { query: "agenda-today" },
      props: { title: "TODAY", maxItems: 4, emptyText: "NO EVENTS" }
    },
    {
      id: "datetime-main",
      type: "date_time_compact",
      screenId: "calendar-main-296",
      frame: { x: 25, y: 0, w: 12, h: 6 },
      bindings: {},
      props: {}
    },
    {
      id: "status-main",
      type: "status_strip",
      screenId: "calendar-main-296",
      frame: { x: 0, y: 14, w: 37, h: 2 },
      bindings: {},
      props: {
        items: [
          { label: "GARAGE", color: "accent" },
          { label: "TEMP 21C" },
          { label: "RH 49%" }
        ]
      }
    },
    {
      id: "empty-banner",
      type: "alert_banner",
      screenId: "calendar-empty-296",
      frame: { x: 3, y: 4, w: 30, h: 7 },
      bindings: {},
      props: { headline: "NO EVENTS", detail: "SHOW PRICE OR CLOCK HERE" }
    },
    {
      id: "garage-warning-widget",
      type: "alert_banner",
      overlayId: "garage-warning-overlay",
      frame: { x: 1, y: 1, w: 26, h: 6 },
      bindings: {},
      props: { headline: "GARAGE OPEN", detail: "OPEN FOR 15+ MIN" }
    },
    {
      id: "agenda-large",
      type: "agenda_list",
      screenId: "overview-400",
      frame: { x: 0, y: 0, w: 20, h: 14 },
      bindings: { query: "agenda-today" },
      props: { title: "AGENDA", maxItems: 6, emptyText: "FREE DAY" }
    },
    {
      id: "garage-state-large",
      type: "state_tile",
      screenId: "overview-400",
      frame: { x: 21, y: 0, w: 18, h: 12 },
      bindings: { entity: "cover.garage_door" },
      props: { label: "GARAGE", icon: "fa-solid:warehouse", showDuration: true }
    },
    {
      id: "history-large",
      type: "history_bars",
      screenId: "overview-400",
      frame: { x: 0, y: 16, w: 39, h: 10 },
      bindings: { query: "garage-temp-history" },
      props: { title: "GARAGE TREND" }
    }
  ],
  queries: [
    {
      id: "agenda-today",
      kind: "calendar_range",
      params: { entityId: "calendar.family", range: "today" },
      refreshPolicy: { mode: "poll", intervalSeconds: 120 }
    },
    {
      id: "garage-temp-history",
      kind: "history_range",
      params: { entityId: "sensor.garage_temperature", hours: 12 },
      refreshPolicy: { mode: "poll", intervalSeconds: 300 }
    }
  ],
  scenarios: [
    {
      id: "garage-warning-demo",
      name: "Garage Warning",
      frozenNow: "2026-04-17T14:32:00.000Z",
      entityOverrides: {
        "cover.garage_door": {
          entityId: "cover.garage_door",
          state: "open",
          attributes: {},
          lastChanged: "2026-04-17T14:10:00.000Z"
        }
      }
    },
    {
      id: "empty-calendar-demo",
      name: "Empty Calendar",
      frozenNow: "2026-04-17T08:00:00.000Z",
      entityOverrides: {
        "binary_sensor.calendar_empty": {
          entityId: "binary_sensor.calendar_empty",
          state: "on",
          attributes: {},
          lastChanged: "2026-04-17T07:59:00.000Z"
        }
      }
    }
  ]
};

const LEGACY_DATA: RenderData = {
  ...SAMPLE_DATA,
  queries: {
    "agenda-today": {
      kind: "calendar_range",
      items: [
        { start: "2026-04-17T15:00:00.000Z", summary: "Dentist" },
        { start: "2026-04-17T17:15:00.000Z", summary: "Hockey Training" },
        { start: "2026-04-17T20:00:00.000Z", summary: "Take Bins Out" }
      ]
    },
    "garage-temp-history": {
      kind: "history_range",
      points: [
        { timestamp: "2026-04-17T02:00:00.000Z", value: 13.5 },
        { timestamp: "2026-04-17T04:00:00.000Z", value: 13.7 },
        { timestamp: "2026-04-17T06:00:00.000Z", value: 14.0 },
        { timestamp: "2026-04-17T08:00:00.000Z", value: 14.2 },
        { timestamp: "2026-04-17T10:00:00.000Z", value: 14.1 },
        { timestamp: "2026-04-17T12:00:00.000Z", value: 14.4 },
        { timestamp: "2026-04-17T14:00:00.000Z", value: 14.6 }
      ]
    }
  },
  entities: {
    ...SAMPLE_DATA.entities,
    "binary_sensor.calendar_empty": {
      entityId: "binary_sensor.calendar_empty",
      state: "off",
      attributes: {},
      lastChanged: "2026-04-17T06:00:00.000Z"
    }
  }
};

describe("render-core", () => {
  it("renders a stable golden hash for 296 default screen", () => {
    const rendered = renderLegacyProject(LEGACY_PROJECT, "tri296x128-red", LEGACY_DATA);
    expect(rendered.width).toBe(296);
    expect(rendered.height).toBe(128);
    expect(rendered.hash).toBe("3d63d6a83ce4f63e6a3ae0511cc33fc374257a31ea8991a00120a40668451b1a");
  });

  it("renders a stable golden hash for 400 default screen", () => {
    const rendered = renderLegacyProject(LEGACY_PROJECT, "tri400x300-red", LEGACY_DATA);
    expect(rendered.width).toBe(400);
    expect(rendered.height).toBe(300);
    expect(rendered.hash).toBe("9cff4db9ab7b0e0637b5d2f5b0885eaf6d14fa1824fbea5a92d01e78c73a1437");
  });

  it("keeps palette-indexed pixels identical across accent profiles", () => {
    const red = renderLegacyProject(LEGACY_PROJECT, "tri296x128-red", LEGACY_DATA);
    const yellow = renderLegacyProject(
      {
        ...LEGACY_PROJECT,
        screens: LEGACY_PROJECT.screens.map((screen) => ({
          ...screen,
          displayProfileId: screen.displayProfileId.replace("-red", "-yellow")
        }))
      },
      "tri296x128-yellow",
      LEGACY_DATA
    );
    expect(Array.from(red.pixels)).toEqual(Array.from(yellow.pixels));
    expect(red.rgba).not.toEqual(yellow.rgba);
  });

  it("chooses the empty calendar fallback screen", () => {
    const resolved = resolveLegacyProjectState(LEGACY_PROJECT, "tri296x128-red", LEGACY_DATA, "empty-calendar-demo");
    expect(resolved.activeScreen.id).toBe("calendar-empty-296");
  });

  it("activates the garage overlay after 15 minutes", () => {
    const resolved = resolveLegacyProjectState(LEGACY_PROJECT, "tri296x128-red", LEGACY_DATA, "garage-warning-demo");
    expect(resolved.activeOverlay?.id).toBe("garage-warning-overlay");
  });

  it("uses the highest-priority matching rule", () => {
    const project = {
      ...LEGACY_PROJECT,
      screens: LEGACY_PROJECT.screens.map((screen) =>
        screen.id === "calendar-empty-296"
          ? {
              ...screen,
              rules: [
                ...screen.rules,
                {
                  id: "lower-priority",
                  scope: "screen_activation" as const,
                  priority: 10,
                  condition: {
                    kind: "entity_state" as const,
                    entityId: "binary_sensor.calendar_empty",
                    equals: "on"
                  },
                  action: { type: "activate_screen" as const, screenId: "calendar-main-296" }
                }
              ]
            }
          : screen
      )
    };
    const resolved = resolveLegacyProjectState(project, "tri296x128-red", LEGACY_DATA, "empty-calendar-demo");
    expect(resolved.activeScreen.id).toBe("calendar-empty-296");
  });

  it("supports display profile lookup", () => {
    expect(DISPLAY_PROFILES).toHaveLength(4);
  });

  it("merges adjacent widget borders into a single divider", () => {
    const project = normalizeProject({
      ...LEGACY_PROJECT,
      screens: [
        {
          id: "merge-screen",
          name: "Merge Screen",
          displayProfileId: "tri296x128-red",
          default: true,
          widgetThemeId: "classic-outline",
          baseWidgetIds: [],
          overlayIds: [],
          rules: []
        }
      ],
      overlays: [],
      widgets: [
        {
          id: "left",
          type: "placeholder",
          screenId: "merge-screen",
          frame: { x: 0, y: 0, w: 5, h: 5 },
          bindings: {},
          props: { title: "LEFT" }
        },
        {
          id: "right",
          type: "placeholder",
          screenId: "merge-screen",
          frame: { x: 5, y: 0, w: 5, h: 5 },
          bindings: {},
          props: { title: "RIGHT" }
        }
      ],
      scenarios: []
    });
    const rendered = renderLegacyProject(project, "tri296x128-red", LEGACY_DATA);
    const dividerX = 5 * DISPLAY_PROFILES[0].gridUnitPx - 1;
    const adjacentX = dividerX + 1;
    let dividerInterior = 0;
    let adjacentInterior = 0;
    for (let y = 1; y < 5 * DISPLAY_PROFILES[0].gridUnitPx - 1; y += 1) {
      dividerInterior += rendered.pixels[y * rendered.width + dividerX] ?? 0;
      adjacentInterior += rendered.pixels[y * rendered.width + adjacentX] ?? 0;
    }
    expect(dividerInterior).toBeGreaterThan(0);
    expect(adjacentInterior).toBe(0);
  });

  it("applies screen default theme and widget override", () => {
    const project = normalizeProject({
      ...LEGACY_PROJECT,
      screens: [
        {
          id: "theme-screen",
          name: "Theme Screen",
          displayProfileId: "tri296x128-red",
          default: true,
          widgetThemeId: "minimal-no-border",
          baseWidgetIds: [],
          overlayIds: [],
          rules: []
        }
      ],
      overlays: [],
      widgets: [
        {
          id: "inherit",
          type: "placeholder",
          screenId: "theme-screen",
          frame: { x: 0, y: 0, w: 5, h: 5 },
          bindings: {},
          props: { title: "A" }
        },
        {
          id: "override",
          type: "placeholder",
          screenId: "theme-screen",
          frame: { x: 6, y: 0, w: 5, h: 5 },
          bindings: {},
          props: { title: "B", themeId: "soft-fill" }
        }
      ],
      scenarios: []
    });
    const rendered = renderLegacyProject(project, "tri296x128-red", LEGACY_DATA);
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    const inheritedBorderPixel = rendered.pixels[0 * rendered.width + 0];
    const overrideInteriorPixel = rendered.pixels[(2 * grid) * rendered.width + (6 * grid + 2)];
    expect(inheritedBorderPixel).toBe(0);
    expect(overrideInteriorPixel).toBe(2);
  });

  it("normalizes legacy projects with default themes", () => {
    const legacy = {
      ...LEGACY_PROJECT,
      themes: [] as typeof LEGACY_PROJECT.themes,
      screens: LEGACY_PROJECT.screens.map((screen) => {
        const { widgetThemeId: _widgetThemeId, ...rest } = screen as typeof screen & { widgetThemeId?: string };
        return rest;
      })
    };
    const normalized = normalizeProject(legacy);
    expect(normalized.themes.length).toBeGreaterThan(0);
    expect(normalized.screens.every((screen) => screen.widgetThemeId)).toBe(true);
  });

  it("applies project font presets during rendering", () => {
    const compact = normalizeProject({
      ...LEGACY_PROJECT,
      fontPresets: {
        tiny: 6,
        normal: 10,
        header: 14
      }
    });
    const rendered = renderLegacyProject(compact, "tri296x128-red", LEGACY_DATA);
    expect(rendered.hash).not.toBe("fff63df1e7cce9c0ed78dc556a1f81bba76eb2401eef85dcc94cb892e905bb63");
  });

  it("renders font specimen sheets for available family variants", () => {
    const families = renderFontSpecimenSheets(DISPLAY_PROFILES[0], LEGACY_PROJECT, "Ag 09:45", 4, 6, [
      { id: "arial", label: "Arial", source: "user", variants: ["regular", "italic", "bold", "boldItalic"] }
    ]);
    expect(families.length).toBeGreaterThanOrEqual(1);
    expect(families[0]?.variants[0]?.tiles.map((tile) => tile.size)).toEqual([4, 5, 6]);
    expect(families.every((family) => family.variants.every((variant) => variant.tiles.every((tile) => tile.height > 0)))).toBe(true);
    expect(families.every((family) => family.variants.every((variant) => variant.slope === "roman" || variant.slope === "italic"))).toBe(true);
  });

  it("renders text outline in theme preview when enabled", () => {
    const normalized = normalizeProject(LEGACY_PROJECT);
    const displayType = normalized.displayTypes![0]!;
    const baseTheme = normalized.themes!.find((entry) => entry.id === "classic-outline")!;
    const noOutline = renderThemePreviewImage(baseTheme, displayType, normalized.fontPresets);
    const withOutline = renderThemePreviewImage(
      {
        ...baseTheme,
        textOutline: {
          enabled: true,
          colorRole: "accent",
          thicknessPx: 1
        }
      },
      displayType,
      normalized.fontPresets
    );
    expect(noOutline.width).toBe(displayType.width);
    expect(noOutline.height).toBe(displayType.height);
    expect(Array.from(withOutline.rgba)).not.toEqual(Array.from(noOutline.rgba));
  });

  it("does not render a solid outline block when text fill uses background color", () => {
    const normalized = normalizeProject(LEGACY_PROJECT);
    const displayType = normalized.displayTypes![0]!;
    const baseTheme = normalized.themes!.find((entry) => entry.id === "soft-fill")!;
    const withOutline = renderThemePreviewImage(
      {
        ...baseTheme,
        surface: { fillRole: "accent" },
        text: {
          title: "bg",
          body: "bg",
          value: "bg"
        },
        textOutline: {
          enabled: true,
          colorRole: "fg",
          thicknessPx: 1
        }
      },
      displayType,
      normalized.fontPresets,
      80,
      40
    );
    const offset = (12 * withOutline.width + 18) * 4;
    expect(Array.from(withOutline.rgba.slice(offset, offset + 3))).toEqual([17, 17, 17]);
  });

  it("keeps header glyph shapes stable when themes differ only by color", () => {
    const normalized = normalizeProject(LEGACY_PROJECT);
    const displayType = normalized.displayTypes![0]!;
    const fontPresets = normalized.fontPresets;
    const baseTheme = {
      id: "a",
      name: "A",
      border: { visible: false, colorRole: "fg" as const, mergeAdjacentBorders: true },
      surface: {},
      text: { title: "fg" as const, body: "fg" as const, value: "fg" as const },
      accentRole: "accent" as const,
      autoFitFontFamily: "px-sans",
      fontRoles: {
        tiny: { family: "px-sans", pixelSize: 8, weight: "regular" as const, slope: "roman" as const },
        normal: { family: "px-sans", pixelSize: 12, weight: "regular" as const, slope: "roman" as const },
        header: { family: "px-sans", pixelSize: 16, weight: "regular" as const, slope: "roman" as const }
      },
      borderTokens: {
        thin: { thicknessPx: 1, colorRole: "fg" as const },
        thick: { thicknessPx: 2, colorRole: "fg" as const }
      },
      textOutline: { enabled: false, colorRole: "bg" as const, thicknessPx: 1 }
    };
    const explicitRegular = renderThemePreviewImage(baseTheme, displayType, fontPresets, 140, 80);
    const implicitRegular = renderThemePreviewImage(
      {
        ...baseTheme,
        id: "b",
        name: "B",
        text: { title: "accent", body: "accent", value: "accent" },
        fontRoles: {
          ...baseTheme.fontRoles,
          header: { family: "px-sans", pixelSize: 16 }
        }
      },
      displayType,
      fontPresets,
      140,
      80
    );
    const bg = displayType.palette.bg.toLowerCase();
    const toMask = (rgba: Uint8ClampedArray) => {
      const mask: number[] = [];
      for (let index = 0; index < rgba.length; index += 4) {
        const hex = `#${rgba[index]!.toString(16).padStart(2, "0")}${rgba[index + 1]!.toString(16).padStart(2, "0")}${rgba[index + 2]!.toString(16).padStart(2, "0")}`;
        mask.push(hex.toLowerCase() === bg ? 0 : 1);
      }
      return mask;
    };
    const maskA = toMask(explicitRegular.rgba);
    const maskB = toMask(implicitRegular.rgba);
    expect(maskA).toEqual(maskB);
  });

  it("switches numeric-state theme on threshold and unavailable value", () => {
    const project = normalizeProject({
      ...LEGACY_PROJECT,
      screens: [
        {
          id: "numeric-screen",
          name: "Numeric",
          displayProfileId: "tri296x128-red",
          default: true,
          widgetThemeId: "minimal-no-border",
          baseWidgetIds: [],
          overlayIds: [],
          rules: []
        }
      ],
      overlays: [],
      widgets: [
        {
          id: "numeric",
          type: "numeric_state",
          screenId: "numeric-screen",
          frame: { x: 1, y: 1, w: 8, h: 4 },
          bindings: { entity: "sensor.office_temperature" },
          props: {
            digits: 1,
            placeholderValue: "88.8",
            unavailableThemeId: "soft-fill",
            numericThemeRules: [{ op: "gte", value: 20, themeId: "soft-fill" }]
          }
        }
      ],
      scenarios: []
    });
    const hot = renderLegacyProject(project, "tri296x128-red", LEGACY_DATA);
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    const hotInterior = [];
    for (let y = 1 * grid; y < 5 * grid; y += 1) {
      for (let x = 1 * grid; x < 9 * grid; x += 1) {
        hotInterior.push(hot.pixels[y * hot.width + x]);
      }
    }
    expect(hotInterior.some((pixel) => pixel === 2)).toBe(true);

    const unavailable = renderLegacyProject(
      project,
      "tri296x128-red",
      {
        ...LEGACY_DATA,
        entities: {}
      }
    );
    const unavailableInterior = [];
    for (let y = 1 * grid; y < 5 * grid; y += 1) {
      for (let x = 1 * grid; x < 9 * grid; x += 1) {
        unavailableInterior.push(unavailable.pixels[y * unavailable.width + x]);
      }
    }
    expect(unavailableInterior.some((pixel) => pixel === 2)).toBe(true);
  });

  it("clips fixed-size numeric-state text to widget bounds", () => {
    const project = normalizeProject({
      ...LEGACY_PROJECT,
      screens: [
        {
          id: "clip-screen",
          name: "Clip",
          displayProfileId: "tri296x128-red",
          default: true,
          widgetThemeId: "minimal-no-border",
          baseWidgetIds: [],
          overlayIds: [],
          rules: []
        }
      ],
      overlays: [],
      widgets: [
        {
          id: "numeric",
          type: "numeric_state",
          screenId: "clip-screen",
          frame: { x: 2, y: 2, w: 4, h: 4 },
          bindings: { entity: "sensor.office_temperature" },
          props: {
            digits: 1,
            valueSizingMode: "fixed",
            fixedPixelSize: 36,
            horizontalAlign: "center",
            verticalAlign: "middle"
          }
        }
      ],
      scenarios: []
    });
    const rendered = renderLegacyProject(project, "tri296x128-red", LEGACY_DATA);
    const frameX = 2 * DISPLAY_PROFILES[0].gridUnitPx;
    const frameY = 2 * DISPLAY_PROFILES[0].gridUnitPx;
    const frameW = 4 * DISPLAY_PROFILES[0].gridUnitPx;
    const frameH = 4 * DISPLAY_PROFILES[0].gridUnitPx;
    for (let y = 0; y < rendered.height; y += 1) {
      for (let x = 0; x < rendered.width; x += 1) {
        const inside = x >= frameX && x < frameX + frameW && y >= frameY && y < frameY + frameH;
        if (!inside) {
          expect(rendered.pixels[y * rendered.width + x]).toBe(0);
        }
      }
    }
  });

  it("renders primitive widgets", () => {
    const project = normalizeProject({
      ...LEGACY_PROJECT,
      screens: [
        {
          id: "primitive-screen",
          name: "Primitive",
          displayProfileId: "tri296x128-red",
          default: true,
          widgetThemeId: "classic-outline",
          baseWidgetIds: [],
          overlayIds: [],
          rules: []
        }
      ],
      overlays: [],
      widgets: [
        {
          id: "text",
          type: "static_text",
          screenId: "primitive-screen",
          frame: { x: 0, y: 0, w: 8, h: 4 },
          bindings: {},
          props: { text: "Hello", border: false }
        },
        {
          id: "box",
          type: "box",
          screenId: "primitive-screen",
          frame: { x: 9, y: 0, w: 6, h: 4 },
          bindings: {},
          props: { border: true }
        },
        {
          id: "line",
          type: "line",
          screenId: "primitive-screen",
          frame: { x: 0, y: 5, w: 8, h: 2 },
          bindings: {},
          props: { lineDirection: "horizontal", border: false }
        },
        {
          id: "circle",
          type: "circle",
          screenId: "primitive-screen",
          frame: { x: 9, y: 5, w: 4, h: 4 },
          bindings: {},
          props: { filled: false, border: false }
        }
      ],
      scenarios: []
    });
    const rendered = renderLegacyProject(project, "tri296x128-red", LEGACY_DATA);
    const width = rendered.width;
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    expect(rendered.pixels[0 * width + 9 * grid]).toBe(1);
    expect(rendered.pixels[(6 * grid) * width + 2 * grid]).toBe(1);
    const circleCenter = rendered.pixels[(7 * grid) * width + 11 * grid];
    expect(circleCenter).toBe(0);
  });
});
