import { DEFAULT_WIDGET_THEMES } from "./themes.js";
import { DEFAULT_FONT_PRESETS } from "./font-presets.js";
import { BUILT_IN_WIDGET_DEFINITIONS, defaultDisplayTypes, defaultVirtualDevices } from "./designer-defaults.js";
import type { DeviceAssignment, LayoutDefinition, ManagedDisplay, Project, RenderData } from "./types.js";

const SAMPLE_DISPLAY_TYPES = defaultDisplayTypes();

const SAMPLE_DEVICES: ManagedDisplay[] = defaultVirtualDevices(SAMPLE_DISPLAY_TYPES).map((device) => ({
  ...device,
  displayProviderInstanceId: "virtual-default",
  providerDeviceRef: device.providerRef
}));

function makeRootNode(title: string) {
  return {
    id: `root-${title.toLowerCase().replace(/\s+/g, "-")}`,
    type: "stack" as const,
    axis: "vertical" as const,
    width: { mode: "fill" as const },
    height: { mode: "fill" as const },
    style: { gapPx: 0, borderToken: "none" as const },
    children: [
      {
        id: `header-${title.toLowerCase().replace(/\s+/g, "-")}`,
        type: "primitive_instance" as const,
        primitiveType: "text" as const,
        width: { mode: "fill" as const },
        height: { mode: "fit_content" as const },
        props: {
          text: title,
          fontRole: "header" as const,
          horizontalAlign: "left" as const
        },
        style: { borderToken: "none" as const }
      },
      {
        id: `temperature-${title.toLowerCase().replace(/\s+/g, "-")}`,
        type: "primitive_instance" as const,
        primitiveType: "number" as const,
        bindings: { entity: "sensor.office_temperature" },
        width: { mode: "fill" as const },
        height: { mode: "fill" as const },
        props: {
          autoFit: true,
          digits: 1,
          suffix: "C",
          placeholderValue: "21.3",
          horizontalAlign: "center" as const,
          verticalAlign: "middle" as const
        },
        style: { borderToken: "none" as const }
      },
      {
        id: `status-${title.toLowerCase().replace(/\s+/g, "-")}`,
        type: "primitive_instance" as const,
        primitiveType: "text" as const,
        width: { mode: "fill" as const },
        height: { mode: "fit_content" as const },
        props: {
          text: "Starter layout",
          fontRole: "normal" as const,
          horizontalAlign: "center" as const
        },
        style: { borderToken: "none" as const }
      }
    ]
  };
}

const SAMPLE_LAYOUT_DEFINITIONS: LayoutDefinition[] = [
  {
    id: "layout-home-296-red",
    name: "Home 296 Red",
    kind: "fullscreen",
    displayTypeId: "tri296x128-red",
    rootNode: makeRootNode("Home")
  },
  {
    id: "layout-home-296-yellow",
    name: "Home 296 Yellow",
    kind: "fullscreen",
    displayTypeId: "tri296x128-yellow",
    rootNode: makeRootNode("Home")
  },
  {
    id: "layout-home-400-red",
    name: "Home 400 Red",
    kind: "fullscreen",
    displayTypeId: "tri400x300-red",
    rootNode: makeRootNode("Overview")
  },
  {
    id: "layout-home-400-yellow",
    name: "Home 400 Yellow",
    kind: "fullscreen",
    displayTypeId: "tri400x300-yellow",
    rootNode: makeRootNode("Overview")
  }
];

const SAMPLE_ASSIGNMENTS: DeviceAssignment[] = SAMPLE_DEVICES.map((device) => ({
  id: `assignment-${device.id}`,
  displayId: device.id,
  defaultThemeId: "classic-outline",
  defaultFullscreenLayoutId:
    device.displayTypeId === "tri296x128-red" ? "layout-home-296-red"
      : device.displayTypeId === "tri296x128-yellow" ? "layout-home-296-yellow"
        : device.displayTypeId === "tri400x300-red" ? "layout-home-400-red"
          : "layout-home-400-yellow",
  fullscreenRules: [],
  popupRules: [],
  schedule: {
    enabled: false,
    intervalMinutes: 15
  }
}));

export const SAMPLE_PROJECT: Project = {
  id: "demo-home",
  name: "InkFrame Studio",
  version: 1,
  locale: "en-US",
  fontPresets: DEFAULT_FONT_PRESETS,
  themes: DEFAULT_WIDGET_THEMES,
  displayTypes: SAMPLE_DISPLAY_TYPES,
  devices: SAMPLE_DEVICES,
  widgetDefinitions: BUILT_IN_WIDGET_DEFINITIONS,
  layoutDefinitions: SAMPLE_LAYOUT_DEFINITIONS,
  deviceAssignments: SAMPLE_ASSIGNMENTS,
  screens: [],
  overlays: [],
  widgets: [],
  scenarios: []
};

export const SAMPLE_DATA: RenderData = {
  now: "2026-04-17T14:32:00.000Z",
  entities: {
    "cover.garage_door": {
      entityId: "cover.garage_door",
      state: "closed",
      attributes: {},
      lastChanged: "2026-04-17T14:20:00.000Z"
    },
    "sensor.office_temperature": {
      entityId: "sensor.office_temperature",
      state: "21.2",
      attributes: { unit_of_measurement: "C", value: 21.2 },
      lastChanged: "2026-04-17T14:30:00.000Z"
    }
  },
  queries: {}
};
