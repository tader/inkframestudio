import { BUILT_IN_WIDGET_DEFINITIONS, defaultDisplayTypes, defaultVirtualDevices, migrateLegacyAssignments, migrateLegacyLayouts } from "./designer-defaults.js";
import { DEFAULT_FONT_PRESETS, normalizeFontPresets } from "./font-presets.js";
import type { DeviceAssignment, DisplayType, EdgeInsets, LayoutDefinition, LayoutNode, ManagedDisplay, Project, Screen, ThemeRef, WidgetInstance, WidgetTheme, WidgetThemeId } from "./types.js";

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

function normalizeLegacyOffsetDays(node: LayoutNode & { offsetHours?: unknown }): number {
  if (typeof (node as { offsetDays?: unknown }).offsetDays === "number" && Number.isFinite((node as { offsetDays?: number }).offsetDays)) {
    return Number((node as { offsetDays?: number }).offsetDays);
  }
  if (typeof node.offsetHours === "number" && Number.isFinite(node.offsetHours)) {
    if (node.offsetHours === 0) {
      return 0;
    }
    return node.offsetHours > 0 ? Math.ceil(node.offsetHours / 24) : Math.floor(node.offsetHours / 24);
  }
  return 0;
}

function normalizeLayoutNode(node: LayoutNode | undefined): LayoutNode | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children.map((child) => normalizeLayoutNode(child) ?? child)
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children.map((child) => ({
        ...child,
        node: normalizeLayoutNode(child.node) ?? child.node
      }))
    };
  }
  if (node.type === "data_query") {
    const current = node as LayoutNode & { offsetHours?: unknown };
    return {
      ...node,
      dateVariableName: node.dateVariableName ?? "date",
      offsetDays: normalizeLegacyOffsetDays(current),
      rolloverTime: typeof node.rolloverTime === "string" && node.rolloverTime.trim() ? node.rolloverTime : undefined,
      child: normalizeLayoutNode(node.child)
    };
  }
  if (node.type === "foreach" || node.type === "filter" || node.type === "unique") {
    return {
      ...node,
      child: normalizeLayoutNode(node.child)
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: normalizeLayoutNode(node.thenChild),
      elseChild: normalizeLayoutNode(node.elseChild)
    };
  }
  if (node.type === "primitive_instance" && node.primitiveType === "text" && node.props && Number(node.props.lineSpacingPx ?? 0) === 0) {
    const { lineSpacingPx: _lineSpacingPx, ...props } = node.props;
    return {
      ...node,
      props
    };
  }
  return node;
}

function normalizeAssignmentSchedule(schedule: DeviceAssignment["schedule"] | undefined): NonNullable<DeviceAssignment["schedule"]> {
  return {
    enabled: Boolean(schedule?.enabled),
    intervalMinutes: Math.max(1, Math.trunc(Number(schedule?.intervalMinutes ?? 15) || 15))
  };
}

function normalizeContentPadding(
  padding: Partial<EdgeInsets> | undefined,
  legacySafeMarginPx?: unknown
): EdgeInsets {
  const fallback = Number.isFinite(Number(legacySafeMarginPx)) ? Math.max(0, Math.trunc(Number(legacySafeMarginPx))) : 0;
  return {
    top: Math.max(0, Math.trunc(Number(padding?.top ?? fallback) || 0)),
    right: Math.max(0, Math.trunc(Number(padding?.right ?? fallback) || 0)),
    bottom: Math.max(0, Math.trunc(Number(padding?.bottom ?? fallback) || 0)),
    left: Math.max(0, Math.trunc(Number(padding?.left ?? fallback) || 0))
  };
}

function normalizeDisplayType(displayType: DisplayType & { safeMarginPx?: unknown }): DisplayType {
  return {
    ...displayType,
    contentPadding: normalizeContentPadding(displayType.contentPadding, displayType.safeMarginPx)
  };
}

function defaultFullscreenLayoutIdForDisplay(layouts: LayoutDefinition[], display: ManagedDisplay, preferredId?: string): string | undefined {
  if (preferredId && layouts.some((entry) => entry.id === preferredId)) {
    return preferredId;
  }
  return (
    layouts.find((entry) => entry.kind === "fullscreen" && entry.displayTypeId === display.displayTypeId)?.id ??
    layouts.find((entry) => entry.kind === "fullscreen")?.id
  );
}

function normalizeDeviceAssignments(
  project: Project,
  devices: ManagedDisplay[],
  layouts: LayoutDefinition[]
): DeviceAssignment[] {
  const existing = new Map((project.deviceAssignments ?? []).map((assignment) => [assignment.displayId, assignment]));
  return devices.map((display) => {
    const assignment = existing.get(display.id);
    return {
      id: assignment?.id ?? `assignment-${display.id}`,
      displayId: display.id,
      defaultFullscreenLayoutId: defaultFullscreenLayoutIdForDisplay(layouts, display, assignment?.defaultFullscreenLayoutId),
      defaultThemeId: assignment?.defaultThemeId ?? DEFAULT_WIDGET_THEME_ID,
      schedule: normalizeAssignmentSchedule(assignment?.schedule),
      fullscreenRules: assignment?.fullscreenRules ?? [],
      popupRules: assignment?.popupRules ?? []
    };
  });
}

export function normalizeProject(project: Project): Project {
  const themes = (project.themes?.length ? project.themes : DEFAULT_WIDGET_THEMES).map((theme) => ({
    ...theme,
    autoFitFontFamily: theme.autoFitFontFamily ?? "px-sans"
  }));
  const displayTypes = (project.displayTypes?.length ? project.displayTypes : defaultDisplayTypes())
    .map((displayType) => normalizeDisplayType(displayType as DisplayType & { safeMarginPx?: unknown }));
  const devices = project.devices?.length ? project.devices : defaultVirtualDevices(displayTypes);
  const layoutDefinitions = (project.layoutDefinitions?.length ? project.layoutDefinitions : migrateLegacyLayouts(project))
    .map((layout) => ({
      ...layout,
      rootNode: normalizeLayoutNode(layout.rootNode)
    }));
  const widgetDefinitions = project.widgetDefinitions?.length
    ? project.widgetDefinitions
    : BUILT_IN_WIDGET_DEFINITIONS;
  const deviceAssignments = project.deviceAssignments?.length
    ? normalizeDeviceAssignments(project, devices, layoutDefinitions)
    : migrateLegacyAssignments(project, devices, layoutDefinitions);
  return {
    ...project,
    locale: project.locale?.trim() || "en-US",
    fontPresets: normalizeFontPresets(project.fontPresets ?? DEFAULT_FONT_PRESETS),
    themes,
    displayTypes,
    devices,
    widgetDefinitions: widgetDefinitions.map((definition) => definition.kind === "compound"
      ? { ...definition, rootNode: normalizeLayoutNode(definition.rootNode) }
      : definition),
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
