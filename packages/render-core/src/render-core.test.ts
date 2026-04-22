import { describe, expect, it } from "vitest";
import {
  DISPLAY_PROFILES,
  SAMPLE_DATA,
  SAMPLE_PROJECT,
  renderThemePreviewImage,
  renderFontSpecimenSheets,
  renderProject,
  resolveProjectState
} from "./index.js";
import { normalizeProject } from "./themes.js";

describe("render-core", () => {
  it("renders a stable golden hash for 296 default screen", () => {
    const rendered = renderProject(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA);
    expect(rendered.width).toBe(296);
    expect(rendered.height).toBe(128);
    expect(rendered.hash).toBe("deef777aac80a7ac79487f8aec0464d3f5e5c98823782294f362485011c64ab3");
  });

  it("renders a stable golden hash for 400 default screen", () => {
    const rendered = renderProject(SAMPLE_PROJECT, "tri400x300-red", SAMPLE_DATA);
    expect(rendered.width).toBe(400);
    expect(rendered.height).toBe(300);
    expect(rendered.hash).toBe("1d0ef6f00f42772994cae68c664cd1a06d9950f3273fd99071e3457ec74867ed");
  });

  it("keeps palette-indexed pixels identical across accent profiles", () => {
    const red = renderProject(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA);
    const yellow = renderProject(
      {
        ...SAMPLE_PROJECT,
        screens: SAMPLE_PROJECT.screens.map((screen) => ({
          ...screen,
          displayProfileId: screen.displayProfileId.replace("-red", "-yellow")
        }))
      },
      "tri296x128-yellow",
      SAMPLE_DATA
    );
    expect(Array.from(red.pixels)).toEqual(Array.from(yellow.pixels));
    expect(red.rgba).not.toEqual(yellow.rgba);
  });

  it("chooses the empty calendar fallback screen", () => {
    const resolved = resolveProjectState(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA, "empty-calendar-demo");
    expect(resolved.activeScreen.id).toBe("calendar-empty-296");
  });

  it("activates the garage overlay after 15 minutes", () => {
    const resolved = resolveProjectState(SAMPLE_PROJECT, "tri296x128-red", SAMPLE_DATA, "garage-warning-demo");
    expect(resolved.activeOverlay?.id).toBe("garage-warning-overlay");
  });

  it("uses the highest-priority matching rule", () => {
    const project = {
      ...SAMPLE_PROJECT,
      screens: SAMPLE_PROJECT.screens.map((screen) =>
        screen.id === "calendar-empty-296"
          ? {
              ...screen,
              rules: [
                ...screen.rules,
                {
                  id: "lower-priority",
                  scope: "screen_activation" as const,
                  priority: 10,
                  condition: { kind: "query_empty" as const, queryId: "agenda-today" },
                  action: { type: "activate_screen" as const, screenId: "calendar-main-296" }
                }
              ]
            }
          : screen
      )
    };
    const resolved = resolveProjectState(project, "tri296x128-red", SAMPLE_DATA, "empty-calendar-demo");
    expect(resolved.activeScreen.id).toBe("calendar-empty-296");
  });

  it("supports display profile lookup", () => {
    expect(DISPLAY_PROFILES).toHaveLength(4);
  });

  it("merges adjacent widget borders into a single divider", () => {
    const project = normalizeProject({
      ...SAMPLE_PROJECT,
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
    const rendered = renderProject(project, "tri296x128-red", SAMPLE_DATA);
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
      ...SAMPLE_PROJECT,
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
    const rendered = renderProject(project, "tri296x128-red", SAMPLE_DATA);
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    const inheritedBorderPixel = rendered.pixels[0 * rendered.width + 0];
    const overrideInteriorPixel = rendered.pixels[(2 * grid) * rendered.width + (6 * grid + 2)];
    expect(inheritedBorderPixel).toBe(0);
    expect(overrideInteriorPixel).toBe(2);
  });

  it("normalizes legacy projects with default themes", () => {
    const legacy = {
      ...SAMPLE_PROJECT,
      themes: [] as typeof SAMPLE_PROJECT.themes,
      screens: SAMPLE_PROJECT.screens.map((screen) => {
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
      ...SAMPLE_PROJECT,
      fontPresets: {
        tiny: 6,
        normal: 10,
        header: 14
      }
    });
    const rendered = renderProject(compact, "tri296x128-red", SAMPLE_DATA);
    expect(rendered.hash).not.toBe("fff63df1e7cce9c0ed78dc556a1f81bba76eb2401eef85dcc94cb892e905bb63");
  });

  it("renders font specimen sheets for available family variants", () => {
    const families = renderFontSpecimenSheets(DISPLAY_PROFILES[0], SAMPLE_PROJECT, "Ag 09:45", 4, 6);
    expect(families.length).toBeGreaterThanOrEqual(1);
    expect(families[0]?.variants[0]?.tiles.map((tile) => tile.size)).toEqual([4, 5, 6]);
    expect(families.every((family) => family.variants.every((variant) => variant.tiles.every((tile) => tile.height > 0)))).toBe(true);
    expect(families.every((family) => family.variants.every((variant) => variant.slope === "roman" || variant.slope === "italic"))).toBe(true);
  });

  it("renders text outline in theme preview when enabled", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
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
    const normalized = normalizeProject(SAMPLE_PROJECT);
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
    expect(Array.from(withOutline.rgba.slice(offset, offset + 3))).toEqual([215, 38, 27]);
  });

  it("keeps header glyph shapes stable when themes differ only by color", () => {
    const normalized = normalizeProject(SAMPLE_PROJECT);
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
      ...SAMPLE_PROJECT,
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
    const hot = renderProject(project, "tri296x128-red", SAMPLE_DATA);
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    const hotInterior = [];
    for (let y = 1 * grid; y < 5 * grid; y += 1) {
      for (let x = 1 * grid; x < 9 * grid; x += 1) {
        hotInterior.push(hot.pixels[y * hot.width + x]);
      }
    }
    expect(hotInterior.some((pixel) => pixel === 2)).toBe(true);

    const unavailable = renderProject(
      project,
      "tri296x128-red",
      {
        ...SAMPLE_DATA,
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
      ...SAMPLE_PROJECT,
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
    const rendered = renderProject(project, "tri296x128-red", SAMPLE_DATA);
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
      ...SAMPLE_PROJECT,
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
    const rendered = renderProject(project, "tri296x128-red", SAMPLE_DATA);
    const width = rendered.width;
    const grid = DISPLAY_PROFILES[0].gridUnitPx;
    expect(rendered.pixels[0 * width + 9 * grid]).toBe(1);
    expect(rendered.pixels[(6 * grid) * width + 2 * grid]).toBe(1);
    const circleCenter = rendered.pixels[(7 * grid) * width + 11 * grid];
    expect(circleCenter).toBe(0);
  });
});
