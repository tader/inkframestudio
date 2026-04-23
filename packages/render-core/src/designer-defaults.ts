import { DISPLAY_PROFILES } from "./display-profiles.js";
import { DEFAULT_WIDGET_THEMES } from "./themes.js";
import type {
  DeviceAssignment,
  DisplayType,
  LayoutDefinition,
  ManagedDisplay,
  PrimitiveWidgetKind,
  Project,
  WidgetDefinition
} from "./types.js";

export const BUILT_IN_PRIMITIVE_KINDS: PrimitiveWidgetKind[] = [
  "text",
  "number",
  "icon",
  "graph",
  "line",
  "box",
  "circle",
  "date_time_compact",
  "agenda_list",
  "state_tile",
  "alert_banner",
  "status_strip",
  "history_bars"
];

export const BUILT_IN_WIDGET_DEFINITIONS: WidgetDefinition[] = BUILT_IN_PRIMITIVE_KINDS.map((kind) => ({
  id: `builtin-${kind}`,
  name: kind.replace(/_/g, " "),
  kind: "primitive",
  primitiveType: kind,
  inputSchema: []
}));

export function defaultDisplayTypes(): DisplayType[] {
  return DISPLAY_PROFILES.map((profile) => ({
    id: profile.id,
    name: profile.id,
    width: profile.width,
    height: profile.height,
    palette: profile.palette,
    rotation: profile.rotation,
    contentPadding: { ...profile.contentPadding },
    gridUnitPx: profile.gridUnitPx
  }));
}

export function defaultVirtualDevices(displayTypes: DisplayType[]): ManagedDisplay[] {
  return displayTypes.map((displayType) => ({
    id: `virtual-${displayType.id}`,
    name: `Virtual ${displayType.name}`,
    providerKind: "virtual",
    providerRef: displayType.id,
    displayTypeId: displayType.id,
    managed: true,
    virtual: true,
    metadata: {
      width: displayType.width,
      height: displayType.height
    }
  }));
}

export function migrateLegacyLayouts(project: Project): LayoutDefinition[] {
  const layouts: LayoutDefinition[] = [];
  for (const screen of project.screens ?? []) {
    layouts.push({
      id: `layout-${screen.id}`,
      name: screen.name,
      kind: "fullscreen",
      displayTypeId: screen.displayProfileId,
      legacyScreenId: screen.id
    });
  }
  for (const overlay of project.overlays ?? []) {
    const screen = (project.screens ?? []).find((entry) => entry.id === overlay.screenId);
    layouts.push({
      id: `layout-${overlay.id}`,
      name: overlay.name,
      kind: "popup",
      displayTypeId: screen?.displayProfileId ?? project.displayTypes?.[0]?.id ?? "tri296x128-red",
      legacyOverlayId: overlay.id,
      popupDefaults: {
        widthPx: overlay.frame.w * 8,
        heightPx: overlay.frame.h * 8
      }
    });
  }
  return layouts;
}

export function migrateLegacyAssignments(project: Project, devices: ManagedDisplay[], layouts: LayoutDefinition[]): DeviceAssignment[] {
  return devices.map((device) => {
    const defaultLegacyScreen = (project.screens ?? []).find(
      (screen) => screen.displayProfileId === device.displayTypeId && screen.default
    );
    const defaultLayout = defaultLegacyScreen
      ? layouts.find((layout) => layout.legacyScreenId === defaultLegacyScreen.id)
      : layouts.find((layout) => layout.kind === "fullscreen" && layout.displayTypeId === device.displayTypeId);
    const fullscreenRules = (project.screens ?? [])
      .filter((screen) => screen.displayProfileId === device.displayTypeId)
      .flatMap((screen) =>
        screen.rules
          .filter((rule) => rule.scope === "screen_activation" && rule.action.type === "activate_screen")
          .map((rule) => ({
            ...rule,
            scope: "fullscreen_activation" as const,
            action: {
              type: "activate_fullscreen_layout" as const,
              layoutId: `layout-${(rule.action as { type: "activate_screen"; screenId: string }).screenId}`
            }
          }))
      );
    const popupRules = (project.screens ?? [])
      .filter((screen) => screen.displayProfileId === device.displayTypeId)
      .flatMap((screen) =>
        screen.rules
          .filter((rule) => rule.scope === "overlay_activation" && rule.action.type === "activate_overlay")
          .map((rule) => ({
            ...rule,
            scope: "popup_activation" as const,
            action: {
              type: "activate_popup_layout" as const,
              layoutId: `layout-${(rule.action as { type: "activate_overlay"; overlayId: string }).overlayId}`
            }
          }))
      );
    return {
      id: `assignment-${device.id}`,
      displayId: device.id,
      defaultFullscreenLayoutId: defaultLayout?.id,
      defaultThemeId: DEFAULT_WIDGET_THEMES[0]?.id,
      fullscreenRules,
      popupRules
    };
  });
}
