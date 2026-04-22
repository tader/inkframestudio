import { BUILT_IN_WIDGET_DEFINITIONS, defaultDisplayTypes, defaultVirtualDevices, migrateLegacyAssignments, migrateLegacyLayouts } from "./designer-defaults.js";
import { DEFAULT_FONT_PRESETS, normalizeFontPresets } from "./font-presets.js";
import type { Project, Screen, ThemeRef, WidgetInstance, WidgetTheme, WidgetThemeId } from "./types.js";

export const DEFAULT_WIDGET_THEME_ID = "classic-outline";

export const DEFAULT_WIDGET_THEMES: WidgetTheme[] = [
  {
    id: "classic-outline",
    name: "Classic Outline",
    border: {
      visible: true,
      colorRole: "fg",
      mergeAdjacentBorders: true
    },
    surface: {},
    text: {
      title: "fg",
      body: "fg",
      value: "fg"
    },
    accentRole: "accent",
    autoFitFontFamily: "px-sans",
    fontRoles: {},
    borderTokens: {
      thin: { thicknessPx: 1, colorRole: "fg" },
      thick: { thicknessPx: 2, colorRole: "fg" }
    },
    textOutline: {
      enabled: false,
      colorRole: "bg",
      thicknessPx: 1
    }
  },
  {
    id: "soft-fill",
    name: "Soft Fill",
    border: {
      visible: true,
      colorRole: "fg",
      mergeAdjacentBorders: true
    },
    surface: {
      fillRole: "accent"
    },
    text: {
      title: "bg",
      body: "bg",
      value: "bg"
    },
    accentRole: "fg",
    autoFitFontFamily: "px-sans",
    fontRoles: {},
    borderTokens: {
      thin: { thicknessPx: 1, colorRole: "fg" },
      thick: { thicknessPx: 2, colorRole: "fg" }
    },
    textOutline: {
      enabled: false,
      colorRole: "bg",
      thicknessPx: 1
    }
  },
  {
    id: "accent-header",
    name: "Accent Header",
    border: {
      visible: true,
      colorRole: "accent",
      mergeAdjacentBorders: true
    },
    surface: {},
    text: {
      title: "accent",
      body: "fg",
      value: "fg"
    },
    accentRole: "accent",
    autoFitFontFamily: "px-sans",
    fontRoles: {},
    borderTokens: {
      thin: { thicknessPx: 1, colorRole: "accent" },
      thick: { thicknessPx: 2, colorRole: "accent" }
    },
    textOutline: {
      enabled: false,
      colorRole: "bg",
      thicknessPx: 1
    }
  },
  {
    id: "minimal-no-border",
    name: "Minimal No Border",
    border: {
      visible: false,
      colorRole: "fg",
      mergeAdjacentBorders: false
    },
    surface: {},
    text: {
      title: "fg",
      body: "fg",
      value: "fg"
    },
    accentRole: "accent",
    autoFitFontFamily: "px-sans",
    fontRoles: {},
    borderTokens: {
      thin: { thicknessPx: 1, colorRole: "fg" },
      thick: { thicknessPx: 2, colorRole: "fg" }
    },
    textOutline: {
      enabled: false,
      colorRole: "bg",
      thicknessPx: 1
    }
  }
];

export function normalizeProject(project: Project): Project {
  const themes = (project.themes?.length ? project.themes : DEFAULT_WIDGET_THEMES).map((theme) => ({
    ...theme,
    autoFitFontFamily: theme.autoFitFontFamily ?? "px-sans"
  }));
  const displayTypes = project.displayTypes?.length ? project.displayTypes : defaultDisplayTypes();
  const devices = project.devices?.length ? project.devices : defaultVirtualDevices(displayTypes);
  const layoutDefinitions = project.layoutDefinitions?.length ? project.layoutDefinitions : migrateLegacyLayouts(project);
  const widgetDefinitions = project.widgetDefinitions?.length
    ? project.widgetDefinitions
    : BUILT_IN_WIDGET_DEFINITIONS;
  const deviceAssignments = project.deviceAssignments?.length
    ? project.deviceAssignments
    : migrateLegacyAssignments(project, devices, layoutDefinitions);
  return {
    ...project,
    fontPresets: normalizeFontPresets(project.fontPresets ?? DEFAULT_FONT_PRESETS),
    themes,
    displayTypes,
    devices,
    widgetDefinitions,
    layoutDefinitions,
    deviceAssignments,
    screens: project.screens.map((screen) => ({
      ...screen,
      widgetThemeId: screen.widgetThemeId ?? DEFAULT_WIDGET_THEME_ID
    }))
  };
}

export function getWidgetTheme(
  project: Project,
  screen: Screen,
  widget?: WidgetInstance
): WidgetTheme {
  const themeId =
    widget?.props.themeId && widget.props.themeId !== "inherit"
      ? widget.props.themeId
      : screen.widgetThemeId ?? DEFAULT_WIDGET_THEME_ID;
  return (
    project.themes.find((theme) => theme.id === themeId) ??
    DEFAULT_WIDGET_THEMES.find((theme) => theme.id === themeId) ??
    DEFAULT_WIDGET_THEMES[0]
  );
}

export function getThemeByRef(
  project: Project,
  screen: Screen,
  themeRef?: ThemeRef
): WidgetTheme {
  const themeId =
    themeRef && themeRef !== "inherit"
      ? themeRef
      : screen.widgetThemeId ?? DEFAULT_WIDGET_THEME_ID;
  return (
    project.themes.find((theme) => theme.id === themeId) ??
    DEFAULT_WIDGET_THEMES.find((theme) => theme.id === themeId) ??
    DEFAULT_WIDGET_THEMES[0]
  );
}

export function widgetThemeOptions(project: Project): WidgetTheme[] {
  const byId = new Map<WidgetThemeId, WidgetTheme>();
  for (const theme of DEFAULT_WIDGET_THEMES) {
    byId.set(theme.id, theme);
  }
  for (const theme of project.themes ?? []) {
    byId.set(theme.id, theme);
  }
  return [...byId.values()];
}
