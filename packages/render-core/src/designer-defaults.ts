import { DISPLAY_PROFILES } from "./display-profiles.js";
import { DEFAULT_WIDGET_THEMES } from "./themes.js";
import type {
  DisplayType,
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
