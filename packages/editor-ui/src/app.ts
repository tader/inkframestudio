import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { BUILT_IN_WIDGET_DEFINITIONS, DEFAULT_FONT_PRESETS, DISPLAY_PROFILES, normalizeProject, supportsFontVariant, type BorderToken, type CompoundInputDefinition, type Condition, type DeviceAssignment, type DiscoveredDisplayCandidate, type DisplayType, type FillRole, type FontOption, type FontRole, type FontSlope, type FontVariantKey, type IconDefinition, type LayoutDefinition, type LayoutInspectionNode, type LayoutNode, type ManagedDisplay, type PrimitiveInstanceNode, type PrimitiveWidgetKind, type Project, type ProviderConnectionStatus, type ProviderDescriptor, type ProviderInstance, type Rule, type SizeSpec, type TextStyle, type WidgetDefinition, type WidgetTheme } from "../../render-core/src/index.js";
import {
  deleteProviderInstance,
  deleteFont,
  fetchProviderKinds,
  fetchProviderInstances,
  fetchAssignmentSchedules,
  fetchBackupArchive,
  fetchDisplayUpdateLog,
  fetchDevicePreview,
  fetchDiscoveredDisplays,
  fetchFontSpecimens,
  fetchFonts,
  fetchIcons,
  fetchLayoutPreview,
  fetchProject,
  fetchProjects,
  fetchProviderEntities,
  fetchScheduleUpdateLogSettings,
  fetchThemePreview,
  importFont,
  rescanFonts,
  saveProviderInstance,
  saveProject,
  saveScheduleUpdateLogSettings,
  restoreBackupArchive,
  testProviderInstance,
  uploadPreviewToOpenEpaperLinkAccessPoint,
  updateFontMetadata,
  forceAssignmentUpdate,
  type AssignmentForceUpdateResponse,
  type AssignmentScheduleStatusResponse,
  type AssignmentUpdateLogEntry,
  type BackupArchive,
  type FontSpecimenResponse,
  type PreviewResponse,
  type ScheduleUpdateLogSettings
} from "./api.js";
import "./code-editor-field.js";
import {
  buildStructurePreviewTree,
  STRUCTURE_PREVIEW_BOTTOM_PADDING,
  STRUCTURE_PREVIEW_SIDE_PADDING,
  STRUCTURE_PREVIEW_TOP_PADDING,
  deriveStructureDropIntent,
  findInspectionNodeAtPoint,
  translateStructurePreviewTree,
  type StructureDropIntent
} from "./structure-preview-model.js";
import { buildNodeTree, getNodeById, isContainerNode, isDescendant, moveNode, moveNodeAfter, moveNodeBefore, moveNodeToGridCell, removeNode } from "./tree-model.js";

type PageId = "displays" | "widgets" | "layouts" | "themes" | "config";
type ConfigSectionId = "project" | "sources" | "display-systems" | "scripting" | "fonts";
type VirtualDisplayDefinition = {
  id: string;
  name: string;
  displayTypeId: string;
};

const PAGE_ORDER: PageId[] = ["displays", "widgets", "layouts", "themes", "config"];
const PAGE_LABELS: Record<PageId, string> = {
  displays: "Displays",
  widgets: "Widgets",
  layouts: "Layouts",
  themes: "Themes",
  config: "Config"
};
const CONFIG_SECTIONS: Array<{ id: ConfigSectionId; label: string }> = [
  { id: "project", label: "Project" },
  { id: "sources", label: "Sources" },
  { id: "display-systems", label: "Display Systems" },
  { id: "scripting", label: "Scripting" },
  { id: "fonts", label: "Fonts" }
];

type FontSpecimenFamilyView = FontSpecimenResponse["families"][number] & {
  variants: Array<
    FontSpecimenResponse["families"][number]["variants"][number] & {
      tiles: Array<
        FontSpecimenResponse["families"][number]["variants"][number]["tiles"][number]
      >;
    }
  >;
};

type NodeCreateKind =
  | PrimitiveWidgetKind
  | "stack"
  | "grid"
  | "zstack"
  | "compound_ref"
  | "data_query"
  | "filter"
  | "unique"
  | "foreach"
  | "script"
  | "if_else";

function routeToPage(hash: string): PageId {
  const value = hash.replace(/^#\/?/, "");
  if (value === "display-types") {
    return "config";
  }
  if (value === "assignments") {
    return "displays";
  }
  return PAGE_ORDER.includes(value as PageId) ? (value as PageId) : "displays";
}

function pageToRoute(page: PageId): string {
  return `#/${page}`;
}

function nextId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function cloneProject(project: Project): Project {
  return normalizeProject(structuredClone(project));
}

function emptyProject(): Project {
  return normalizeProject({
    id: "",
    name: "",
    version: 0,
    locale: "en-US",
    fontPresets: DEFAULT_FONT_PRESETS,
    themes: [defaultTheme()],
    displayTypes: [],
    devices: [],
    widgetDefinitions: [],
    layoutDefinitions: [],
    deviceAssignments: [],
    screens: [],
    overlays: [],
    widgets: [],
    scenarios: []
  });
}

function defaultSizeSpec(mode: SizeSpec["mode"] = "fill", value?: number): SizeSpec {
  return { mode, value };
}

function defaultPrimitiveNode(kind: PrimitiveWidgetKind): PrimitiveInstanceNode {
  return {
    id: nextId("node"),
    type: "primitive_instance",
    primitiveType: kind,
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 4, borderToken: "none" },
    bindings: kind === "graph" ? { query: "" } : kind === "text" || kind === "number" ? { entity: "" } : {},
    props:
      kind === "text"
        ? { text: "Text", autoFit: true, placeholderText: "Placeholder", horizontalAlign: "left", verticalAlign: "top", overflow: "wrap", renderEntityState: false, paddingPx: 4 }
        : kind === "number"
          ? { digits: 1, autoFit: true, placeholderValue: "88.8", horizontalAlign: "center", verticalAlign: "middle", paddingPx: 4 }
          : kind === "icon"
            ? { icon: DEFAULT_ICON_ID }
            : kind === "line"
              ? { lineDirection: "horizontal" }
              : kind === "circle"
                ? { filled: false }
                : {}
  };
}

const DEFAULT_ICON_ID = "fa-solid:triangle-exclamation";

function defaultCompoundRefNode(definitionId = ""): LayoutNode {
  return {
    id: nextId("node"),
    type: "compound_ref",
    definitionId,
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, borderToken: "none" },
    inputBindings: {},
    inputValues: {}
  };
}

function defaultDataQueryNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "data_query",
    queryKind: "calendar_events",
    variableName: "events",
    dateVariableName: "date",
    calendarEntityIds: [],
    offsetDays: 0,
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultForEachNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "foreach",
    itemsRef: "events",
    itemAlias: "event",
    indexAlias: "index",
    axis: "vertical",
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultFilterNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "filter",
    itemsRef: "events",
    outputVariableName: "filteredEvents",
    itemAlias: "event",
    indexAlias: "index",
    condition: 'event.summary != "Blocked"',
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultUniqueNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "unique",
    itemsRef: "events",
    outputVariableName: "uniqueEvents",
    itemAlias: "event",
    indexAlias: "index",
    keyTemplate: '{{ event.start | format("HH:MM") }}--{{ event.summary }}',
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultIfElseNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "if_else",
    condition: "event.allday == true",
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultScriptNode(): LayoutNode {
  return {
    id: nextId("node"),
    type: "script",
    source: 'return { derivedText: String(now ?? "").slice(11, 16) };',
    outputMode: "merge_object",
    bindings: {},
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function defaultNodeForKind(kind: NodeCreateKind, project: Project): LayoutNode {
  if (kind === "stack" || kind === "grid" || kind === "zstack") {
    return defaultRootNode(kind);
  }
  if (kind === "compound_ref") {
    return defaultCompoundRefNode((project.widgetDefinitions ?? []).find((entry) => entry.kind === "compound")?.id ?? "");
  }
  if (kind === "data_query") {
    return defaultDataQueryNode();
  }
  if (kind === "filter") {
    return defaultFilterNode();
  }
  if (kind === "unique") {
    return defaultUniqueNode();
  }
  if (kind === "foreach") {
    return defaultForEachNode();
  }
  if (kind === "script") {
    return defaultScriptNode();
  }
  if (kind === "if_else") {
    return defaultIfElseNode();
  }
  return defaultPrimitiveNode(kind);
}

function labelForNode(node: LayoutNode): string {
  if (node.type === "primitive_instance") {
    return node.primitiveType;
  }
  if (node.type === "compound_ref") {
    return "compound";
  }
  if (node.type === "data_query") {
    return `query ${node.variableName || "data"}`;
  }
  if (node.type === "filter") {
    return `filter ${node.outputVariableName || "items"}`;
  }
  if (node.type === "unique") {
    return `unique ${node.outputVariableName || "items"}`;
  }
  if (node.type === "foreach") {
    return `foreach ${node.itemAlias || "item"}`;
  }
  if (node.type === "script") {
    return "script";
  }
  if (node.type === "if_else") {
    return "if/else";
  }
  return node.type;
}

function availableFontVariants(font: FontOption | undefined): FontVariantKey[] {
  return font?.variants ?? ["regular"];
}

function parentIdForNode(root: LayoutNode | undefined, nodeId: string): string | undefined {
  return buildNodeTree(root).find((entry) => entry.node.id === nodeId)?.parentId;
}

function defaultRootNode(kind: "stack" | "grid" | "zstack" = "stack"): LayoutNode {
  if (kind === "grid") {
    return {
      id: nextId("node"),
      type: "grid",
      rows: [{ size: defaultSizeSpec("fraction", 0.5) }, { size: defaultSizeSpec("fraction", 0.5) }],
      columns: [{ size: defaultSizeSpec("fraction", 0.5) }, { size: defaultSizeSpec("fraction", 0.5) }],
      children: [],
      width: defaultSizeSpec("fill"),
      height: defaultSizeSpec("fill"),
      style: { paddingPx: 4, gapPx: 4, borderToken: "none" }
    };
  }
  if (kind === "zstack") {
    return {
      id: nextId("node"),
      type: "zstack",
      children: [defaultPrimitiveNode("graph"), defaultPrimitiveNode("number")],
      width: defaultSizeSpec("fill"),
      height: defaultSizeSpec("fill"),
      style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
    };
  }
  return {
    id: nextId("node"),
    type: "stack",
    axis: "vertical",
    children: [defaultPrimitiveNode("text")],
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function emptyStackRoot(): LayoutNode {
  return {
    id: nextId("node"),
    type: "stack",
    axis: "vertical",
    children: [],
    width: defaultSizeSpec("fill"),
    height: defaultSizeSpec("fill"),
    style: { paddingPx: 0, gapPx: 0, borderToken: "none" }
  };
}

function candidateMac(candidate: DiscoveredDisplayCandidate): string {
  return String(candidate.metadata?.mac ?? candidate.providerDeviceRef ?? candidate.providerRef ?? "");
}

function normalizedMac(value: string): string {
  return value.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function lastSixMacDigits(value: string): string {
  const compact = normalizedMac(value);
  return compact.length >= 6 ? compact.slice(-6) : compact;
}

function displayMac(display: Pick<ManagedDisplay, "metadata" | "providerRef" | "providerDeviceRef">): string {
  return String(display.metadata?.mac ?? display.providerDeviceRef ?? display.providerRef ?? "");
}

function displayTitle(display: Pick<ManagedDisplay, "name" | "metadata" | "providerRef" | "providerDeviceRef">): string {
  const suffix = lastSixMacDigits(displayMac(display));
  return suffix ? `${display.name} · ${suffix}` : display.name;
}

function discoveredDisplayTitle(candidate: DiscoveredDisplayCandidate): string {
  const suffix = lastSixMacDigits(candidateMac(candidate));
  return suffix ? `${candidate.name} · ${suffix}` : candidate.name;
}

function parseAllowedPixelSizes(value: string): number[] {
  return Array.from(
    new Set(
      value
        .split(/[,\s]+/)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry >= 4)
    )
  ).sort((left, right) => left - right);
}

function variantLabel(weight: string, slope: string): string {
  return `${weight}${slope === "italic" ? " italic" : ""}`;
}

function variantKeyLabel(variant: string): string {
  if (variant === "boldItalic") {
    return "Bold italic";
  }
  return variant
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function variantKeyToStyle(variant: FontVariantKey): [string, string] {
  if (variant === "boldItalic") {
    return ["bold", "italic"];
  }
  if (variant === "bold") {
    return ["bold", "roman"];
  }
  if (variant === "italic") {
    return ["regular", "italic"];
  }
  if (variant.endsWith("Italic")) {
    return [variant.slice(0, -"Italic".length), "italic"];
  }
  return [variant, "roman"];
}

function defaultVirtualDisplayDefinition(displayTypeId: string, index = 1): VirtualDisplayDefinition {
  return {
    id: nextId("virtual-device"),
    name: `Virtual Display ${index}`,
    displayTypeId
  };
}

function updateNode(node: LayoutNode, nodeId: string, updater: (current: LayoutNode) => LayoutNode): LayoutNode {
  if (node.id === nodeId) {
    return updater(node);
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children.map((child) => updateNode(child, nodeId, updater))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children.map((child) => ({
        ...child,
        node: updateNode(child.node, nodeId, updater)
      }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return {
      ...node,
      child: node.child ? updateNode(node.child, nodeId, updater) : undefined
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild ? updateNode(node.thenChild, nodeId, updater) : undefined,
      elseChild: node.elseChild ? updateNode(node.elseChild, nodeId, updater) : undefined
    };
  }
  return node;
}

function removeNodeById(node: LayoutNode, nodeId: string): LayoutNode {
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children
        .filter((child) => child.id !== nodeId)
        .map((child) => removeNodeById(child, nodeId))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children
        .filter((child) => child.node.id !== nodeId)
        .map((child) => ({
          ...child,
          node: removeNodeById(child.node, nodeId)
        }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "script") {
    return {
      ...node,
      child: node.child?.id === nodeId ? undefined : node.child ? removeNodeById(node.child, nodeId) : undefined
    };
  }
  if (node.type === "foreach") {
    return {
      ...node,
      child: node.child?.id === nodeId ? undefined : node.child ? removeNodeById(node.child, nodeId) : undefined
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild?.id === nodeId ? undefined : node.thenChild ? removeNodeById(node.thenChild, nodeId) : undefined,
      elseChild: node.elseChild?.id === nodeId ? undefined : node.elseChild ? removeNodeById(node.elseChild, nodeId) : undefined
    };
  }
  return node;
}

function stripCompoundRefs(node: LayoutNode, definitionId: string): LayoutNode | undefined {
  if (node.type === "compound_ref" && node.definitionId === definitionId) {
    return undefined;
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children
        .map((child) => stripCompoundRefs(child, definitionId))
        .filter((child): child is LayoutNode => Boolean(child))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children
        .map((child) => {
          const stripped = stripCompoundRefs(child.node, definitionId);
          return stripped ? { ...child, node: stripped } : undefined;
        })
        .filter((child): child is typeof node.children[number] => Boolean(child))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "script") {
    const child = node.child ? stripCompoundRefs(node.child, definitionId) : undefined;
    return { ...node, child };
  }
  if (node.type === "foreach") {
    const child = node.child ? stripCompoundRefs(node.child, definitionId) : undefined;
    return { ...node, child };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild ? stripCompoundRefs(node.thenChild, definitionId) : undefined,
      elseChild: node.elseChild ? stripCompoundRefs(node.elseChild, definitionId) : undefined
    };
  }
  return node;
}

function clearThemeRefs(node: LayoutNode, themeId: string): LayoutNode {
  const cleanedStyle = node.style?.themeId === themeId ? { ...node.style, themeId: "inherit" } : node.style;
  if (node.type === "primitive_instance") {
    return {
      ...node,
      style: cleanedStyle,
      props: node.props?.themeId === themeId ? { ...node.props, themeId: "inherit" } : node.props
    };
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      style: cleanedStyle,
      children: node.children.map((child) => clearThemeRefs(child, themeId))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      style: cleanedStyle,
      children: node.children.map((child) => ({
        ...child,
        node: clearThemeRefs(child.node, themeId)
      }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return {
      ...node,
      style: cleanedStyle,
      child: node.child ? clearThemeRefs(node.child, themeId) : undefined
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      style: cleanedStyle,
      thenChild: node.thenChild ? clearThemeRefs(node.thenChild, themeId) : undefined,
      elseChild: node.elseChild ? clearThemeRefs(node.elseChild, themeId) : undefined
    };
  }
  return { ...node, style: cleanedStyle };
}

function appendChild(node: LayoutNode, parentId: string, child: LayoutNode): LayoutNode {
  if (node.id === parentId && (node.type === "stack" || node.type === "zstack")) {
    return {
      ...node,
      children: [...node.children, child]
    };
  }
  if (node.id === parentId && node.type === "grid") {
    return {
      ...node,
      children: [
        ...node.children,
        {
          placement: {
            row: 0,
            column: 0
          },
          node: child
        }
      ]
    };
  }
  if (node.id === parentId && (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "script")) {
    return {
      ...node,
      child
    };
  }
  if (node.id === parentId && node.type === "foreach") {
    return {
      ...node,
      child
    };
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children.map((entry) => appendChild(entry, parentId, child))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children.map((entry) => ({
        ...entry,
        node: appendChild(entry.node, parentId, child)
      }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return {
      ...node,
      child: node.child ? appendChild(node.child, parentId, child) : node.child
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild ? appendChild(node.thenChild, parentId, child) : undefined,
      elseChild: node.elseChild ? appendChild(node.elseChild, parentId, child) : undefined
    };
  }
  return node;
}

function moveLayer(node: LayoutNode, parentId: string, childId: string, delta: -1 | 1): LayoutNode {
  if (node.id === parentId && (node.type === "stack" || node.type === "zstack")) {
    const index = node.children.findIndex((entry) => entry.id === childId);
    if (index < 0) {
      return node;
    }
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= node.children.length) {
      return node;
    }
    const children = [...node.children];
    const [item] = children.splice(index, 1);
    children.splice(nextIndex, 0, item);
    return { ...node, children };
  }
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children.map((entry) => moveLayer(entry, parentId, childId, delta))
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children.map((entry) => ({
        ...entry,
        node: moveLayer(entry.node, parentId, childId, delta)
      }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return {
      ...node,
      child: node.child ? moveLayer(node.child, parentId, childId, delta) : undefined
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild ? moveLayer(node.thenChild, parentId, childId, delta) : undefined,
      elseChild: node.elseChild ? moveLayer(node.elseChild, parentId, childId, delta) : undefined
    };
  }
  return node;
}

function defaultTheme(): WidgetTheme {
  return {
    id: nextId("theme"),
    name: "New Theme",
    border: { visible: true, colorRole: "fg", mergeAdjacentBorders: true },
    surface: {},
    text: { title: "fg", body: "fg", value: "fg" },
    accentRole: "accent",
    fontRoles: {
      tiny: { family: "arial", weight: "regular", slope: "roman", size: "tiny", pixelSize: 8, colorRole: "fg", lineSpacingPx: 0, topPaddingPx: 0 },
      normal: { family: "arial", weight: "regular", slope: "roman", size: "normal", pixelSize: 12, colorRole: "fg", lineSpacingPx: 0, topPaddingPx: 0 },
      normalEmphasis: { family: "arial", weight: "bold", slope: "roman", size: "normal", pixelSize: 12, colorRole: "fg", lineSpacingPx: 0, topPaddingPx: 0 },
      header: { family: "arial", weight: "bold", slope: "roman", size: "header", pixelSize: 18, colorRole: "fg", lineSpacingPx: 0, topPaddingPx: 0 }
    },
    borderTokens: {
      thin: { thicknessPx: 1, colorRole: "fg" },
      thick: { thicknessPx: 2, colorRole: "fg" }
    },
    textOutline: {
      enabled: false,
      colorRole: "bg",
      thicknessPx: 1
    }
  };
}

function fontRoleBasePixelSize(project: Project, role: FontRole): number {
  if (role === "tiny") {
    return project.fontPresets.tiny;
  }
  if (role === "header") {
    return project.fontPresets.header;
  }
  return project.fontPresets.normal;
}

function fontRoleLabel(role: FontRole): string {
  if (role === "normalEmphasis") {
    return "normal emphasis";
  }
  return role;
}

function textColorRoleLabel(role: TextStyle["colorRole"] | undefined): string {
  if (role === "bg") return "white";
  if (role === "fg" || role === undefined) return "black";
  if (role === "accent") return "accent";
  return "transparent";
}

function fillRoleLabel(role: FillRole | undefined): string {
  if (role === "bg") return "white";
  if (role === "fg" || role === undefined) return "black";
  if (role === "accent") return "accent";
  if (role === "gray") return "gray";
  if (role === "light-accent") return "light accent";
  return "dark accent";
}

function fontRoleThemeTextKey(role: FontRole): "title" | "body" | "value" | undefined {
  if (role === "tiny") {
    return "title";
  }
  if (role === "normal") {
    return "body";
  }
  if (role === "header") {
    return "value";
  }
  return undefined;
}

function defaultDisplayType(): DisplayType {
  const profile = DISPLAY_PROFILES[0];
  return {
    id: nextId("display-type"),
    name: "New Display Type",
    width: profile.width,
    height: profile.height,
    palette: profile.palette,
    rotation: profile.rotation,
    contentPadding: { ...profile.contentPadding },
    gridUnitPx: profile.gridUnitPx
  };
}

function defaultCompoundWidget(): WidgetDefinition {
  return {
    id: nextId("widget"),
    name: "New Compound Widget",
    kind: "compound",
    inputSchema: [],
    rootNode: defaultRootNode("stack")
  };
}

function defaultLayout(): LayoutDefinition {
  return {
    id: nextId("layout"),
    name: "New Layout",
    kind: "fullscreen",
    rootNode: defaultRootNode("zstack")
  };
}

function defaultAssignment(displayId: string, layoutId?: string): DeviceAssignment {
  return {
    id: nextId("assignment"),
    displayId,
    defaultFullscreenLayoutId: layoutId,
    defaultThemeId: "classic-outline",
    schedule: {
      enabled: false,
      intervalMinutes: 15
    },
    fullscreenRules: [],
    popupRules: []
  };
}

function defaultRule(scope: Rule["scope"], layoutId = ""): Rule {
  return {
    id: nextId("rule"),
    scope,
    priority: 100,
    condition: { kind: "entity_state", entityId: "", equals: "on" },
    action:
      scope === "popup_activation"
        ? { type: "activate_popup_layout", layoutId }
        : { type: "activate_fullscreen_layout", layoutId }
  };
}

export class EpPaperEditorApp extends LitElement {
  static properties = {
    projectSummaries: { state: true },
    project: { state: true },
    activePage: { state: true },
    selectedDisplayId: { state: true },
    selectedDisplayTypeId: { state: true },
    selectedWidgetDefinitionId: { state: true },
    selectedLayoutId: { state: true },
    selectedNodeId: { state: true },
    createChildTargetNodeId: { state: true },
    selectedThemeId: { state: true },
    selectedPreviewThemeId: { state: true },
    selectedAssignmentId: { state: true },
    activeConfigSection: { state: true },
    discoveredDisplays: { state: true },
    icons: { state: true },
    fonts: { state: true },
    entityCatalog: { state: true },
    previewPngBase64: { state: true },
    previewHash: { state: true },
    previewWidth: { state: true },
    previewHeight: { state: true },
    previewMessage: { state: true },
    scale: { state: true },
    updateLogImageModal: { state: true },
    updateLogImageScale: { state: true },
    fontSpecimens: { state: true },
    fontSpecimenSampleText: { state: true },
    fontSpecimenError: { state: true },
    showAllFontSpecimenSizes: { state: true },
    confirmDeleteFontId: { state: true },
    previewViewportWidth: { state: true },
    previewViewportHeight: { state: true },
    iconSearchQuery: { state: true },
    providerKinds: { state: true },
    providerInstances: { state: true },
    providerStatuses: { state: true },
    uploadStatusMessage: { state: true },
    backupStatusMessage: { state: true },
    assignmentScheduleStatuses: { state: true },
    displayUpdateLog: { state: true },
    displayUpdateLogSinceMinutes: { state: true },
    scheduleUpdateLogSettings: { state: true },
    selectedPreviewTagMac: { state: true },
    structureHoveredNodeId: { state: true },
    structureDraggedNodeId: { state: true },
    structureDropIntent: { state: true }
  };

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      color: #111;
    }
    .shell {
      display: grid;
      grid-template-columns: 220px minmax(240px, 320px) minmax(420px, 1fr) minmax(240px, 0.6fr);
      min-height: 100vh;
    }
    nav,
    .panel {
      border-right: 2px solid #111;
      background: #f7f1e5;
      box-sizing: border-box;
    }
    nav {
      padding: 12px;
      display: grid;
      gap: 8px;
      align-content: start;
    }
    .panel {
      padding: 12px;
      overflow: auto;
    }
    .detail {
      background: #fbf7ef;
    }
    .preview {
      background: #f4efe4;
      border-right: none;
      display: flex;
      flex-direction: column;
    }
    h1, h2, h3 {
      margin: 0 0 10px;
      font-size: 16px;
    }
    button,
    input,
    select,
    textarea,
    code-editor-field {
      font: inherit;
    }
    button {
      border: 2px solid #111;
      background: #fff;
      padding: 6px 10px;
      cursor: pointer;
    }
    button.primary,
    button.active {
      background: #111;
      color: #fff;
    }
    .nav-button,
    .item-button {
      width: 100%;
      text-align: left;
    }
    .section {
      margin-bottom: 16px;
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 8px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      font-size: 13px;
    }
    input:not(.ime-text-area):not(.inputarea),
    select,
    textarea:not(.ime-text-area):not(.inputarea) {
      width: 100%;
      box-sizing: border-box;
      border: 2px solid #111;
      padding: 6px;
      background: #fff;
    }
    textarea:not(.ime-text-area):not(.inputarea) {
      min-height: 96px;
      resize: vertical;
    }
    .preview-stage {
      border: 2px solid #111;
      background: #efe7d4;
      image-rendering: pixelated;
      display: inline-block;
      max-width: 100%;
      max-height: 100%;
    }
    .preview-body {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: auto;
      padding-bottom: 12px;
    }
    canvas {
      display: block;
      image-rendering: pixelated;
    }
    .structure-stage {
      position: relative;
      overflow: auto;
      touch-action: none;
      cursor: crosshair;
      min-height: 220px;
      border: 2px solid #111;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.6), rgba(239,231,212,0.9)),
        repeating-linear-gradient(0deg, transparent, transparent 23px, rgba(17,17,17,0.04) 24px),
        repeating-linear-gradient(90deg, transparent, transparent 23px, rgba(17,17,17,0.04) 24px);
    }
    .structure-overlay {
      position: relative;
    }
    .structure-node {
      position: absolute;
      box-sizing: border-box;
      border: 1px dashed rgba(17, 17, 17, 0.45);
      background: rgba(255, 255, 255, 0.16);
      color: #111;
      overflow: hidden;
      pointer-events: none;
    }
    .structure-node.container {
      background: rgba(255, 255, 255, 0.08);
    }
    .structure-node.hovered {
      border-color: #c98912;
      background: rgba(216, 188, 92, 0.14);
    }
    .structure-node.selected {
      border: 2px solid #111;
      background: rgba(17, 17, 17, 0.08);
    }
    .structure-node.drop-target {
      border-color: #1f6f3a;
      background: rgba(31, 111, 58, 0.12);
    }
    .structure-node-header {
      position: absolute;
      left: 0;
      right: 0;
      top: 0;
      height: 12px;
      box-sizing: border-box;
      font-size: 11px;
      line-height: 10px;
      background: rgba(247, 241, 229, 0.96);
      border-bottom: 1px solid rgba(17, 17, 17, 0.2);
      padding: 1px 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
    }
    .editor-structure-preview {
      margin-bottom: 12px;
      border: 2px solid #111;
      background: #fff;
      padding: 10px;
    }
    .structure-cell {
      position: absolute;
      box-sizing: border-box;
      border: 1px dotted rgba(17, 17, 17, 0.22);
      background: transparent;
    }
    .structure-cell.drop-target {
      border-color: #1f6f3a;
      background: rgba(31, 111, 58, 0.12);
    }
    .font-specimen {
      max-width: 100%;
      height: auto;
    }
    .font-size-grid {
      display: grid;
      gap: 8px;
    }
    .font-size-row {
      border: 1px solid #111;
      background: #fdfbf6;
      padding: 8px;
    }
    .font-size-row-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .font-variant-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    }
    .font-variant-card {
      border: 1px solid #111;
      background: #fff;
      padding: 6px;
    }
    .font-variant-title {
      font-size: 12px;
      margin-bottom: 4px;
    }
    details {
      border: 2px solid #111;
      background: #fff;
      padding: 8px;
      margin-bottom: 8px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    .muted {
      color: #555;
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th,
    td {
      border: 1px solid #111;
      padding: 4px;
      text-align: left;
      vertical-align: top;
    }
    .update-log-image {
      width: 96px;
      max-height: 72px;
      object-fit: contain;
      image-rendering: pixelated;
      border: 1px solid #111;
      background: #fff;
      cursor: zoom-in;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal {
      max-width: min(92vw, 900px);
      max-height: 92vh;
      overflow: auto;
      border: 2px solid #111;
      background: #f7f1e3;
      padding: 12px;
    }
    .modal-image {
      image-rendering: pixelated;
      border: 2px solid #111;
      background: #fff;
      object-fit: contain;
    }
    .node-children {
      margin-left: 16px;
      border-left: 2px solid #ddd;
      padding-left: 8px;
    }
    .inspector-panel {
      border: 2px solid #111;
      background: #fff;
      padding: 12px;
    }
    .danger {
      border-color: #7f1d1d;
      color: #7f1d1d;
    }
    .detail-danger-action {
      margin: 8px 0 12px;
    }
    .empty-state {
      border: 2px dashed #111;
      background: #fff;
      padding: 12px;
    }
    .font-preview-card {
      margin-bottom: 12px;
    }
    .pill {
      display: inline-block;
      border: 1px solid #111;
      padding: 1px 6px;
      font-size: 12px;
      background: #fff;
    }
    .status-ok {
      color: #1f6f3a;
      font-weight: 600;
    }
    .status-error {
      color: #9d1f15;
      font-weight: 600;
    }
  `;

  private previewResizeObserver: ResizeObserver | null = null;
  private draggedNodeId = "";

  declare private projectSummaries: Array<Pick<Project, "id" | "name" | "version">>;
  declare private project: Project;
  declare private activePage: PageId;
  declare private selectedDisplayId: string;
  declare private selectedDisplayTypeId: string;
  declare private selectedWidgetDefinitionId: string;
  declare private selectedLayoutId: string;
  declare private selectedNodeId: string;
  declare private createChildTargetNodeId: string;
  declare private selectedThemeId: string;
  declare private selectedPreviewThemeId: string;
  declare private selectedAssignmentId: string;
  declare private activeConfigSection: ConfigSectionId;
  declare private discoveredDisplays: DiscoveredDisplayCandidate[];
  declare private icons: IconDefinition[];
  declare private fonts: FontOption[];
  declare private entityCatalog: Array<{ entityId: string; friendlyName: string; domain: string; unit?: string }>;
  declare private previewPngBase64: string;
  declare private previewHash: string;
  declare private previewWidth: number;
  declare private previewHeight: number;
  declare private previewMessage: string;
  declare private scale: number;
  declare private updateLogImageModal: AssignmentUpdateLogEntry | null;
  declare private updateLogImageScale: number;
  declare private fontSpecimens: FontSpecimenFamilyView[];
  declare private fontSpecimenSampleText: string;
  declare private fontSpecimenError: string;
  declare private showAllFontSpecimenSizes: boolean;
  declare private fontSpecimenLoading: boolean;
  declare private selectedFontPreviewFamilyId: string;
  private fontSpecimenRequestId = 0;
  private previewRequestId = 0;
  declare private confirmDeleteFontId: string;
  declare private previewViewportWidth: number;
  declare private previewViewportHeight: number;
  declare private iconSearchQuery: string;
  declare private providerKinds: ProviderDescriptor[];
  declare private providerInstances: ProviderInstance[];
  declare private providerStatuses: Record<string, ProviderConnectionStatus | null>;
  declare private uploadStatusMessage: string;
  declare private backupStatusMessage: string;
  declare private assignmentScheduleStatuses: Record<string, AssignmentScheduleStatusResponse>;
  declare private displayUpdateLog: AssignmentUpdateLogEntry[];
  declare private displayUpdateLogSinceMinutes: number;
  declare private scheduleUpdateLogSettings: ScheduleUpdateLogSettings;
  declare private selectedPreviewTagMac: string;
  declare private structureHoveredNodeId: string;
  declare private structureDraggedNodeId: string;
  declare private structureDropIntent: StructureDropIntent | null;

  constructor() {
    super();
    this.projectSummaries = [];
    this.project = emptyProject();
    this.activePage = routeToPage(window.location.hash);
    this.selectedDisplayId = "";
    this.selectedDisplayTypeId = "";
    this.selectedWidgetDefinitionId = "";
    this.selectedLayoutId = "";
    this.selectedNodeId = "";
    this.createChildTargetNodeId = "";
    this.selectedThemeId = "";
    this.selectedPreviewThemeId = "";
    this.selectedAssignmentId = "";
    this.activeConfigSection = window.location.hash.replace(/^#\/?/, "") === "display-types" ? "display-systems" : "project";
    this.discoveredDisplays = [];
    this.icons = [];
    this.fonts = [];
    this.entityCatalog = [];
    this.previewPngBase64 = "";
    this.previewHash = "";
    this.previewWidth = 0;
    this.previewHeight = 0;
    this.previewMessage = "";
    this.scale = typeof window !== "undefined" && window.devicePixelRatio >= 1.75 ? 2 : 1;
    this.updateLogImageModal = null;
    this.updateLogImageScale = 2;
    this.fontSpecimens = [];
    this.fontSpecimenSampleText = "Ag 09:45 21.5C";
    this.fontSpecimenError = "";
    this.showAllFontSpecimenSizes = false;
    this.fontSpecimenLoading = false;
    this.selectedFontPreviewFamilyId = "";
    this.confirmDeleteFontId = "";
    this.previewViewportWidth = 0;
    this.previewViewportHeight = 0;
    this.iconSearchQuery = "";
    this.providerKinds = [];
    this.providerInstances = [];
    this.providerStatuses = {};
    this.uploadStatusMessage = "";
    this.backupStatusMessage = "";
    this.assignmentScheduleStatuses = {};
    this.displayUpdateLog = [];
    this.displayUpdateLogSinceMinutes = 60;
    this.scheduleUpdateLogSettings = { retentionDays: 7 };
    this.selectedPreviewTagMac = "";
    this.structureHoveredNodeId = "";
    this.structureDraggedNodeId = "";
    this.structureDropIntent = null;
    if (window.location.hash && window.location.hash !== pageToRoute(this.activePage)) {
      window.location.hash = pageToRoute(this.activePage);
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("hashchange", this.onHashChange);
    window.addEventListener("keydown", this.onWindowKeyDown);
    void this.initialize();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("hashchange", this.onHashChange);
    window.removeEventListener("keydown", this.onWindowKeyDown);
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
  }

  private onHashChange = (): void => {
    this.activePage = routeToPage(window.location.hash);
    if (window.location.hash !== pageToRoute(this.activePage)) {
      window.location.hash = pageToRoute(this.activePage);
      return;
    }
    if (this.activePage === "config") {
      void this.refreshFontSpecimens();
    }
    void this.refreshPreview();
  };

  private onWindowKeyDown = (event: KeyboardEvent): void => {
    if (!this.updateLogImageModal) {
      return;
    }
    if (event.key === "Escape") {
      this.updateLogImageModal = null;
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowLeft") {
      this.showAdjacentUpdateLogImage(-1);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight") {
      this.showAdjacentUpdateLogImage(1);
      event.preventDefault();
    }
  };

  private updateLogImageEntries(): AssignmentUpdateLogEntry[] {
    return this.displayUpdateLog.filter((entry) => entry.imagePngBase64);
  }

  private selectedUpdateLogImageIndex(): number {
    const current = this.updateLogImageModal;
    if (!current) {
      return -1;
    }
    return this.updateLogImageEntries().findIndex((entry) =>
      entry.timestampMs === current.timestampMs &&
      entry.hash === current.hash &&
      entry.displayId === current.displayId
    );
  }

  private showAdjacentUpdateLogImage(direction: -1 | 1): void {
    const entries = this.updateLogImageEntries();
    if (entries.length <= 1) {
      return;
    }
    const index = this.selectedUpdateLogImageIndex();
    const nextIndex = index < 0
      ? 0
      : (index + direction + entries.length) % entries.length;
    this.updateLogImageModal = entries[nextIndex] ?? null;
  }

  private async initialize(): Promise<void> {
    try {
      const [projectsResult, iconsResult, fontsResult, providerKindsResult, providerInstancesResult, updateLogSettingsResult] = await Promise.allSettled([
        fetchProjects(),
        fetchIcons(),
        fetchFonts(),
        fetchProviderKinds(),
        fetchProviderInstances(),
        fetchScheduleUpdateLogSettings()
      ]);
      const projects = projectsResult.status === "fulfilled" ? projectsResult.value : [];
      this.projectSummaries = projects;
      this.icons = iconsResult.status === "fulfilled" ? iconsResult.value : [];
      this.fonts = fontsResult.status === "fulfilled" ? fontsResult.value : [];
      this.providerKinds = providerKindsResult.status === "fulfilled" ? providerKindsResult.value : [];
      this.providerInstances = providerInstancesResult.status === "fulfilled" ? providerInstancesResult.value : [];
      this.scheduleUpdateLogSettings = updateLogSettingsResult.status === "fulfilled" ? updateLogSettingsResult.value : { retentionDays: 7 };
      const sourceProvider = this.activeSourceProviderInstance;
      this.entityCatalog = sourceProvider ? await fetchProviderEntities(sourceProvider.id).catch(() => []) : [];
      if (projects[0]) {
        this.project = cloneProject(await fetchProject(projects[0].id));
      }
    } catch {
      this.project = emptyProject();
    }
    this.syncSelections();
    await this.discoverDisplays().catch(() => undefined);
    await this.refreshAssignmentSchedules().catch(() => {
      this.assignmentScheduleStatuses = {};
    });
    await this.refreshDisplayUpdateLog().catch(() => {
      this.displayUpdateLog = [];
    });
    await this.refreshPreview();
    if (this.activePage === "config") {
      this.ensureSelectedFontPreviewFamily();
      void this.refreshFontSpecimens();
    }
  }

  private syncSelections(): void {
    this.selectedDisplayId = this.visibleDisplays.some((entry) => entry.id === this.selectedDisplayId)
      ? this.selectedDisplayId
      : this.visibleDisplays[0]?.id || "";
    this.selectedDisplayTypeId = this.project.displayTypes?.some((entry) => entry.id === this.selectedDisplayTypeId)
      ? this.selectedDisplayTypeId
      : this.project.displayTypes?.[0]?.id || "";
    this.selectedWidgetDefinitionId = this.project.widgetDefinitions?.some((entry) => entry.id === this.selectedWidgetDefinitionId)
      ? this.selectedWidgetDefinitionId
      : this.project.widgetDefinitions?.find((entry) => entry.kind === "compound")?.id || "";
    this.selectedLayoutId = this.project.layoutDefinitions?.some((entry) => entry.id === this.selectedLayoutId)
      ? this.selectedLayoutId
      : this.project.layoutDefinitions?.[0]?.id || "";
    this.selectedThemeId = this.project.themes?.some((entry) => entry.id === this.selectedThemeId)
      ? this.selectedThemeId
      : this.project.themes?.[0]?.id || "";
    this.selectedPreviewThemeId = this.project.themes?.some((entry) => entry.id === this.selectedPreviewThemeId)
      ? this.selectedPreviewThemeId
      : this.project.themes?.[0]?.id || "";
    this.selectedAssignmentId = this.project.deviceAssignments?.some((entry) => entry.id === this.selectedAssignmentId)
      ? this.selectedAssignmentId
      : this.project.deviceAssignments?.[0]?.id || "";
    const currentRoot = this.editorRootNode;
    this.selectedNodeId = currentRoot && getNodeById(currentRoot, this.selectedNodeId)
      ? this.selectedNodeId
      : currentRoot?.id ?? "";
  }

  private filteredIcons(query: string, selectedIconId = ""): IconDefinition[] {
    const needle = query.trim().toLowerCase();
    const selected = this.icons.find((icon) => icon.id === selectedIconId);
    const filtered = !needle
      ? this.icons
      : this.icons.filter((icon) =>
          icon.id.toLowerCase().includes(needle) ||
          icon.label.toLowerCase().includes(needle) ||
          (icon.pack ?? "").toLowerCase().includes(needle) ||
          (icon.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle))
        );
    if (selected && !filtered.some((icon) => icon.id === selected.id)) {
      return [selected, ...filtered];
    }
    return filtered.slice(0, 200);
  }

  updated(): void {
    const previewHost = this.renderRoot.querySelector<HTMLElement>(".preview-body");
    if (previewHost && typeof ResizeObserver !== "undefined" && !this.previewResizeObserver) {
      this.previewResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }
        this.previewViewportWidth = Math.floor(entry.contentRect.width);
        this.previewViewportHeight = Math.floor(entry.contentRect.height);
      });
      this.previewResizeObserver.observe(previewHost);
      this.previewViewportWidth = previewHost.clientWidth;
      this.previewViewportHeight = previewHost.clientHeight;
    }

  }

  private replaceProject(project: Project): void {
    this.project = cloneProject(project);
    this.syncSelections();
    this.ensureSelectedFontPreviewFamily();
    this.structureDraggedNodeId = "";
    this.structureDropIntent = null;
    this.structureHoveredNodeId = "";
    void this.refreshPreview();
    if (this.activePage === "config") {
      void this.refreshFontSpecimens();
    }
  }

  private async refreshAssignmentSchedules(): Promise<void> {
    this.assignmentScheduleStatuses = Object.fromEntries(
      (await fetchAssignmentSchedules(this.project.id)).map((status) => [status.assignmentId, status])
    );
  }

  private displayUpdateLogSinceMs(): number {
    return Math.max(0, Date.now() - Math.max(1, this.displayUpdateLogSinceMinutes) * 60_000);
  }

  private async refreshDisplayUpdateLog(): Promise<void> {
    if (!this.project.id || !this.selectedDisplayId) {
      this.displayUpdateLog = [];
      return;
    }
    this.displayUpdateLog = await fetchDisplayUpdateLog(
      this.project.id,
      this.selectedDisplayId,
      this.displayUpdateLogSinceMs()
    );
  }

  private async persistScheduleUpdateLogSettings(): Promise<void> {
    this.scheduleUpdateLogSettings = await saveScheduleUpdateLogSettings(this.scheduleUpdateLogSettings);
  }

  private backupFilename(archive: BackupArchive): string {
    const date = archive.exportedAt.replace(/[:.]/g, "-").replace(/T/, "_").replace(/Z$/, "Z");
    return `inkframe-studio-backup-${date}.json`;
  }

  private async downloadBackup(): Promise<void> {
    this.backupStatusMessage = "Creating backup...";
    try {
      const archive = await fetchBackupArchive();
      const blob = new Blob([JSON.stringify(archive, null, 2), "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = this.backupFilename(archive);
      anchor.click();
      URL.revokeObjectURL(url);
      this.backupStatusMessage = `Backup ready: ${archive.projects.length} project(s), ${archive.fonts.length} font file(s).`;
    } catch (error) {
      this.backupStatusMessage = error instanceof Error ? error.message : "Backup failed";
    }
  }

  private async restoreBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    this.backupStatusMessage = "Restoring backup...";
    try {
      const archive = JSON.parse(await file.text()) as BackupArchive;
      const restored = await restoreBackupArchive(archive);
      this.projectSummaries = await fetchProjects();
      const projectId = restored.projects[0]?.id ?? this.projectSummaries[0]?.id;
      if (projectId) {
        this.replaceProject(await fetchProject(projectId));
      }
      this.fonts = await fetchFonts();
      this.providerInstances = await fetchProviderInstances();
      this.backupStatusMessage = `Restored ${restored.projects.length} project(s), ${restored.fonts.length} font file(s).`;
    } catch (error) {
      this.backupStatusMessage = error instanceof Error ? error.message : "Restore failed";
    }
  }

  private async persistProject(): Promise<void> {
    this.project = cloneProject(await saveProject(this.project));
    this.projectSummaries = await fetchProjects();
    this.syncSelections();
    await this.refreshAssignmentSchedules().catch(() => {
      this.assignmentScheduleStatuses = {};
    });
    await this.refreshDisplayUpdateLog().catch(() => {
      this.displayUpdateLog = [];
    });
    await this.refreshPreview();
  }

  private async refreshPreview(): Promise<void> {
    const requestId = ++this.previewRequestId;
    const [preview, inspection] = await this.fetchPagePreviewAndInspection().catch(() => [undefined, undefined] as const);
    if (requestId !== this.previewRequestId) {
      return;
    }
    if (!preview) {
      this.previewPngBase64 = "";
      this.previewHash = "";
      this.previewMessage = "";
      this.previewWidth = 0;
      this.previewHeight = 0;
      this.structureHoveredNodeId = "";
      this.structureDraggedNodeId = "";
      this.structureDropIntent = null;
      return;
    }
    this.previewPngBase64 = preview.pngBase64;
    this.previewHash = preview.hash;
    this.previewMessage = [
      preview.dataSourceMessage,
      ...(preview.scriptWarnings ?? [])
    ].filter(Boolean).join("\n");
    this.previewWidth = preview.width;
    this.previewHeight = preview.height;
    if (this.selectedNodeId && !getNodeById(this.editorRootNode, this.selectedNodeId)) {
      this.structureHoveredNodeId = "";
      this.structureDropIntent = null;
    }
  }

  private async fetchPagePreviewAndInspection(): Promise<readonly [PreviewResponse | undefined, undefined]> {
    if (this.activePage === "layouts") {
      if (!this.selectedLayoutId) {
        return [undefined, undefined] as const;
      }
      const preview = await fetchLayoutPreview(
        this.project.id,
        this.selectedLayoutId,
        undefined,
        this.projectWithPreviewThemeForLayout(this.selectedLayoutId),
        this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id
      );
      return [preview, undefined] as const;
    }
    if (this.activePage === "widgets") {
      const definition = this.selectedWidgetDefinition;
      if (!definition?.rootNode) {
        return [undefined, undefined] as const;
      }
      const displayTypeId = this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id;
      if (!displayTypeId) {
        return [undefined, undefined] as const;
      }
      const tempLayoutId = "__widget-preview-layout";
      const tempProject = this.widgetPreviewProject(definition, displayTypeId);
      return [await fetchLayoutPreview(this.project.id, tempLayoutId, undefined, tempProject, displayTypeId), undefined] as const;
    }
    return [await this.fetchPagePreview(), undefined] as const;
  }

  private ensureSelectedFontPreviewFamily(): void {
    const userFonts = this.fonts.filter((font) => font.source === "user");
    if (userFonts.some((font) => font.id === this.selectedFontPreviewFamilyId)) {
      return;
    }
    this.selectedFontPreviewFamilyId = userFonts[0]?.id ?? "";
  }

  private async refreshFontSpecimens(): Promise<void> {
    const displayTypeId = this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id;
    if (!displayTypeId) {
      this.fontSpecimens = [];
      this.fontSpecimenError = "No display type selected.";
      return;
    }
    this.ensureSelectedFontPreviewFamily();
    if (!this.selectedFontPreviewFamilyId) {
      this.fontSpecimens = [];
      this.fontSpecimenError = "No imported fonts yet.";
      return;
    }
    const requestId = ++this.fontSpecimenRequestId;
    this.fontSpecimenLoading = true;
    try {
      const response = await fetchFontSpecimens(
        this.project.id,
        displayTypeId,
        this.fontSpecimenSampleText,
        this.project,
        4,
        36,
        this.selectedFontPreviewFamilyId,
        this.showAllFontSpecimenSizes
      );
      if (requestId !== this.fontSpecimenRequestId) {
        return;
      }
      this.fontSpecimens = response.families ?? [];
      this.fontSpecimenError = this.fontSpecimens.length ? "" : "No font variants available for preview.";
    } catch (error) {
      if (requestId !== this.fontSpecimenRequestId) {
        return;
      }
      this.fontSpecimens = [];
      this.fontSpecimenError = error instanceof Error ? error.message : "Font preview failed.";
    } finally {
      if (requestId === this.fontSpecimenRequestId) {
        this.fontSpecimenLoading = false;
      }
    }
  }

  private projectWithPreviewThemeForLayout(layoutId: string): Project {
    const previewThemeId = this.effectivePreviewThemeId;
    if (!previewThemeId) {
      return this.project;
    }
    return cloneProject({
      ...this.project,
      layoutDefinitions: (this.project.layoutDefinitions ?? []).map((entry) => (
        entry.id === layoutId && entry.rootNode
          ? {
              ...entry,
              rootNode: {
                ...entry.rootNode,
                style: { ...entry.rootNode.style, themeId: previewThemeId }
              }
            }
          : entry
      ))
    });
  }

  private widgetPreviewProject(definition: WidgetDefinition, displayTypeId: string): Project {
    const tempLayoutId = "__widget-preview-layout";
    return cloneProject({
      ...this.project,
      layoutDefinitions: [
        ...(this.project.layoutDefinitions ?? []).filter((entry) => entry.id !== tempLayoutId),
        {
          id: tempLayoutId,
          name: "Widget Preview",
          kind: "fullscreen",
          rootNode: {
            id: "__widget-preview-ref",
            type: "compound_ref",
            definitionId: definition.id,
            width: defaultSizeSpec("fill"),
            height: defaultSizeSpec("fill"),
            style: { paddingPx: 0, borderToken: "none", themeId: this.effectivePreviewThemeId },
            inputBindings: {},
            inputValues: Object.fromEntries(
              (definition.inputSchema ?? []).map((input) => [
                input.id,
                input.previewValue ?? input.defaultValue ?? (input.valueType === "boolean" ? false : input.valueType === "number" ? 0 : "")
              ])
            )
          }
        }
      ]
    });
  }

  private async fetchPagePreview(): Promise<PreviewResponse | undefined> {
    if (this.activePage === "displays") {
      if (!this.selectedDisplayId) {
        return undefined;
      }
      return await fetchDevicePreview(this.project.id, this.selectedDisplayId, this.project);
    }
    if (this.activePage === "layouts") {
      if (!this.selectedLayoutId) {
        return undefined;
      }
      return await fetchLayoutPreview(
        this.project.id,
        this.selectedLayoutId,
        undefined,
        this.projectWithPreviewThemeForLayout(this.selectedLayoutId),
        this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id
      );
    }
    if (this.activePage === "widgets") {
      const definition = this.selectedWidgetDefinition;
      if (!definition?.rootNode) {
        return undefined;
      }
      const displayTypeId = this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id;
      if (!displayTypeId) {
        return undefined;
      }
      const tempLayoutId = "__widget-preview-layout";
      const tempProject = this.widgetPreviewProject(definition, displayTypeId);
      return await fetchLayoutPreview(this.project.id, tempLayoutId, undefined, tempProject, displayTypeId);
    }
    if (this.activePage === "themes") {
      const theme = this.selectedTheme;
      const displayTypeId = this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id;
      if (!theme || !displayTypeId) {
        return undefined;
      }
      return await fetchThemePreview(this.project.id, theme.id, displayTypeId, this.project);
    }
    return undefined;
  }

  private navigate(page: PageId): void {
    window.location.hash = pageToRoute(page);
  }

  private removeDisplay(displayId: string): void {
    this.replaceProject({
      ...this.project,
      devices: (this.project.devices ?? []).filter((entry) => entry.id !== displayId),
      deviceAssignments: (this.project.deviceAssignments ?? []).filter((entry) => entry.displayId !== displayId)
    });
    if (this.selectedDisplayId === displayId) {
      this.selectedDisplayId = this.project.devices?.find((entry) => entry.id !== displayId)?.id ?? "";
    }
  }

  private removeDisplayType(displayTypeId: string): void {
    const removedDeviceIds = new Set((this.project.devices ?? []).filter((entry) => entry.displayTypeId === displayTypeId).map((entry) => entry.id));
    this.replaceProject({
      ...this.project,
      displayTypes: (this.project.displayTypes ?? []).filter((entry) => entry.id !== displayTypeId),
      devices: (this.project.devices ?? []).filter((entry) => entry.displayTypeId !== displayTypeId),
      deviceAssignments: (this.project.deviceAssignments ?? []).filter((entry) => !removedDeviceIds.has(entry.displayId))
    });
    if (this.selectedDisplayTypeId === displayTypeId) {
      this.selectedDisplayTypeId = this.project.displayTypes?.find((entry) => entry.id !== displayTypeId)?.id ?? "";
    }
  }

  private removeWidgetDefinition(definitionId: string): void {
    this.replaceProject({
      ...this.project,
      widgetDefinitions: (this.project.widgetDefinitions ?? [])
        .filter((entry) => entry.id !== definitionId)
        .map((entry) => ({
          ...entry,
          rootNode: entry.rootNode ? stripCompoundRefs(entry.rootNode, definitionId) ?? emptyStackRoot() : entry.rootNode
        })),
      layoutDefinitions: (this.project.layoutDefinitions ?? []).map((layout) => ({
        ...layout,
        rootNode: layout.rootNode ? stripCompoundRefs(layout.rootNode, definitionId) ?? emptyStackRoot() : layout.rootNode
      }))
    });
  }

  private removeLayout(layoutId: string): void {
    this.replaceProject({
      ...this.project,
      layoutDefinitions: (this.project.layoutDefinitions ?? []).filter((entry) => entry.id !== layoutId),
      deviceAssignments: (this.project.deviceAssignments ?? []).map((assignment) => ({
        ...assignment,
        defaultFullscreenLayoutId: assignment.defaultFullscreenLayoutId === layoutId ? undefined : assignment.defaultFullscreenLayoutId,
        fullscreenRules: assignment.fullscreenRules.filter((rule) => rule.action.type !== "activate_fullscreen_layout" || rule.action.layoutId !== layoutId),
        popupRules: assignment.popupRules.filter((rule) => rule.action.type !== "activate_popup_layout" || rule.action.layoutId !== layoutId)
      }))
    });
  }

  private removeTheme(themeId: string): void {
    const remainingThemes = this.project.themes.filter((entry) => entry.id !== themeId);
    this.replaceProject({
      ...this.project,
      themes: remainingThemes.length ? remainingThemes : [defaultTheme()],
      widgetDefinitions: (this.project.widgetDefinitions ?? []).map((definition) => ({
        ...definition,
        rootNode: definition.rootNode ? clearThemeRefs(definition.rootNode, themeId) : definition.rootNode
      })),
      layoutDefinitions: (this.project.layoutDefinitions ?? []).map((layout) => ({
        ...layout,
        rootNode: layout.rootNode ? clearThemeRefs(layout.rootNode, themeId) : layout.rootNode
      })),
      deviceAssignments: (this.project.deviceAssignments ?? []).map((assignment) => ({
        ...assignment,
        defaultThemeId: assignment.defaultThemeId === themeId ? undefined : assignment.defaultThemeId
      }))
    });
  }

  private removeAssignment(assignmentId: string): void {
    this.replaceProject({
      ...this.project,
      deviceAssignments: (this.project.deviceAssignments ?? []).filter((entry) => entry.id !== assignmentId)
    });
  }

  private async discoverDisplays(): Promise<void> {
    this.discoveredDisplays = await fetchDiscoveredDisplays(this.project.id);
  }

  private addDiscoveredDisplay(candidate: DiscoveredDisplayCandidate): void {
    const existingSuggestedDisplayTypeId =
      candidate.suggestedDisplayTypeId && this.project.displayTypes?.some((entry) => entry.id === candidate.suggestedDisplayTypeId)
        ? candidate.suggestedDisplayTypeId
        : undefined;
    const createdDisplayType =
      !existingSuggestedDisplayTypeId && candidate.suggestedDisplayType
        ? candidate.suggestedDisplayType
        : undefined;
    const displayTypeId =
      existingSuggestedDisplayTypeId ??
      createdDisplayType?.id ??
      this.project.displayTypes?.[0]?.id;
    if (!displayTypeId) {
      return;
    }
    const device: ManagedDisplay = {
      id: nextId("display"),
      name: candidate.name,
      providerKind: candidate.providerKind,
      providerRef: candidate.providerRef,
      displayProviderInstanceId: candidate.providerInstanceId,
      providerDeviceRef: candidate.providerDeviceRef,
      displayTypeId,
      managed: true,
      virtual: candidate.providerId === "virtual" || candidate.providerKind === "virtual",
      metadata: candidate.metadata
    };
    this.replaceProject({
      ...this.project,
      displayTypes: createdDisplayType
        ? [...(this.project.displayTypes ?? []), createdDisplayType]
        : this.project.displayTypes,
      devices: [...(this.project.devices ?? []), device],
      deviceAssignments: [
        ...(this.project.deviceAssignments ?? []),
        defaultAssignment(device.id, this.project.layoutDefinitions?.find((entry) => entry.kind === "fullscreen")?.id)
      ]
    });
    this.selectedDisplayId = device.id;
  }

  private updateDisplay(id: string, patch: Partial<ManagedDisplay>): void {
    this.replaceProject({
      ...this.project,
      devices: (this.project.devices ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    });
  }

  private updateDisplayDisplayType(id: string, displayTypeId: string): void {
    this.replaceProject({
      ...this.project,
      devices: (this.project.devices ?? []).map((entry) => (entry.id === id ? { ...entry, displayTypeId } : entry))
    });
  }

  private addDisplayType(): void {
    const displayType = defaultDisplayType();
    this.replaceProject({
      ...this.project,
      displayTypes: [...(this.project.displayTypes ?? []), displayType]
    });
    this.selectedDisplayTypeId = displayType.id;
  }

  private updateDisplayType(id: string, patch: Partial<DisplayType>): void {
    this.replaceProject({
      ...this.project,
      displayTypes: (this.project.displayTypes ?? []).map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
    });
  }

  private addCompoundWidget(): void {
    const definition = defaultCompoundWidget();
    this.replaceProject({
      ...this.project,
      widgetDefinitions: [...(this.project.widgetDefinitions ?? []), definition]
    });
    this.selectedWidgetDefinitionId = definition.id;
  }

  private updateWidgetDefinition(id: string, updater: (definition: WidgetDefinition) => WidgetDefinition): void {
    this.replaceProject({
      ...this.project,
      widgetDefinitions: (this.project.widgetDefinitions ?? []).map((entry) => (entry.id === id ? updater(entry) : entry))
    });
  }

  private addLayout(): void {
    const layout = defaultLayout();
    this.replaceProject({
      ...this.project,
      layoutDefinitions: [...(this.project.layoutDefinitions ?? []), layout]
    });
    this.selectedLayoutId = layout.id;
  }

  private updateLayout(id: string, updater: (layout: LayoutDefinition) => LayoutDefinition): void {
    this.replaceProject({
      ...this.project,
      layoutDefinitions: (this.project.layoutDefinitions ?? []).map((entry) => (entry.id === id ? updater(entry) : entry))
    });
  }

  private addTheme(): void {
    const theme = defaultTheme();
    this.replaceProject({
      ...this.project,
      themes: [...this.project.themes, theme]
    });
    this.selectedThemeId = theme.id;
  }

  private updateTheme(id: string, updater: (theme: WidgetTheme) => WidgetTheme): void {
    this.replaceProject({
      ...this.project,
      themes: this.project.themes.map((entry) => (entry.id === id ? updater(entry) : entry))
    });
  }

  private updateAssignment(id: string, updater: (assignment: DeviceAssignment) => DeviceAssignment): void {
    this.replaceProject({
      ...this.project,
      deviceAssignments: (this.project.deviceAssignments ?? []).map((entry) => (entry.id === id ? updater(entry) : entry))
    });
  }

  private addAssignment(displayId = this.selectedDisplayId || this.project.devices?.[0]?.id): void {
    if (!displayId) {
      return;
    }
    const layoutId = this.project.layoutDefinitions?.find((entry) => entry.kind === "fullscreen")?.id;
    const assignment = defaultAssignment(displayId, layoutId);
    this.replaceProject({
      ...this.project,
      deviceAssignments: [...(this.project.deviceAssignments ?? []), assignment]
    });
    this.selectedAssignmentId = assignment.id;
  }

  private addCompoundInput(definitionId: string): void {
    this.updateWidgetDefinition(definitionId, (definition) => ({
      ...definition,
      inputSchema: [
        ...definition.inputSchema,
        {
          id: nextId("input"),
          name: "New Input",
          valueType: "string",
          previewValue: ""
        }
      ]
    }));
  }

  private updateRootNode(owner: { id: string; rootNode?: LayoutNode }, updater: (root: LayoutNode) => LayoutNode): void {
    if ("kind" in owner) {
      this.updateLayout(owner.id, (layout) => ({
        ...layout,
        rootNode: layout.rootNode ? updater(layout.rootNode) : defaultRootNode("stack")
      }));
      return;
    }
    this.updateWidgetDefinition(owner.id, (definition) => ({
      ...definition,
      rootNode: definition.rootNode ? updater(definition.rootNode) : defaultRootNode("stack")
    }));
  }

  private setRootNode(owner: { id: string; rootNode?: LayoutNode }, rootNode: LayoutNode | undefined): void {
    if ("kind" in owner) {
      this.updateLayout(owner.id, (layout) => ({ ...layout, rootNode }));
      return;
    }
    this.updateWidgetDefinition(owner.id, (definition) => ({ ...definition, rootNode }));
  }

  private selectNode(nodeId: string): void {
    this.selectedNodeId = nodeId;
    this.createChildTargetNodeId = "";
  }

  private structurePreviewCoords(event: PointerEvent, target: HTMLElement): { x: number; y: number } {
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(event.clientX - rect.left + target.scrollLeft)),
      y: Math.max(0, Math.floor(event.clientY - rect.top + target.scrollTop))
    };
  }

  private structureHitNode(event: PointerEvent, target: HTMLElement): LayoutInspectionNode | undefined {
    const { x, y } = this.structurePreviewCoords(event, target);
    const root = this.structurePreviewRoot();
    return findInspectionNodeAtPoint(root, x, y);
  }

  private handleStructurePointerDown(event: PointerEvent): void {
    const owner = this.editorOwner;
    const target = event.currentTarget as HTMLElement;
    const hit = this.structureHitNode(event, target);
    if (!owner || !hit) {
      return;
    }
    this.selectNode(hit.nodeId);
    this.structureDraggedNodeId = hit.nodeId;
    this.draggedNodeId = hit.nodeId;
    this.structureDropIntent = null;
    this.structureHoveredNodeId = hit.nodeId;
    target.setPointerCapture?.(event.pointerId);
  }

  private handleStructurePointerMove(event: PointerEvent): void {
    const owner = this.editorOwner;
    const target = event.currentTarget as HTMLElement;
    const hit = this.structureHitNode(event, target);
    this.structureHoveredNodeId = hit?.nodeId ?? "";
    if (!owner?.rootNode || !this.structureDraggedNodeId) {
      return;
    }
    const { x, y } = this.structurePreviewCoords(event, target);
    const root = this.structurePreviewRoot();
    const intent = deriveStructureDropIntent(root, this.structureDraggedNodeId, x, y);
    if (
      intent &&
      (intent.parentId === this.structureDraggedNodeId || isDescendant(owner.rootNode, this.structureDraggedNodeId, intent.parentId))
    ) {
      this.structureDropIntent = null;
      return;
    }
    this.structureDropIntent = intent;
  }

  private applyStructureDropIntent(owner: { id: string; rootNode?: LayoutNode }): void {
    if (!owner.rootNode || !this.structureDraggedNodeId || !this.structureDropIntent) {
      return;
    }
    if (this.structureDropIntent.parentId === this.structureDraggedNodeId) {
      return;
    }
    if (isDescendant(owner.rootNode, this.structureDraggedNodeId, this.structureDropIntent.parentId)) {
      return;
    }
    let nextRoot = owner.rootNode;
    if (this.structureDropIntent.kind === "into") {
      nextRoot = moveNode(owner.rootNode, this.structureDraggedNodeId, this.structureDropIntent.parentId);
    } else if (this.structureDropIntent.kind === "grid-cell") {
      nextRoot = moveNodeToGridCell(
        owner.rootNode,
        this.structureDraggedNodeId,
        this.structureDropIntent.parentId,
        this.structureDropIntent.row ?? 0,
        this.structureDropIntent.column ?? 0
      );
    } else if (this.structureDropIntent.targetNodeId) {
      nextRoot = this.structureDropIntent.kind === "before"
        ? moveNodeBefore(owner.rootNode, this.structureDraggedNodeId, this.structureDropIntent.parentId, this.structureDropIntent.targetNodeId)
        : moveNodeAfter(owner.rootNode, this.structureDraggedNodeId, this.structureDropIntent.parentId, this.structureDropIntent.targetNodeId);
    }
    this.setRootNode(owner, nextRoot);
    this.selectedNodeId = this.structureDraggedNodeId;
  }

  private handleStructurePointerUp(event: PointerEvent): void {
    const owner = this.editorOwner;
    const target = event.currentTarget as HTMLElement;
    if (owner && this.structureDropIntent) {
      this.applyStructureDropIntent(owner);
    }
    this.structureDraggedNodeId = "";
    this.draggedNodeId = "";
    this.structureDropIntent = null;
    target.releasePointerCapture?.(event.pointerId);
  }

  private handleStructurePointerLeave(): void {
    if (!this.structureDraggedNodeId) {
      this.structureHoveredNodeId = "";
    }
  }

  private deleteSelectedNode(owner: { id: string; rootNode?: LayoutNode }): void {
    if (!owner.rootNode || !this.selectedNodeId) {
      return;
    }
    if (owner.rootNode.id === this.selectedNodeId) {
      this.setRootNode(owner, undefined);
      this.selectedNodeId = "";
      return;
    }
    const parentId = parentIdForNode(owner.rootNode, this.selectedNodeId);
    const next = removeNode(owner.rootNode, this.selectedNodeId);
    this.setRootNode(owner, next.root);
    this.selectedNodeId = parentId ?? owner.rootNode.id;
  }

  private createChildNode(owner: { id: string; rootNode?: LayoutNode }, parentId: string, kind: NodeCreateKind): void {
    if (!owner.rootNode) {
      return;
    }
    const nextNode = defaultNodeForKind(kind, this.project);
    this.setRootNode(owner, appendChild(owner.rootNode, parentId, nextNode));
    this.selectedNodeId = nextNode.id;
  }

  private setMetaChildNode(
    owner: { id: string; rootNode?: LayoutNode },
    nodeId: string,
    child: LayoutNode | undefined
  ): void {
    this.updateRootNode(owner, (root) => updateNode(root, nodeId, (current) => {
      if (current.type === "data_query" || current.type === "filter" || current.type === "unique" || current.type === "foreach" || current.type === "script") {
        return {
          ...current,
          child
        };
      }
      return current;
    }));
    this.selectedNodeId = child?.id ?? nodeId;
  }

  private setConditionalBranchNode(
    owner: { id: string; rootNode?: LayoutNode },
    nodeId: string,
    branch: "thenChild" | "elseChild",
    child: LayoutNode | undefined
  ): void {
    this.updateRootNode(owner, (root) => updateNode(root, nodeId, (current) => (
      current.type === "if_else"
        ? {
            ...current,
            [branch]: child
          }
        : current
    )));
    this.selectedNodeId = child?.id ?? nodeId;
  }

  private updateProjectScripting(mutator: (current: NonNullable<Project["scripting"]>) => NonNullable<Project["scripting"]>): void {
    const current = this.project.scripting ?? { sharedSource: "", helpers: [], filters: [] };
    this.project = {
      ...this.project,
      scripting: mutator(current)
    };
  }

  private addScriptingLibraryEntry(kind: "helpers" | "filters"): void {
    this.updateProjectScripting((current) => ({
      ...current,
      [kind]: [...(current[kind] ?? []), { name: "", source: kind === "filters" ? "(value) => value" : "() => undefined" }]
    }));
  }

  private updateScriptingLibraryEntry(kind: "helpers" | "filters", index: number, field: "name" | "source", value: string): void {
    this.updateProjectScripting((current) => ({
      ...current,
      [kind]: (current[kind] ?? []).map((entry, entryIndex) => (
        entryIndex === index
          ? { ...entry, [field]: value }
          : entry
      ))
    }));
  }

  private removeScriptingLibraryEntry(kind: "helpers" | "filters", index: number): void {
    this.updateProjectScripting((current) => ({
      ...current,
      [kind]: (current[kind] ?? []).filter((_entry, entryIndex) => entryIndex !== index)
    }));
  }

  private addScriptBinding(owner: { id: string; rootNode?: LayoutNode }, nodeId: string): void {
    this.updateRootNode(owner, (root) => updateNode(root, nodeId, (current) => {
      if (current.type !== "script") {
        return current;
      }
      const bindingName = `value${Object.keys(current.bindings ?? {}).length + 1}`;
      return {
        ...current,
        bindings: {
          ...(current.bindings ?? {}),
          [bindingName]: ""
        }
      };
    }));
  }

  private removeScriptBinding(owner: { id: string; rootNode?: LayoutNode }, nodeId: string, bindingKey: string): void {
    this.updateRootNode(owner, (root) => updateNode(root, nodeId, (current) => {
      if (current.type !== "script") {
        return current;
      }
      const nextBindings = { ...(current.bindings ?? {}) };
      delete nextBindings[bindingKey];
      return {
        ...current,
        bindings: nextBindings
      };
    }));
  }

  private moveDraggedNodeToParent(owner: { id: string; rootNode?: LayoutNode }, targetParentId: string): void {
    if (!owner.rootNode || !this.draggedNodeId || this.draggedNodeId === targetParentId) {
      return;
    }
    const nextRoot = moveNode(owner.rootNode, this.draggedNodeId, targetParentId);
    this.setRootNode(owner, nextRoot);
    this.selectedNodeId = this.draggedNodeId;
    this.draggedNodeId = "";
  }

  private moveDraggedNodeAfter(owner: { id: string; rootNode?: LayoutNode }, targetParentId: string, targetNodeId: string): void {
    if (!owner.rootNode || !this.draggedNodeId || this.draggedNodeId === targetNodeId) {
      return;
    }
    const nextRoot = moveNodeAfter(owner.rootNode, this.draggedNodeId, targetParentId, targetNodeId);
    this.setRootNode(owner, nextRoot);
    this.selectedNodeId = this.draggedNodeId;
    this.draggedNodeId = "";
  }

  private removeCompoundInput(definitionId: string, inputId: string): void {
    this.updateWidgetDefinition(definitionId, (definition) => ({
      ...definition,
      inputSchema: definition.inputSchema.filter((entry) => entry.id !== inputId)
    }));
  }

  private removeAssignmentRule(assignmentId: string, ruleId: string, scope: "popupRules" | "fullscreenRules"): void {
    this.updateAssignment(assignmentId, (assignment) => ({
      ...assignment,
      [scope]: assignment[scope].filter((rule) => rule.id !== ruleId)
    }));
  }

  private providerDescriptor(providerId: string): ProviderDescriptor | undefined {
    return this.providerKinds.find((descriptor) => descriptor.id === providerId);
  }

  private providerInstancesByDomain(domain: "source" | "display"): ProviderInstance[] {
    return this.providerInstances.filter((instance) => this.providerDescriptor(instance.providerId)?.domain === domain);
  }

  private sourceProviderOptions(): ProviderInstance[] {
    return this.providerInstancesByDomain("source").filter((instance) => instance.enabled);
  }

  private createProviderDraft(providerId: string): void {
    const descriptor = this.providerDescriptor(providerId);
    if (!descriptor) {
      return;
    }
    const configFields = descriptor.configFields ?? [];
    this.providerInstances = [
      ...this.providerInstances,
      {
        id: nextId(`${providerId}-instance`),
        providerId,
        name: descriptor.label,
        enabled: true,
        config: {
          ...Object.fromEntries(
            configFields.map((field) => [field.key, field.defaultValue ?? (field.kind === "checkbox" ? false : "")])
          ),
          ...(providerId === "virtual"
            ? { virtualDisplays: [defaultVirtualDisplayDefinition(this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id || "")] }
            : {})
        }
      }
    ];
  }

  private async refreshProviderState(): Promise<void> {
    this.providerKinds = await fetchProviderKinds().catch(() => this.providerKinds);
    this.providerInstances = await fetchProviderInstances().catch(() => this.providerInstances);
  }

  private updateProviderInstanceDraft(instanceId: string, key: string, value: unknown): void {
    this.providerInstances = this.providerInstances.map((instance) =>
      instance.id === instanceId
        ? {
            ...instance,
            config: {
              ...instance.config,
              [key]: value
            }
          }
        : instance
    );
  }

  private async saveProvider(instanceId: string): Promise<void> {
    const instance = this.providerInstances.find((entry) => entry.id === instanceId);
    if (!instance) {
      return;
    }
    const descriptor = this.providerDescriptor(instance.providerId);
    let payload = instance;
    if ((descriptor?.configFields ?? []).some((field) => field.key === "token")) {
      const currentToken = String(instance.config.token ?? "");
      payload = {
        ...instance,
        config: {
          ...instance.config,
          token: currentToken === "********" ? "" : currentToken
        }
      };
    }
    await saveProviderInstance(payload);
    await this.refreshProviderState();
    const sourceProvider = this.activeSourceProviderInstance;
    this.entityCatalog = sourceProvider ? await fetchProviderEntities(sourceProvider.id).catch(() => this.entityCatalog) : [];
    await this.refreshPreview();
  }

  private async testProvider(instanceId: string): Promise<void> {
    this.providerStatuses = {
      ...this.providerStatuses,
      [instanceId]: await testProviderInstance(instanceId).catch((error) => ({
        ok: false,
        message: error instanceof Error ? error.message : "Provider test failed"
      }))
    };
  }

  private async deleteProvider(instanceId: string): Promise<void> {
    await deleteProviderInstance(instanceId);
    this.providerStatuses = Object.fromEntries(Object.entries(this.providerStatuses).filter(([key]) => key !== instanceId));
    await this.refreshProviderState();
    const sourceProvider = this.activeSourceProviderInstance;
    this.entityCatalog = sourceProvider ? await fetchProviderEntities(sourceProvider.id).catch(() => this.entityCatalog) : [];
    await this.refreshPreview();
  }

  private async forceSelectedAssignmentUpdate(): Promise<void> {
    const assignment = this.selectedDisplayAssignment;
    if (!assignment) {
      return;
    }
    this.uploadStatusMessage = "Forcing update...";
    try {
      const result: AssignmentForceUpdateResponse = await forceAssignmentUpdate(this.project.id, assignment.id, this.project);
      this.uploadStatusMessage = result.message + (result.hash ? ` hash ${result.hash}` : "");
      await this.refreshAssignmentSchedules().catch(() => undefined);
      await this.refreshDisplayUpdateLog().catch(() => undefined);
    } catch (error) {
      this.uploadStatusMessage = error instanceof Error ? error.message : "Forced update failed";
    }
  }

  private async uploadCurrentPreviewToTag(): Promise<void> {
    const mac = this.effectivePreviewTagMac;
    if (!mac || !this.previewWidth || !this.previewHeight || !this.previewPngBase64) {
      return;
    }
    this.uploadStatusMessage = "Uploading preview...";
    try {
      await uploadPreviewToOpenEpaperLinkAccessPoint(
        mac,
        this.previewWidth,
        this.previewHeight,
        this.previewPngBase64,
        0
      );
      this.uploadStatusMessage = `Uploaded preview to ${mac}`;
    } catch (error) {
      this.uploadStatusMessage = error instanceof Error ? error.message : "Preview upload failed";
    }
  }

  private async uploadFont(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (!files.length) {
      return;
    }
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      await importFont(file.name, btoa(binary));
    }
    this.fonts = await fetchFonts();
    this.ensureSelectedFontPreviewFamily();
    input.value = "";
    void this.refreshFontSpecimens();
  }

  private async rescanFontDirectory(): Promise<void> {
    this.fonts = await rescanFonts();
    this.ensureSelectedFontPreviewFamily();
    void this.refreshFontSpecimens();
  }

  private async saveFontAllowedSizes(fontId: string, rawValue: string): Promise<void> {
    await updateFontMetadata(fontId, parseAllowedPixelSizes(rawValue));
    this.fonts = await fetchFonts();
    void this.refreshFontSpecimens();
  }

  private async toggleFontAllowedSize(fontId: string, size: number, enabled: boolean): Promise<void> {
    const current = this.fonts.find((font) => font.id === fontId)?.allowedPixelSizes ?? [];
    const next = enabled
      ? Array.from(new Set([...current, size])).sort((left, right) => left - right)
      : current.filter((entry) => entry !== size);
    await updateFontMetadata(fontId, next);
    this.fonts = await fetchFonts();
    void this.refreshFontSpecimens();
  }

  private async removeFontOption(fontId: string): Promise<void> {
    await deleteFont(fontId);
    this.fonts = await fetchFonts();
    if (this.selectedFontPreviewFamilyId === fontId) {
      this.selectedFontPreviewFamilyId = this.fonts.find((font) => font.source === "user")?.id ?? "";
    }
    void this.refreshFontSpecimens();
    this.confirmDeleteFontId = "";
  }

  private get selectedDisplay(): ManagedDisplay | undefined {
    return this.visibleDisplays.find((entry) => entry.id === this.selectedDisplayId);
  }

  private get selectedDisplayType(): DisplayType | undefined {
    return this.project.displayTypes?.find((entry) => entry.id === this.selectedDisplayTypeId);
  }

  private get activeSourceProviderInstance(): ProviderInstance | undefined {
    return this.providerInstances.find((instance) => instance.id === (this.project.defaultSourceProviderInstanceId ?? "home-assistant-default"))
      ?? this.providerInstances.find((instance) => this.providerKinds.find((kind) => kind.id === instance.providerId)?.domain === "source" && instance.enabled);
  }

  private get activeDisplayProviderInstance(): ProviderInstance | undefined {
    return this.providerInstances.find((instance) => instance.providerId === "openepaperlink-ap" && instance.enabled);
  }

  private get visibleDisplays(): ManagedDisplay[] {
    return this.project.devices ?? [];
  }

  private get accessPointTagCandidates(): DiscoveredDisplayCandidate[] {
    return this.discoveredDisplays.filter((candidate) => candidate.providerId === "openepaperlink-ap");
  }

  private get discoveredDisplayCandidates(): DiscoveredDisplayCandidate[] {
    return this.discoveredDisplays;
  }

  private get previewUploadCandidates(): DiscoveredDisplayCandidate[] {
    const matches = this.accessPointTagCandidates.filter((candidate) => {
      const displayType = candidate.suggestedDisplayType;
      return displayType?.width === this.previewWidth && displayType?.height === this.previewHeight;
    });
    return matches.length ? matches : this.accessPointTagCandidates;
  }

  private get effectivePreviewTagMac(): string {
    const options = this.previewUploadCandidates;
    const selected = this.selectedPreviewTagMac;
    const defaultMac = String(this.activeDisplayProviderInstance?.config.defaultTestDisplayMac ?? "");
    if (selected && options.some((candidate) => candidateMac(candidate) === selected)) {
      return selected;
    }
    if (defaultMac && options.some((candidate) => candidateMac(candidate) === defaultMac)) {
      return defaultMac;
    }
    return options[0] ? candidateMac(options[0]) : "";
  }

  private get selectedWidgetDefinition(): WidgetDefinition | undefined {
    return this.project.widgetDefinitions?.find((entry) => entry.id === this.selectedWidgetDefinitionId);
  }

  private get selectedLayout(): LayoutDefinition | undefined {
    return this.project.layoutDefinitions?.find((entry) => entry.id === this.selectedLayoutId);
  }

  private get selectedTheme(): WidgetTheme | undefined {
    return this.project.themes.find((entry) => entry.id === this.selectedThemeId);
  }

  private get selectedDisplayAssignment(): DeviceAssignment | undefined {
    return this.project.deviceAssignments?.find((entry) => entry.displayId === this.selectedDisplayId);
  }

  private get selectedDisplayAssignmentStatus(): AssignmentScheduleStatusResponse | undefined {
    const assignment = this.selectedDisplayAssignment;
    return assignment ? this.assignmentScheduleStatuses[assignment.id] : undefined;
  }

  private managedDisplayForCandidate(candidate: DiscoveredDisplayCandidate): ManagedDisplay | undefined {
    const candidateRef = String(candidate.providerDeviceRef ?? candidate.providerRef ?? "");
    const candidateMacKey = normalizedMac(candidateMac(candidate));
    return (this.project.devices ?? []).find((display) => {
      if ((display.displayProviderInstanceId ?? "") !== candidate.providerInstanceId) {
        return false;
      }
      if (candidateRef && (display.providerDeviceRef ?? display.providerRef) === candidateRef) {
        return true;
      }
      return Boolean(candidateMacKey) && normalizedMac(displayMac(display)) === candidateMacKey;
    });
  }

  private formatScheduleTimestamp(value: string | undefined): string {
    if (!value) {
      return "never";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString();
  }

  private formatUpdateLogTime(entry: AssignmentUpdateLogEntry): string {
    const parsed = new Date(entry.timestamp);
    return Number.isNaN(parsed.getTime()) ? entry.timestamp : parsed.toLocaleString();
  }

  private get effectivePreviewThemeId(): string | undefined {
    return this.project.themes.find((entry) => entry.id === this.selectedPreviewThemeId)?.id
      ?? this.project.themes[0]?.id;
  }

  private get editorOwner(): WidgetDefinition | LayoutDefinition | undefined {
    if (this.activePage === "widgets") {
      return this.selectedWidgetDefinition;
    }
    if (this.activePage === "layouts") {
      return this.selectedLayout;
    }
    return undefined;
  }

  private get editorRootNode(): LayoutNode | undefined {
    return this.editorOwner?.rootNode;
  }

  private get selectedEditorNode(): LayoutNode | undefined {
    return getNodeById(this.editorRootNode, this.selectedNodeId);
  }

  private renderNavigation() {
    return html`
      <nav>
        <h1>InkFrame Studio</h1>
        ${PAGE_ORDER.map(
          (page) => html`
            <button class="nav-button ${this.activePage === page ? "active" : ""}" @click=${() => this.navigate(page)}>
              ${PAGE_LABELS[page]}
            </button>
          `
        )}
        <div class="section">
          <h3>Project</h3>
          <div class="muted">${this.project.name}</div>
          <div class="muted">v${this.project.version}</div>
          <button class="primary" @click=${() => void this.persistProject()}>Save project</button>
        </div>
      </nav>
    `;
  }

  private renderListPanel() {
    if (this.activePage === "displays") {
      return html`
        <div class="section">
          <h2>Displays</h2>
          ${this.visibleDisplays.map(
            (device) => html`
              <div class="row">
                <button class="item-button ${device.id === this.selectedDisplayId ? "active" : ""}" @click=${() => {
                  this.selectedDisplayId = device.id;
                  this.selectedAssignmentId = this.project.deviceAssignments?.find((entry) => entry.displayId === device.id)?.id ?? "";
                  void this.refreshDisplayUpdateLog();
                  void this.refreshPreview();
                }}>${displayTitle(device)}</button>
              </div>
            `
          )}
        </div>
        <div class="section">
          <div class="row">
            <h3>Discovered</h3>
            <button @click=${() => void this.discoverDisplays()}>Refresh</button>
          </div>
          ${this.discoveredDisplayCandidates.map(
            (candidate) => {
              const managedDisplay = this.managedDisplayForCandidate(candidate);
              return html`
                <details>
                  <summary>${discoveredDisplayTitle(candidate)}</summary>
                  <div class="muted">${candidate.providerKind} ${candidate.discoverySource ? `(${candidate.discoverySource})` : ""}</div>
                  ${managedDisplay
                    ? html`<div class="muted">Already managed as ${displayTitle(managedDisplay)}</div>`
                    : html`<button @click=${() => this.addDiscoveredDisplay(candidate)}>Manage device</button>`}
                </details>
              `;
            }
          )}
        </div>
      `;
    }
    if (this.activePage === "widgets") {
      return html`
        <div class="section">
          <h2>Built-in</h2>
          ${BUILT_IN_WIDGET_DEFINITIONS.map((definition) => html`<div class="pill">${definition.name}</div>`)}
        </div>
        <div class="section">
          <h2>Compound Widgets</h2>
          <button @click=${() => this.addCompoundWidget()}>Add compound</button>
          ${(this.project.widgetDefinitions ?? [])
            .filter((entry) => entry.kind === "compound")
            .map(
              (definition) => html`
                <div class="row">
                  <button class="item-button ${definition.id === this.selectedWidgetDefinitionId ? "active" : ""}" @click=${() => {
                    this.selectedWidgetDefinitionId = definition.id;
                    void this.refreshPreview();
                  }}>${definition.name}</button>
                </div>
              `
            )}
        </div>
      `;
    }
    if (this.activePage === "layouts") {
      return html`
        <div class="section">
          <h2>Layouts</h2>
          <button @click=${() => this.addLayout()}>Add layout</button>
          ${(this.project.layoutDefinitions ?? []).map(
            (layout) => html`
              <div class="row">
                <button class="item-button ${layout.id === this.selectedLayoutId ? "active" : ""}" @click=${() => {
                  this.selectedLayoutId = layout.id;
                  void this.refreshPreview();
                }}>${layout.name}</button>
              </div>
            `
          )}
        </div>
      `;
    }
    if (this.activePage === "themes") {
      return html`
        <div class="section">
          <h2>Themes</h2>
          <button @click=${() => this.addTheme()}>Add theme</button>
          ${this.project.themes.map(
            (theme) => html`
              <div class="row">
                <button class="item-button ${theme.id === this.selectedThemeId ? "active" : ""}" @click=${() => {
                  this.selectedThemeId = theme.id;
                  void this.refreshPreview();
                }}>${theme.name}</button>
              </div>
            `
          )}
        </div>
      `;
    }
    if (this.activePage === "config") {
      return html`
        <div class="section">
          <h2>Config</h2>
          ${CONFIG_SECTIONS.map((section) => html`
            <div class="row">
              <button class="item-button ${section.id === this.activeConfigSection ? "active" : ""}" @click=${() => {
                this.activeConfigSection = section.id;
                if (section.id === "fonts") {
                  void this.refreshFontSpecimens();
                }
              }}>${section.label}</button>
            </div>
          `)}
        </div>
      `;
    }
    return html``;
  }

  private structureNodeClass(node: LayoutInspectionNode): string {
    const dropMatchesNode =
      this.structureDropIntent?.kind !== "grid-cell" &&
      (this.structureDropIntent?.targetNodeId === node.nodeId || this.structureDropIntent?.parentId === node.nodeId);
    return [
      "structure-node",
      node.isContainer ? "container" : "",
      this.selectedNodeId === node.nodeId ? "selected" : "",
      this.structureHoveredNodeId === node.nodeId ? "hovered" : "",
      dropMatchesNode ? "drop-target" : ""
    ].filter(Boolean).join(" ");
  }

  private structurePreviewVisualFrame(node: LayoutInspectionNode): { x: number; y: number; w: number; h: number } {
    return {
      x: node.frame.x,
      y: node.frame.y,
      w: node.frame.w,
      h: node.frame.h
    };
  }

  private structurePreviewRoot(): LayoutInspectionNode | undefined {
    const owner = this.editorOwner;
    const root = buildStructurePreviewTree(owner?.rootNode, labelForNode);
    return root ? translateStructurePreviewTree(root, STRUCTURE_PREVIEW_SIDE_PADDING, STRUCTURE_PREVIEW_TOP_PADDING) : undefined;
  }

  private renderStructureOverlayBoxes(node: LayoutInspectionNode, rootWidth: number, rootHeight: number, depth = 0): TemplateResult {
    const frame = this.structurePreviewVisualFrame(node);
    return html`
      <div
        class=${this.structureNodeClass(node)}
        style=${`left:${frame.x}px;top:${frame.y}px;width:${frame.w}px;height:${frame.h}px;z-index:${depth + 1};`}
      >
        <div class="structure-node-header">${node.label}</div>
      </div>
      ${node.gridCells?.map((cell) => html`
        <div
          class=${[
            "structure-cell",
            this.structureDropIntent?.kind === "grid-cell" &&
            this.structureDropIntent.parentId === node.nodeId &&
            this.structureDropIntent.row === cell.row &&
            this.structureDropIntent.column === cell.column
              ? "drop-target"
              : ""
          ].filter(Boolean).join(" ")}
          style=${`left:${cell.frame.x}px;top:${cell.frame.y}px;width:${cell.frame.w}px;height:${cell.frame.h}px;z-index:${depth + 2};`}
        ></div>
      `) ?? nothing}
      ${node.children.map((child) => this.renderStructureOverlayBoxes(child, rootWidth, rootHeight, depth + 1))}
    `;
  }

  private renderStructurePreviewStage(): TemplateResult {
    const root = this.structurePreviewRoot();
    if (!root) {
      return html`<div class="muted">No structure preview.</div>`;
    }
    const rootWidth = Math.max(1, root.frame.x + root.frame.w + STRUCTURE_PREVIEW_SIDE_PADDING);
    const rootHeight = Math.max(1, root.frame.y + root.frame.h + STRUCTURE_PREVIEW_BOTTOM_PADDING);
    return html`
      <div
        class="preview-stage structure-stage"
        @pointerdown=${(event: PointerEvent) => this.handleStructurePointerDown(event)}
        @pointermove=${(event: PointerEvent) => this.handleStructurePointerMove(event)}
        @pointerup=${(event: PointerEvent) => this.handleStructurePointerUp(event)}
        @pointercancel=${(event: PointerEvent) => this.handleStructurePointerUp(event)}
        @pointerleave=${() => this.handleStructurePointerLeave()}
      >
        <div class="structure-overlay" style=${`width:${rootWidth}px;height:${rootHeight}px;`}>
          ${this.renderStructureOverlayBoxes(root, rootWidth, rootHeight)}
        </div>
      </div>
    `;
  }

  private renderPreviewPanel() {
    const effectiveScale = this.previewCanvasScale();
    const uploadCandidates = this.previewUploadCandidates;
    const effectivePreviewTagMac = this.effectivePreviewTagMac;
    const cssPreviewWidth = Math.max(1, this.previewWidth * effectiveScale);
    const cssPreviewHeight = Math.max(1, this.previewHeight * effectiveScale);
    return html`
      <div class="section">
        <h2>Preview</h2>
        <div class="muted">hash ${this.previewHash || "n/a"}</div>
        ${this.previewMessage ? html`<div class="muted">${this.previewMessage}</div>` : nothing}
        ${this.previewWidth && this.previewHeight
          ? html`<div class="muted">${this.previewWidth}x${this.previewHeight}</div>`
          : nothing}
        <div class="row">
          <button @click=${() => void this.refreshPreview()}>Refresh preview</button>
          <label>
            Scale
            <select .value=${String(this.scale)} @change=${(event: Event) => (this.scale = Number((event.target as HTMLSelectElement).value))}>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="3">3x</option>
              <option value="4">4x</option>
              <option value="5">5x</option>
            </select>
          </label>
        </div>
        ${this.activePage === "widgets" || this.activePage === "themes"
          ? html`
              <label>
                Preview display type
                <select
                  .value=${this.selectedDisplayTypeId}
                  @change=${(event: Event) => {
                    this.selectedDisplayTypeId = (event.target as HTMLSelectElement).value;
                    void this.refreshPreview();
                  }}
                >
                  ${(this.project.displayTypes ?? []).map((displayType) => html`<option value=${displayType.id}>${displayType.name}</option>`)}
                </select>
              </label>
            `
          : nothing}
        ${this.activePage === "widgets" || this.activePage === "layouts"
          ? html`
              <label>
                Preview theme
                <select
                  .value=${this.effectivePreviewThemeId ?? ""}
                  @change=${(event: Event) => {
                    this.selectedPreviewThemeId = (event.target as HTMLSelectElement).value;
                    void this.refreshPreview();
                  }}
                >
                  ${this.project.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
                </select>
              </label>
            `
          : nothing}
        ${uploadCandidates.length
          ? html`
              <div class="row">
                <select
                  .value=${effectivePreviewTagMac}
                  @change=${(event: Event) => {
                    this.selectedPreviewTagMac = (event.target as HTMLSelectElement).value;
                  }}
                >
                  ${uploadCandidates.map((candidate) => {
                    const mac = candidateMac(candidate);
                    const displayType = candidate.suggestedDisplayType;
                    return html`
                      <option value=${mac}>
                        ${candidate.name} ${mac}${displayType ? ` (${displayType.width}x${displayType.height})` : ""}
                      </option>
                    `;
                  })}
                </select>
                <button class="primary" @click=${() => void this.uploadCurrentPreviewToTag()}>Send Preview</button>
              </div>
            `
          : html`<div class="muted">No AP tags for preview size.</div>`}
        ${this.uploadStatusMessage ? html`<div class="muted">${this.uploadStatusMessage}</div>` : nothing}
      </div>
      <div class="preview-body">
        ${this.previewWidth && this.previewHeight
          ? html`
              <div class="preview-stage" style=${`width:${cssPreviewWidth}px;height:${cssPreviewHeight}px;`}>
                <img
                  alt="Preview"
                  src=${`data:image/png;base64,${this.previewPngBase64}`}
                  style=${`width:${cssPreviewWidth}px;height:${cssPreviewHeight}px;image-rendering:pixelated;display:block;`}
                />
              </div>
            `
          : html`<div class="muted">No preview for this page.</div>`}
      </div>
    `;
  }

  private renderEntitySelector(
    value: string,
    onInput: (value: string) => void,
    extraOptions: Array<{ value: string; label: string }> = []
  ) {
    const listId = nextId("entities");
    return html`
      <input .value=${value} list=${listId} @input=${(event: Event) => onInput((event.target as HTMLInputElement).value)} />
      <datalist id=${listId}>
        ${extraOptions.map((entry) => html`<option value=${entry.value}>${entry.label}</option>`)}
        ${this.entityCatalog.map((entry) => html`<option value=${entry.entityId}>${entry.friendlyName}</option>`)}
      </datalist>
    `;
  }

  private entityInputBindingOptions(owner: { id: string }): Array<{ value: string; label: string }> {
    const definition = (this.project.widgetDefinitions ?? []).find((entry) => entry.id === owner.id && entry.kind === "compound");
    return (definition?.inputSchema ?? [])
      .filter((input) => input.valueType === "entity")
      .flatMap((input) => ([
        { value: `{{${input.name}}}`, label: `Widget input: ${input.name}` },
        { value: `{{${input.id}}}`, label: `Widget input id: ${input.id}` }
      ]));
  }

  private renderFontFamilyOptions(selected: string | undefined) {
    const options = this.fonts;
    return html`
      ${options.length
        ? options.map((font) => html`<option value=${font.id} ?selected=${selected === font.id}>${font.label}</option>`)
        : html`<option value="" ?selected=${!selected}>No fonts imported</option>`}
    `;
  }

  private fontAllowedPixelSizes(family: string | undefined): number[] {
    const allowed = this.fonts.find((font) => font.id === family)?.allowedPixelSizes ?? [];
    return [...allowed].sort((left, right) => left - right);
  }

  private renderFontPixelSizeControl(
    family: string | undefined,
    value: number,
    onChange: (pixelSize: number) => void
  ): TemplateResult {
    const allowedSizes = this.fontAllowedPixelSizes(family);
    if (allowedSizes.length) {
      const effective = allowedSizes.includes(value) ? value : allowedSizes[0]!;
      return html`
        <select .value=${String(effective)} @change=${(event: Event) => onChange(Number((event.target as HTMLSelectElement).value))}>
          ${allowedSizes.map((size) => html`<option value=${size}>${size}px</option>`)}
        </select>
      `;
    }
    return html`
      <input type="number" .value=${String(value)} @input=${(event: Event) => onChange(Number((event.target as HTMLInputElement).value))} />
    `;
  }

  private renderTextVariantControls(
    family: string | undefined,
    style: Partial<TextStyle> | undefined,
    onChange: (patch: Partial<TextStyle>) => void
  ): TemplateResult {
    const currentFamily = family ?? this.fonts[0]?.id ?? "arial";
    const currentWeight = style?.weight ?? "regular";
    const currentSlope = style?.slope ?? "roman";
    const variantStyles = availableFontVariants(this.fontOption(currentFamily)).map((variant) => {
      const [weight, slope] = variantKeyToStyle(variant);
      return { variant, weight, slope };
    });
    const weights = Array.from(new Set([
      currentWeight,
      ...variantStyles.filter((variant) => variant.slope === "roman").map((variant) => variant.weight)
    ]));
    const italicAvailable = this.fontVariantAvailable(currentFamily, currentWeight, "italic");
    const regularAvailable = this.fontVariantAvailable(currentFamily, currentWeight, "roman");
    return html`
      <label>
        Weight
        <select
          .value=${currentWeight}
          @change=${(event: Event) => {
            const nextWeight = (event.target as HTMLSelectElement).value as TextStyle["weight"];
            const nextSlope = this.fontVariantAvailable(currentFamily, nextWeight, currentSlope) ? currentSlope : "roman";
            onChange({ weight: nextWeight, slope: nextSlope });
          }}
        >
          ${weights.map((weight) => html`
            <option value=${weight} ?disabled=${!this.fontVariantAvailable(currentFamily, weight, "roman")}>${variantKeyLabel(weight)}</option>
          `)}
        </select>
      </label>
      <label>
        Slope
        <select
          .value=${regularAvailable ? currentSlope : "roman"}
          @change=${(event: Event) => onChange({ slope: (event.target as HTMLSelectElement).value as FontSlope })}
        >
          <option value="roman">Roman</option>
          <option value="italic" ?disabled=${!italicAvailable}>Italic</option>
        </select>
      </label>
      <label>
        Line spacing
        <input
          type="number"
          .value=${String(style?.lineSpacingPx ?? 0)}
          @input=${(event: Event) => onChange({ lineSpacingPx: Number((event.target as HTMLInputElement).value) })}
        />
      </label>
      <label>
        Top padding
        <input
          type="number"
          .value=${String(style?.topPaddingPx ?? 0)}
          @input=${(event: Event) => onChange({ topPaddingPx: Number((event.target as HTMLInputElement).value) })}
        />
      </label>
      <label>
        Color
        <select
          .value=${String(style?.colorRole ?? "fg")}
          @change=${(event: Event) => onChange({ colorRole: (event.target as HTMLSelectElement).value as TextStyle["colorRole"] })}
        >
          <option value="fg">${textColorRoleLabel("fg")}</option>
          <option value="bg">${textColorRoleLabel("bg")}</option>
          <option value="accent">${textColorRoleLabel("accent")}</option>
          <option value="transparent">${textColorRoleLabel("transparent")}</option>
        </select>
      </label>
    `;
  }

  private fontOption(id: string | undefined): FontOption | undefined {
    return this.fonts.find((font) => font.id === id);
  }

  private fontVariantAvailable(family: string | undefined, weight: TextStyle["weight"], slope: FontSlope): boolean {
    if (!family) {
      return false;
    }
    const option = this.fontOption(family);
    const variants = availableFontVariants(option);
    const variant: FontVariantKey =
      weight === "bold" && slope === "italic"
        ? "boldItalic"
        : weight === "bold"
          ? "bold"
          : weight !== "regular"
            ? (slope === "italic" ? `${weight}Italic` : weight)
            : slope === "italic"
              ? "italic"
              : "regular";
    return variants.includes(variant) || supportsFontVariant(family, weight, slope);
  }

  private coerceTextStyleVariant(style: Partial<TextStyle> | undefined): Partial<TextStyle> {
    const family = style?.family ?? this.fonts[0]?.id ?? "arial";
    const weight = style?.weight ?? "regular";
    const slope = style?.slope ?? "roman";
    if (this.fontVariantAvailable(family, weight, slope)) {
      return style ?? {};
    }
    return {
      ...style,
      slope: "roman"
    };
  }

  private previewCanvasScale(): number {
    const deviceScale = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    return this.scale / deviceScale;
  }

  private renderSizeSpecEditor(label: string, spec: SizeSpec | undefined, onChange: (next: SizeSpec) => void) {
    const current = spec?.mode === "intrinsic_font_height"
      ? { ...spec, mode: "fit_content" as SizeSpec["mode"] }
      : spec ?? defaultSizeSpec("fill");
    return html`
      <details>
        <summary>${label}</summary>
        <label>
          Mode
          <select .value=${current.mode} @change=${(event: Event) => onChange({ ...current, mode: (event.target as HTMLSelectElement).value as SizeSpec["mode"] })}>
            <option value="fill">Fill</option>
            <option value="fixed_px">Fixed px</option>
            <option value="fraction">Fraction</option>
            <option value="fit_content">Fit content</option>
            <option value="fit_glyph_bounds">Fit glyph bounds</option>
          </select>
        </label>
        ${current.mode === "fixed_px" || current.mode === "fraction"
          ? html`
              <label>
                Value
                <input type="number" step=${current.mode === "fraction" ? "0.1" : "1"} .value=${String(current.value ?? "")} @input=${(event: Event) => onChange({ ...current, value: Number((event.target as HTMLInputElement).value) })} />
              </label>
            `
          : nothing}
      </details>
    `;
  }

  private primitiveAutoFitDisabled(node: PrimitiveInstanceNode): boolean {
    return (
      node.width?.mode === "fit_content" ||
      node.height?.mode === "fit_content" ||
      node.width?.mode === "fit_glyph_bounds" ||
      node.height?.mode === "fit_glyph_bounds"
    );
  }

  private renderContentAlignmentControls(
    node: PrimitiveInstanceNode,
    owner: { id: string; rootNode?: LayoutNode },
    defaults: { horizontal: "left" | "center" | "right"; vertical: "top" | "middle" | "bottom" } = { horizontal: "center", vertical: "middle" }
  ): TemplateResult {
    return html`
      <label>
        Horizontal align
        <select .value=${String(node.props?.horizontalAlign ?? defaults.horizontal)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, horizontalAlign: (event.target as HTMLSelectElement).value as "left" | "center" | "right" } })))}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Vertical align
        <select .value=${String(node.props?.verticalAlign ?? defaults.vertical)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, verticalAlign: (event.target as HTMLSelectElement).value as "top" | "middle" | "bottom" } })))}>
          <option value="top">Top</option>
          <option value="middle">Middle</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
    `;
  }

  private renderPrimitiveEditor(node: PrimitiveInstanceNode, owner: { id: string; rootNode?: LayoutNode }): TemplateResult {
    const autoFitDisabled = this.primitiveAutoFitDisabled(node);
    const entityInputOptions = this.entityInputBindingOptions(owner);
    return html`
      <label>
        Primitive
        <select .value=${node.primitiveType} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), primitiveType: (event.target as HTMLSelectElement).value as PrimitiveWidgetKind })))}>
          ${BUILT_IN_WIDGET_DEFINITIONS.map((entry) => html`<option value=${entry.primitiveType ?? "text"}>${entry.name}</option>`)}
        </select>
      </label>
      <label>
        Content padding
        <input type="number" .value=${String(node.props?.paddingPx ?? node.style?.paddingPx ?? 4)} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, paddingPx: Number((event.target as HTMLInputElement).value) } })))}/>
      </label>
      ${node.primitiveType === "text"
        ? html`
            <label>
              Text
              <code-editor-field
                language="plaintext"
                min-lines="3"
                .value=${String(node.props?.text ?? "")}
                @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({
                  ...(current as PrimitiveInstanceNode),
                  props: { ...(current as PrimitiveInstanceNode).props, text: String((event.target as HTMLElement & { value?: string }).value ?? "") }
                })))}
              ></code-editor-field>
            </label>
            <div class="muted">Inputs in compound widgets: use <code>{{Input Name}}</code> or <code>\${Input Name}</code>.</div>
            <label>
              <input type="checkbox" .checked=${Boolean(node.props?.renderEntityState)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, renderEntityState: (event.target as HTMLInputElement).checked } })))} />
              Render entity state
            </label>
            <label>
              Entity
              ${this.renderEntitySelector(String(node.bindings?.entity ?? ""), (value) =>
                this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), bindings: { ...(current as PrimitiveInstanceNode).bindings, entity: value } })))
              , entityInputOptions)}
            </label>
            <label>
              <input type="checkbox" ?disabled=${autoFitDisabled} .checked=${Boolean(node.props?.autoFit)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, autoFit: (event.target as HTMLInputElement).checked } })))} />
              Auto fit
            </label>
            <label>
              Placeholder
              <input ?disabled=${autoFitDisabled} .value=${String(node.props?.placeholderText ?? "")} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, placeholderText: (event.target as HTMLInputElement).value } })))} />
            </label>
            <label>
              Overflow
              <select .value=${String(node.props?.overflow ?? "wrap")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, overflow: (event.target as HTMLSelectElement).value as "wrap" | "hide" | "ellipsis" } })))}>
                <option value="wrap">Wrap</option>
                <option value="hide">Hide</option>
                <option value="ellipsis">Ellipsis</option>
              </select>
            </label>
            ${autoFitDisabled ? html`<div class="muted">Auto fit unavailable when width or height uses Fit content.</div>` : nothing}
            <label>
              Theme font role
              <select .value=${String(node.props?.fontRole ?? "normal")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, fontRole: (event.target as HTMLSelectElement).value as FontRole } })))}>
                <option value="tiny">Tiny</option>
                <option value="normal">Normal</option>
                <option value="normalEmphasis">Normal emphasis</option>
                <option value="header">Header</option>
              </select>
            </label>
            ${this.renderContentAlignmentControls(node, owner, { horizontal: "left", vertical: "top" })}
          `
        : nothing}
      ${node.primitiveType === "number"
        ? html`
            <label>
              Entity
              ${this.renderEntitySelector(String(node.bindings?.entity ?? ""), (value) =>
                this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), bindings: { ...(current as PrimitiveInstanceNode).bindings, entity: value } })))
              , entityInputOptions)}
            </label>
            <label>
              Decimals
              <input type="number" .value=${String(node.props?.digits ?? 1)} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, digits: Number((event.target as HTMLInputElement).value) } })))} />
            </label>
            <label>
              Prefix
              <input .value=${String(node.props?.prefix ?? "")} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, prefix: (event.target as HTMLInputElement).value } })))} />
            </label>
            <label>
              Suffix
              <input .value=${String(node.props?.suffix ?? "")} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, suffix: (event.target as HTMLInputElement).value } })))} />
            </label>
            <label>
              <input type="checkbox" ?disabled=${autoFitDisabled} .checked=${Boolean(node.props?.autoFit)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, autoFit: (event.target as HTMLInputElement).checked } })))} />
              Auto fit
            </label>
            <label>
              Placeholder
              <input ?disabled=${autoFitDisabled} .value=${String(node.props?.placeholderValue ?? "")} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, placeholderValue: (event.target as HTMLInputElement).value } })))} />
            </label>
            ${autoFitDisabled ? html`<div class="muted">Auto fit unavailable when width or height uses Fit content.</div>` : nothing}
            <label>
              Theme font role
              <select .value=${String(node.props?.fontRole ?? "header")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, fontRole: (event.target as HTMLSelectElement).value as FontRole } })))}>
                <option value="tiny">Tiny</option>
                <option value="normal">Normal</option>
                <option value="normalEmphasis">Normal emphasis</option>
                <option value="header">Header</option>
              </select>
            </label>
            ${this.renderContentAlignmentControls(node, owner, { horizontal: "center", vertical: "middle" })}
          `
        : nothing}
      ${node.primitiveType === "icon"
        ? (() => {
            const selectedIconId = String(node.props?.icon ?? DEFAULT_ICON_ID);
            const iconOptions = this.filteredIcons(this.iconSearchQuery, selectedIconId);
            return html`
            <label>
              Icon search
              <input
                placeholder="triangle, github, warehouse..."
                .value=${this.iconSearchQuery}
                @input=${(event: Event) => {
                  this.iconSearchQuery = (event.target as HTMLInputElement).value;
                }}
              />
            </label>
            <label>
              Icon
              <select size="12" .value=${selectedIconId} @change=${(event: Event) => {
                const iconId = (event.target as HTMLSelectElement).value;
                this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, icon: iconId } })));
              }}>
                ${iconOptions.map((icon) => html`<option value=${icon.id}>${icon.pack ? `${icon.pack} · ` : ""}${icon.label} (${icon.id})</option>`)}
              </select>
            </label>
            ${this.renderContentAlignmentControls(node, owner, { horizontal: "center", vertical: "middle" })}
          `;
          })()
        : nothing}
      ${node.primitiveType === "state_tile"
        ? this.renderContentAlignmentControls(node, owner, { horizontal: "center", vertical: "middle" })
        : nothing}
      ${node.primitiveType === "graph" || node.primitiveType === "history_bars"
        ? html`
            <label>
              Query id
              <input .value=${String(node.bindings?.query ?? "")} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), bindings: { ...(current as PrimitiveInstanceNode).bindings, query: (event.target as HTMLInputElement).value } })))} />
            </label>
            <label>
              Fill color
              <select .value=${String(node.props?.colorRole ?? "accent")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, colorRole: (event.target as HTMLSelectElement).value as FillRole } })))}>
                <option value="fg">black</option>
                <option value="accent">accent</option>
                <option value="gray">gray</option>
                <option value="light-accent">light accent</option>
                <option value="dark-accent">dark accent</option>
              </select>
            </label>
          `
        : nothing}
      ${node.primitiveType === "line"
        ? html`
            <label>
              Direction
              <select .value=${String(node.props?.lineDirection ?? "horizontal")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, lineDirection: (event.target as HTMLSelectElement).value as "horizontal" | "vertical" | "diag_down" | "diag_up" } })))}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="diag_down">Diagonal down</option>
                <option value="diag_up">Diagonal up</option>
              </select>
            </label>
          `
        : nothing}
      ${node.primitiveType === "circle"
        ? html`
            <label>
              <input type="checkbox" .checked=${Boolean(node.props?.filled)} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as PrimitiveInstanceNode), props: { ...(current as PrimitiveInstanceNode).props, filled: (event.target as HTMLInputElement).checked } })))} />
              Filled
            </label>
          `
        : nothing}
    `;
  }

  private renderNodeEditor(node: LayoutNode, owner: { id: string; rootNode?: LayoutNode }, parentId?: string): TemplateResult {
    return html`
      <div class="inspector-panel">
        <div class="row">
          <strong>${node.type}</strong>
          <span class="muted">${node.id}</span>
        </div>
        <div class="row">
          ${parentId
            ? html`
                <button class="danger" @click=${() => this.deleteSelectedNode(owner)}>Delete node</button>
              `
            : html`<button class="danger" @click=${() => this.deleteSelectedNode(owner)}>Delete root node</button>`}
          ${isContainerNode(node)
            ? html`<button @click=${() => {
                this.createChildTargetNodeId = this.createChildTargetNodeId === node.id ? "" : node.id;
              }}>Create child</button>`
            : nothing}
        </div>
        ${this.createChildTargetNodeId === node.id
          ? html`
              <div class="row">
                <button @click=${() => this.createChildNode(owner, node.id, "text")}>Text</button>
                <button @click=${() => this.createChildNode(owner, node.id, "number")}>Number</button>
                <button @click=${() => this.createChildNode(owner, node.id, "graph")}>Graph</button>
                <button @click=${() => this.createChildNode(owner, node.id, "icon")}>Icon</button>
                <button @click=${() => this.createChildNode(owner, node.id, "line")}>Line</button>
                <button @click=${() => this.createChildNode(owner, node.id, "box")}>Box</button>
                <button @click=${() => this.createChildNode(owner, node.id, "circle")}>Circle</button>
                ${(this.project.widgetDefinitions ?? []).some((entry) => entry.kind === "compound")
                  ? html`<button @click=${() => this.createChildNode(owner, node.id, "compound_ref")}>Compound</button>`
                  : nothing}
                <button @click=${() => this.createChildNode(owner, node.id, "stack")}>Stack</button>
                <button @click=${() => this.createChildNode(owner, node.id, "grid")}>Grid</button>
                <button @click=${() => this.createChildNode(owner, node.id, "zstack")}>ZStack</button>
                <button @click=${() => this.createChildNode(owner, node.id, "data_query")}>Data Query</button>
                <button @click=${() => this.createChildNode(owner, node.id, "filter")}>Filter</button>
                <button @click=${() => this.createChildNode(owner, node.id, "unique")}>Unique</button>
                <button @click=${() => this.createChildNode(owner, node.id, "foreach")}>Foreach</button>
                <button @click=${() => this.createChildNode(owner, node.id, "script")}>Script</button>
                <button @click=${() => this.createChildNode(owner, node.id, "if_else")}>If/Else</button>
              </div>
            `
          : nothing}
        ${this.renderSizeSpecEditor("Width", node.width, (next) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, width: next }))))}
        ${this.renderSizeSpecEditor("Height", node.height, (next) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, height: next }))))}
        ${node.type === "primitive_instance"
          ? nothing
          : html`
              <label>
                Padding
                <input type="number" .value=${String(node.style?.paddingPx ?? 0)} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, style: { ...current.style, paddingPx: Number((event.target as HTMLInputElement).value) } })))} />
              </label>
            `}
        <label>
          Border token
          <select .value=${String(node.style?.borderToken ?? "none")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, style: { ...current.style, borderToken: (event.target as HTMLSelectElement).value as BorderToken } })))} }>
            <option value="none">None</option>
            <option value="thin">Thin</option>
            <option value="thick">Thick</option>
          </select>
        </label>
        <label>
          Theme override
          <select .value=${String(node.style?.themeId ?? "inherit")} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, style: { ...current.style, themeId: (event.target as HTMLSelectElement).value } })))} }>
            <option value="inherit">Inherit</option>
            ${this.project.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
          </select>
        </label>
        ${node.type === "stack" || node.type === "foreach"
          ? html`
              <label>
                Axis
                <select .value=${node.axis} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), axis: (event.target as HTMLSelectElement).value as "horizontal" | "vertical" })))} >
                  <option value="horizontal">HStack</option>
                  <option value="vertical">VStack</option>
                </select>
              </label>
              <label>
                Gap
                <input type="number" .value=${String(node.style?.gapPx ?? 0)} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...current, style: { ...current.style, gapPx: Number((event.target as HTMLInputElement).value) } })))} />
              </label>
            `
          : nothing}
        ${node.type === "zstack"
          ? html`
              <div class="muted">Children share same frame. Order is back to front.</div>
            `
          : nothing}
        ${node.type === "grid"
          ? html`
              <label>
                Rows
                <input type="number" min="1" .value=${String(node.rows.length)} @input=${(event: Event) => {
                  const count = Math.max(1, Number((event.target as HTMLInputElement).value));
                  this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({
                    ...(current as typeof node),
                    rows: Array.from({ length: count }, (_entry, index) => (current as typeof node).rows[index] ?? { size: defaultSizeSpec("fraction", 1 / count) })
                  })));
                }} />
              </label>
              <label>
                Columns
                <input type="number" min="1" .value=${String(node.columns.length)} @input=${(event: Event) => {
                  const count = Math.max(1, Number((event.target as HTMLInputElement).value));
                  this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({
                    ...(current as typeof node),
                    columns: Array.from({ length: count }, (_entry, index) => (current as typeof node).columns[index] ?? { size: defaultSizeSpec("fraction", 1 / count) })
                  })));
                }} />
              </label>
            `
          : nothing}
        ${node.type === "data_query"
          ? html`
              <label>
                Query kind
                <input .value=${node.queryKind} disabled />
              </label>
              <label>
                Variable name
                <input .value=${node.variableName} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), variableName: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Date variable name
                <input .value=${node.dateVariableName ?? "date"} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), dateVariableName: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Offset days from local midnight
                <input type="number" .value=${String(node.offsetDays ?? 0)} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), offsetDays: Number((event.target as HTMLInputElement).value) } )))} />
              </label>
              <label>
                Rollover time
                <input placeholder="23:00" .value=${node.rolloverTime ?? ""} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), rolloverTime: (event.target as HTMLInputElement).value || undefined } )))} />
              </label>
              <label>
                Calendar entities
                <select
                  multiple
                  size="6"
                  @change=${(event: Event) => {
                    const selected = Array.from((event.target as HTMLSelectElement).selectedOptions).map((option) => option.value);
                    this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), calendarEntityIds: selected } )));
                  }}
                >
                  ${this.entityCatalog
                    .filter((entry) => entry.domain === "calendar")
                    .map((entry) => html`<option value=${entry.entityId} ?selected=${node.calendarEntityIds.includes(entry.entityId)}>${entry.friendlyName}</option>`)}
                </select>
              </label>
              <div class="row">
                <button @click=${() => this.setMetaChildNode(owner, node.id, emptyStackRoot())}>${node.child ? "Replace" : "Add"} child stack</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultFilterNode())}>${node.child ? "Replace" : "Add"} filter</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultUniqueNode())}>${node.child ? "Replace" : "Add"} unique</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultScriptNode())}>${node.child ? "Replace" : "Add"} script</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultForEachNode())}>${node.child ? "Replace" : "Add"} foreach</button>
              </div>
              ${node.child ? nothing : html`<div class="muted">No child subtree.</div>`}
            `
          : nothing}
        ${node.type === "filter"
          ? html`
              <label>
                Items expression
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.itemsRef}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemsRef: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <label>
                Output variable
                <input .value=${node.outputVariableName} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), outputVariableName: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Item alias
                <input .value=${node.itemAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Index alias
                <input .value=${node.indexAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), indexAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Condition
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.condition}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), condition: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <div class="row">
                <button @click=${() => this.setMetaChildNode(owner, node.id, emptyStackRoot())}>${node.child ? "Replace" : "Add"} child stack</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultUniqueNode())}>${node.child ? "Replace" : "Add"} unique</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultScriptNode())}>${node.child ? "Replace" : "Add"} script</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultForEachNode())}>${node.child ? "Replace" : "Add"} foreach</button>
              </div>
              ${node.child ? nothing : html`<div class="muted">No child subtree.</div>`}
            `
          : nothing}
        ${node.type === "unique"
          ? html`
              <label>
                Items expression
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.itemsRef}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemsRef: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <label>
                Output variable
                <input .value=${node.outputVariableName} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), outputVariableName: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Item alias
                <input .value=${node.itemAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Index alias
                <input .value=${node.indexAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), indexAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Key template
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.keyTemplate}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), keyTemplate: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <div class="row">
                <button @click=${() => this.setMetaChildNode(owner, node.id, emptyStackRoot())}>${node.child ? "Replace" : "Add"} child stack</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultForEachNode())}>${node.child ? "Replace" : "Add"} foreach</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultScriptNode())}>${node.child ? "Replace" : "Add"} script</button>
              </div>
              ${node.child ? nothing : html`<div class="muted">No child subtree.</div>`}
            `
          : nothing}
        ${node.type === "foreach"
          ? html`
              <label>
                Items expression
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.itemsRef}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemsRef: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <label>
                Item alias
                <input .value=${node.itemAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), itemAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Index alias
                <input .value=${node.indexAlias} @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), indexAlias: (event.target as HTMLInputElement).value } )))} />
              </label>
              <label>
                Max items
                <input type="number" .value=${node.maxItems === undefined ? "" : String(node.maxItems)} @input=${(event: Event) => {
                  const value = (event.target as HTMLInputElement).value.trim();
                  this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), maxItems: value ? Number(value) : undefined } )));
                }} />
              </label>
              <div class="row">
                <button @click=${() => this.setMetaChildNode(owner, node.id, emptyStackRoot())}>${node.child ? "Replace" : "Add"} template stack</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultPrimitiveNode("text"))}>${node.child ? "Replace" : "Add"} template text</button>
              </div>
              ${node.child ? nothing : html`<div class="muted">No template child.</div>`}
            `
          : nothing}
        ${node.type === "script"
          ? html`
              <div class="muted">Returns object merged into child scope. Globals: now, today, locale, display, project.</div>
              <label>
                Source
                <code-editor-field
                  language="javascript"
                  min-lines="8"
                  .value=${node.source}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), source: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <label>
                Output mode
                <input .value=${node.outputMode} disabled />
              </label>
              <div class="section-title">Bindings</div>
              ${Object.entries(node.bindings ?? {}).map(([key, expression]) => html`
                <div class="row">
                  <input
                    placeholder="name"
                    .value=${key}
                    @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => {
                      if (current.type !== "script") {
                        return current;
                      }
                      const nextBindings = Object.fromEntries(
                        Object.entries(current.bindings ?? {}).map(([entryKey, entryValue]) => (
                          entryKey === key
                            ? [(event.target as HTMLInputElement).value, entryValue]
                            : [entryKey, entryValue]
                        ))
                      );
                      return { ...current, bindings: nextBindings };
                    }))}
                  />
                  <code-editor-field
                    language="plaintext"
                    single-line
                    placeholder="scope expression"
                    .value=${String(expression)}
                    @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => {
                      if (current.type !== "script") {
                        return current;
                      }
                      return {
                        ...current,
                        bindings: {
                          ...(current.bindings ?? {}),
                          [key]: String((event.target as HTMLElement & { value?: string }).value ?? "")
                        }
                      };
                    }))}
                  ></code-editor-field>
                  <button @click=${() => this.removeScriptBinding(owner, node.id, key)}>Remove</button>
                </div>
              `)}
              <div class="row">
                <button @click=${() => this.addScriptBinding(owner, node.id)}>Add binding</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, emptyStackRoot())}>${node.child ? "Replace" : "Add"} child stack</button>
                <button @click=${() => this.setMetaChildNode(owner, node.id, defaultPrimitiveNode("text"))}>${node.child ? "Replace" : "Add"} child text</button>
              </div>
              ${node.child ? nothing : html`<div class="muted">No child subtree.</div>`}
            `
          : nothing}
        ${node.type === "if_else"
          ? html`
              <label>
                Condition
                <code-editor-field
                  language="plaintext"
                  single-line
                  .value=${node.condition}
                  @input=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), condition: String((event.target as HTMLElement & { value?: string }).value ?? "") } )))}
                ></code-editor-field>
              </label>
              <div class="row">
                <button @click=${() => this.setConditionalBranchNode(owner, node.id, "thenChild", emptyStackRoot())}>${node.thenChild ? "Replace" : "Add"} then</button>
                <button @click=${() => this.setConditionalBranchNode(owner, node.id, "elseChild", emptyStackRoot())}>${node.elseChild ? "Replace" : "Add"} else</button>
              </div>
              <div class="row">
                <button @click=${() => this.setConditionalBranchNode(owner, node.id, "thenChild", defaultPrimitiveNode("text"))}>Then text</button>
                <button @click=${() => this.setConditionalBranchNode(owner, node.id, "elseChild", defaultPrimitiveNode("text"))}>Else text</button>
              </div>
              ${!node.thenChild && !node.elseChild ? html`<div class="muted">No branches yet.</div>` : nothing}
            `
          : nothing}
        ${node.type === "primitive_instance" ? this.renderPrimitiveEditor(node, owner) : nothing}
        ${node.type === "compound_ref"
          ? html`
              <label>
                Compound widget
                <select .value=${node.definitionId} @change=${(event: Event) => this.updateRootNode(owner, (root) => updateNode(root, node.id, (current) => ({ ...(current as typeof node), definitionId: (event.target as HTMLSelectElement).value })))} >
                  ${(this.project.widgetDefinitions ?? [])
                    .filter((entry) => entry.kind === "compound")
                    .map((entry) => html`<option value=${entry.id}>${entry.name}</option>`)}
                </select>
              </label>
              ${(() => {
                const definition = (this.project.widgetDefinitions ?? []).find((entry) => entry.id === node.definitionId && entry.kind === "compound");
                if (!definition?.inputSchema.length) {
                  return html`<div class="muted">No inputs.</div>`;
                }
                return html`
                  <div class="section">
                    <h4>Inputs</h4>
                    ${definition.inputSchema.map((input) => html`
                      <details open>
                        <summary>${input.name}</summary>
                        ${input.valueType === "entity"
                          ? html`
                              <label>
                                Entity
                                ${this.renderEntitySelector(String(node.inputBindings?.[input.id] ?? node.inputBindings?.[input.name] ?? ""), (value) =>
                                  this.updateRootNode(owner, (root) =>
                                    updateNode(root, node.id, (current) => ({
                                      ...(current as typeof node),
                                      inputBindings: {
                                        ...((current as typeof node).inputBindings ?? {}),
                                        [input.id]: value
                                      }
                                    }))
                                  )
                                )}
                              </label>
                            `
                          : nothing}
                        ${input.valueType === "string"
                          ? html`
                              <label>
                                Value
                                <input .value=${String(node.inputValues?.[input.id] ?? input.defaultValue ?? "")} @input=${(event: Event) =>
                                  this.updateRootNode(owner, (root) =>
                                    updateNode(root, node.id, (current) => ({
                                      ...(current as typeof node),
                                      inputValues: {
                                        ...((current as typeof node).inputValues ?? {}),
                                        [input.id]: (event.target as HTMLInputElement).value
                                      }
                                    }))
                                  )} />
                              </label>
                            `
                          : nothing}
                        ${input.valueType === "number"
                          ? html`
                              <label>
                                Value
                                <input type="number" .value=${String(node.inputValues?.[input.id] ?? input.defaultValue ?? 0)} @input=${(event: Event) =>
                                  this.updateRootNode(owner, (root) =>
                                    updateNode(root, node.id, (current) => ({
                                      ...(current as typeof node),
                                      inputValues: {
                                        ...((current as typeof node).inputValues ?? {}),
                                        [input.id]: Number((event.target as HTMLInputElement).value)
                                      }
                                    }))
                                  )} />
                              </label>
                            `
                          : nothing}
                        ${input.valueType === "boolean"
                          ? html`
                              <label>
                                Value
                                <select .value=${String(node.inputValues?.[input.id] ?? input.defaultValue ?? false)} @change=${(event: Event) =>
                                  this.updateRootNode(owner, (root) =>
                                    updateNode(root, node.id, (current) => ({
                                      ...(current as typeof node),
                                      inputValues: {
                                        ...((current as typeof node).inputValues ?? {}),
                                        [input.id]: (event.target as HTMLSelectElement).value === "true"
                                      }
                                    }))
                                  )}>
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                              </label>
                            `
                          : nothing}
                      </details>
                    `)}
                  </div>
                `;
              })()}
            `
          : nothing}
        ${node.type === "grid" && parentId
          ? html`
              ${(() => {
                const root = owner.rootNode;
                const gridParent = root ? getNodeById(root, parentId) : undefined;
                if (!gridParent || gridParent.type !== "grid") {
                  return nothing;
                }
                const child = gridParent.children.find((entry) => entry.node.id === node.id);
                if (!child) {
                  return nothing;
                }
                return html`
                  <label>
                    Grid row
                    <input type="number" .value=${String(child.placement.row)} @input=${(event: Event) =>
                      this.updateRootNode(owner, (rootNode) => updateNode(rootNode, parentId, (current) => ({
                        ...(current as typeof gridParent),
                        children: (current as typeof gridParent).children.map((entry) =>
                          entry.node.id === node.id ? { ...entry, placement: { ...entry.placement, row: Number((event.target as HTMLInputElement).value) } } : entry
                        )
                      })))} />
                  </label>
                  <label>
                    Grid column
                    <input type="number" .value=${String(child.placement.column)} @input=${(event: Event) =>
                      this.updateRootNode(owner, (rootNode) => updateNode(rootNode, parentId, (current) => ({
                        ...(current as typeof gridParent),
                        children: (current as typeof gridParent).children.map((entry) =>
                          entry.node.id === node.id ? { ...entry, placement: { ...entry.placement, column: Number((event.target as HTMLInputElement).value) } } : entry
                        )
                      })))} />
                  </label>
                `;
              })()}
            `
          : nothing}
      </div>
    `;
  }

  private renderRuleEditor(rule: Rule, assignment: DeviceAssignment, scope: "fullscreen_activation" | "popup_activation") {
    const layoutOptions = (this.project.layoutDefinitions ?? []).filter((entry) => entry.kind === (scope === "popup_activation" ? "popup" : "fullscreen"));
    return html`
      <details open>
        <summary>${rule.id}</summary>
        <div class="row">
          <button
            class="danger"
            @click=${() =>
              this.removeAssignmentRule(
                assignment.id,
                rule.id,
                scope === "popup_activation" ? "popupRules" : "fullscreenRules"
              )}
          >
            Delete rule
          </button>
        </div>
        <label>
          Priority
          <input type="number" .value=${String(rule.priority)} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, priority: Number((event.target as HTMLInputElement).value) } : entry)
          }))} />
        </label>
        <label>
          Condition
          <select .value=${rule.condition.kind} @change=${(event: Event) => {
            const kind = (event.target as HTMLSelectElement).value;
            const nextCondition: Condition =
              kind === "entity_matches"
                ? { kind: "entity_matches", entityId: "", pattern: ".*" }
                : kind === "entity_duration_ge"
                  ? { kind: "entity_duration_ge", entityId: "", state: "on", minutes: 15 }
                  : kind === "numeric_compare"
                    ? { kind: "numeric_compare", left: { type: "entity_state", entityId: "" }, op: "gte", right: 0 }
                    : kind === "boolean_compare"
                      ? { kind: "boolean_compare", left: { type: "entity_state", entityId: "" }, equals: true }
                      : kind === "is_defined"
                        ? { kind: "is_defined", ref: { type: "entity_state", entityId: "" }, expected: true }
                        : { kind: "entity_state", entityId: "", equals: "on" };
            this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: nextCondition } : entry)
            }));
          }}>
            <option value="entity_state">Entity state</option>
            <option value="entity_matches">Regex match</option>
            <option value="entity_duration_ge">Duration in state</option>
            <option value="numeric_compare">Numeric compare</option>
            <option value="boolean_compare">Boolean compare</option>
            <option value="is_defined">Is defined</option>
          </select>
        </label>
        ${rule.condition.kind === "entity_state" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.entityId, (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, entityId: value } } : entry)
          })))}</label>
          <label>
            Equals
            <input .value=${rule.condition.equals} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, equals: (event.target as HTMLInputElement).value } } : entry)
            }))} />
          </label>
        ` : nothing}
        ${rule.condition.kind === "entity_matches" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.entityId, (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, entityId: value } } : entry)
          })))}</label>
          <label>
            Pattern
            <input .value=${rule.condition.pattern} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, pattern: (event.target as HTMLInputElement).value } } : entry)
            }))} />
          </label>
        ` : nothing}
        ${rule.condition.kind === "entity_duration_ge" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.entityId, (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, entityId: value } } : entry)
          })))}</label>
          <label>
            State
            <input .value=${rule.condition.state} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, state: (event.target as HTMLInputElement).value } } : entry)
            }))} />
          </label>
          <label>
            Minutes
            <input type="number" .value=${String(rule.condition.minutes)} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, minutes: Number((event.target as HTMLInputElement).value) } } : entry)
            }))} />
          </label>
        ` : nothing}
        ${rule.condition.kind === "numeric_compare" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.left.type === "entity_state" ? rule.condition.left.entityId : "", (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, left: { type: "entity_state", entityId: value } } } : entry)
          })))}</label>
          <label>
            Operator
            <select .value=${rule.condition.op} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, op: (event.target as HTMLSelectElement).value as typeof rule.condition.op } } : entry)
            }))}>
              <option value="gt">></option>
              <option value="gte">>=</option>
              <option value="lt"><</option>
              <option value="lte"><=</option>
              <option value="eq">=</option>
            </select>
          </label>
          <label>
            Threshold
            <input type="number" .value=${String(rule.condition.right)} @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, right: Number((event.target as HTMLInputElement).value) } } : entry)
            }))} />
          </label>
        ` : nothing}
        ${rule.condition.kind === "boolean_compare" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.left.type === "entity_state" ? rule.condition.left.entityId : "", (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, left: { type: "entity_state", entityId: value } } } : entry)
          })))}</label>
          <label>
            Equals
            <select .value=${String(rule.condition.equals)} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, equals: (event.target as HTMLSelectElement).value === "true" } } : entry)
            }))}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        ` : nothing}
        ${rule.condition.kind === "is_defined" ? html`
          <label>Entity ${this.renderEntitySelector(rule.condition.ref.type === "entity_state" ? rule.condition.ref.entityId : "", (value) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, ref: { type: "entity_state", entityId: value } } } : entry)
          })))}</label>
          <label>
            Expected
            <select .value=${String(rule.condition.expected !== false)} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
              ...current,
              [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? { ...entry, condition: { ...rule.condition, expected: (event.target as HTMLSelectElement).value === "true" } } : entry)
            }))}>
              <option value="true">defined</option>
              <option value="false">not defined</option>
            </select>
          </label>
        ` : nothing}
        <label>
          Layout
          <select .value=${rule.action.type === "activate_popup_layout" || rule.action.type === "activate_fullscreen_layout" ? rule.action.layoutId : ""} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
            ...current,
            [scope === "popup_activation" ? "popupRules" : "fullscreenRules"]: (scope === "popup_activation" ? current.popupRules : current.fullscreenRules).map((entry) => entry.id === rule.id ? {
              ...entry,
              action: scope === "popup_activation"
                ? { type: "activate_popup_layout", layoutId: (event.target as HTMLSelectElement).value }
                : { type: "activate_fullscreen_layout", layoutId: (event.target as HTMLSelectElement).value }
            } : entry)
          }))}>
            ${layoutOptions.map((layout) => html`<option value=${layout.id}>${layout.name}</option>`)}
          </select>
        </label>
      </details>
    `;
  }

  private renderDisplayAssignmentEditor(device: ManagedDisplay): TemplateResult {
    const assignment = this.selectedDisplayAssignment;
    const status = this.selectedDisplayAssignmentStatus;
    const fullscreenLayouts = (this.project.layoutDefinitions ?? []).filter((layout) => layout.kind === "fullscreen");
    const selectedFullscreenLayoutId = fullscreenLayouts.some((layout) => layout.id === assignment?.defaultFullscreenLayoutId)
      ? assignment?.defaultFullscreenLayoutId
      : "";
    if (!device.managed) {
      return html`<div class="muted">Enable management to configure assignment rules.</div>`;
    }
    if (!assignment) {
      return html`
        <div class="muted">No assignment yet for this display.</div>
        <button @click=${() => this.addAssignment(device.id)}>Create assignment</button>
      `;
    }
    return html`
      <label>
        Default fullscreen
        <select .value=${selectedFullscreenLayoutId} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({ ...current, defaultFullscreenLayoutId: (event.target as HTMLSelectElement).value || undefined }))}>
          <option value="">None</option>
          ${fullscreenLayouts.map((layout) => html`<option value=${layout.id}>${layout.name}</option>`)}
        </select>
      </label>
      ${fullscreenLayouts.length
        ? nothing
        : html`<div class="muted">No fullscreen layouts.</div>`}
      <label>
        Theme
        <select .value=${assignment.defaultThemeId ?? "inherit"} @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({ ...current, defaultThemeId: (event.target as HTMLSelectElement).value || undefined }))}>
          ${this.project.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
        </select>
      </label>
      <div class="section">
        <div class="row">
          <h3>Fullscreen Rules</h3>
          <button @click=${() => this.updateAssignment(assignment.id, (current) => ({ ...current, fullscreenRules: [...current.fullscreenRules, defaultRule("fullscreen_activation")] }))}>Add rule</button>
        </div>
        ${assignment.fullscreenRules.map((rule) => this.renderRuleEditor(rule, assignment, "fullscreen_activation"))}
      </div>
      <div class="section">
        <div class="row">
          <h3>Popup Rules</h3>
          <button @click=${() => this.updateAssignment(assignment.id, (current) => ({ ...current, popupRules: [...current.popupRules, defaultRule("popup_activation")] }))}>Add rule</button>
        </div>
        ${assignment.popupRules.map((rule) => this.renderRuleEditor(rule, assignment, "popup_activation"))}
      </div>
      <div class="section">
        <h3>Schedule</h3>
        ${device.providerKind === "openepaperlink-ap"
          ? html`
              <label>
                <input
                  type="checkbox"
                  .checked=${Boolean(assignment.schedule?.enabled)}
                  @change=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
                    ...current,
                    schedule: {
                      enabled: (event.target as HTMLInputElement).checked,
                      intervalMinutes: Math.max(1, Math.trunc(Number(current.schedule?.intervalMinutes ?? 15) || 15))
                    }
                  }))}
                />
                Scheduled updates enabled
              </label>
              <label>
                Every
                <input
                  type="number"
                  min="1"
                  .value=${String(assignment.schedule?.intervalMinutes ?? 15)}
                  @input=${(event: Event) => this.updateAssignment(assignment.id, (current) => ({
                    ...current,
                    schedule: {
                      enabled: Boolean(current.schedule?.enabled),
                      intervalMinutes: Math.max(1, Math.trunc(Number((event.target as HTMLInputElement).value) || 15))
                    }
                  }))}
                />
                minutes
              </label>
              <div class="row">
                <button class="primary" @click=${() => void this.forceSelectedAssignmentUpdate()}>Force update now</button>
              </div>
              <div class="muted">Save project for schedule changes to take effect on the backend timer.</div>
              ${status
                ? html`
                    <div class="muted">Last result: ${status.lastResult ?? "idle"}</div>
                    <div class="muted">Last run: ${this.formatScheduleTimestamp(status.lastCompletedAt ?? status.lastRunAt)}</div>
                    <div class="muted">Next run: ${!status.enabled ? "not scheduled" : this.formatScheduleTimestamp(status.nextRunAt)}</div>
                    ${status.lastError ? html`<div class="status-error">${status.lastError}</div>` : nothing}
                  `
                : html`<div class="muted">Schedule status unavailable.</div>`}
            `
          : html`<div class="muted">Scheduling only available for managed AP displays.</div>`}
      </div>
      <button @click=${() => this.removeAssignment(assignment.id)}>Delete assignment</button>
    `;
  }

  private renderDisplayUpdateLog(): TemplateResult {
    return html`
      <div class="section">
        <div class="row">
          <h3>Update Log</h3>
          <button @click=${() => void this.refreshDisplayUpdateLog()}>Refresh</button>
        </div>
        <div class="row">
          <label>
            Show last
            <input
              type="number"
              min="1"
              .value=${String(this.displayUpdateLogSinceMinutes)}
              @input=${(event: Event) => {
                this.displayUpdateLogSinceMinutes = Math.max(1, Math.trunc(Number((event.target as HTMLInputElement).value) || 60));
                void this.refreshDisplayUpdateLog();
              }}
            />
            minutes
          </label>
        </div>
        ${this.displayUpdateLog.length
          ? html`
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Desired</th>
                    <th>Succeeded</th>
                    <th>Image</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.displayUpdateLog.map((entry) => html`
                    <tr>
                      <td>${this.formatUpdateLogTime(entry)}</td>
                      <td>${entry.desired ? "Yes" : "No"}</td>
                      <td>${entry.succeeded ? "Yes" : "No"}</td>
                      <td>
                        ${entry.imagePngBase64
                          ? html`<img
                              class="update-log-image"
                              src=${`data:image/png;base64,${entry.imagePngBase64}`}
                              @click=${() => {
                                this.updateLogImageModal = entry;
                                this.updateLogImageScale = 2;
                              }}
                            />`
                          : html`<span class="muted">n/a</span>`}
                      </td>
                      <td>${entry.error ?? entry.message ?? ""}</td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `
          : html`<div class="muted">No updates in this time range.</div>`}
      </div>
    `;
  }

  private renderUpdateLogImageModal(): TemplateResult | typeof nothing {
    const entry = this.updateLogImageModal;
    if (!entry?.imagePngBase64) {
      return nothing;
    }
    const canNavigate = this.updateLogImageEntries().length > 1;
    const imageKey = `${entry.timestampMs}:${entry.displayId}:${entry.hash ?? ""}:${this.updateLogImageScale}`;
    const cssScale = this.updateLogImageScale / (typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1);
    const width = entry.width ? Math.max(1, Math.round(entry.width * cssScale)) : undefined;
    const height = entry.height ? Math.max(1, Math.round(entry.height * cssScale)) : undefined;
    const imageStyle = width && height
      ? `width:${width}px;height:${height}px;`
      : `width:auto;height:auto;max-width:100%;transform:scale(${cssScale});transform-origin:top left;`;
    return html`
      <div class="modal-backdrop" @click=${() => (this.updateLogImageModal = null)}>
        <div class="modal" @click=${(event: Event) => event.stopPropagation()}>
          <div class="row">
            <h3>Update Image</h3>
            <button ?disabled=${!canNavigate} @click=${() => this.showAdjacentUpdateLogImage(-1)}>Previous</button>
            <button ?disabled=${!canNavigate} @click=${() => this.showAdjacentUpdateLogImage(1)}>Next</button>
            <button @click=${() => (this.updateLogImageModal = null)}>Close</button>
          </div>
          <div class="muted">${this.formatUpdateLogTime(entry)} ${entry.hash ? `hash ${entry.hash}` : ""}</div>
          <label>
            Scale
            <select .value=${String(this.updateLogImageScale)} @change=${(event: Event) => (this.updateLogImageScale = Number((event.target as HTMLSelectElement).value))}>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="3">3x</option>
              <option value="4">4x</option>
              <option value="5">5x</option>
            </select>
          </label>
          ${keyed(imageKey, html`
            <img
              class="modal-image"
              style=${imageStyle}
              src=${`data:image/png;base64,${entry.imagePngBase64}`}
            />
          `)}
        </div>
      </div>
    `;
  }

  private renderProviderField(instance: ProviderInstance, descriptor: ProviderDescriptor, fieldKey: string): TemplateResult {
    const field = (descriptor.configFields ?? []).find((entry) => entry.key === fieldKey);
    if (!field) {
      return html``;
    }
    const value = instance.config[field.key];
    if (field.kind === "checkbox") {
      return html`
        <label>
          <input
            type="checkbox"
            .checked=${Boolean(value)}
            @change=${(event: Event) => this.updateProviderInstanceDraft(instance.id, field.key, (event.target as HTMLInputElement).checked)}
          />
          ${field.label}
        </label>
      `;
    }
    if (field.kind === "select") {
      return html`
        <label>
          ${field.label}
          <select
            .value=${String(value ?? field.options?.[0]?.value ?? "")}
            @change=${(event: Event) => this.updateProviderInstanceDraft(instance.id, field.key, (event.target as HTMLSelectElement).value)}
          >
            ${(field.options ?? []).map((option) => html`<option value=${option.value}>${option.label}</option>`)}
          </select>
        </label>
      `;
    }
    return html`
      <label>
        ${field.label}
        <input
          type=${field.kind === "password" ? "password" : "text"}
          .value=${String(value ?? "")}
          placeholder=${field.placeholder ?? ""}
          @input=${(event: Event) => this.updateProviderInstanceDraft(instance.id, field.key, (event.target as HTMLInputElement).value)}
        />
      </label>
    `;
  }

  private virtualDisplayDefinitions(instance: ProviderInstance): VirtualDisplayDefinition[] {
    const raw = instance.config.virtualDisplays;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry, index) => ({
        id: String(entry.id || `virtual-${index + 1}`),
        name: String(entry.name || `Virtual Display ${index + 1}`),
        displayTypeId: String(entry.displayTypeId || this.project.displayTypes?.[0]?.id || "")
      }));
  }

  private updateVirtualDisplayDefinitions(instanceId: string, definitions: VirtualDisplayDefinition[]): void {
    this.providerInstances = this.providerInstances.map((instance) =>
      instance.id === instanceId
        ? {
            ...instance,
            config: {
              ...instance.config,
              virtualDisplays: definitions
            }
          }
        : instance
    );
  }

  private addVirtualDisplayDefinition(instanceId: string): void {
    const instance = this.providerInstances.find((entry) => entry.id === instanceId);
    const displayTypeId = this.selectedDisplayTypeId || this.project.displayTypes?.[0]?.id || "";
    if (!instance) {
      return;
    }
    const nextIndex = this.virtualDisplayDefinitions(instance).length + 1;
    this.updateVirtualDisplayDefinitions(instanceId, [
      ...this.virtualDisplayDefinitions(instance),
      defaultVirtualDisplayDefinition(displayTypeId, nextIndex)
    ]);
  }

  private updateVirtualDisplayDefinition(instanceId: string, definitionId: string, patch: Partial<VirtualDisplayDefinition>): void {
    const instance = this.providerInstances.find((entry) => entry.id === instanceId);
    if (!instance) {
      return;
    }
    this.updateVirtualDisplayDefinitions(
      instanceId,
      this.virtualDisplayDefinitions(instance).map((definition) =>
        definition.id === definitionId ? { ...definition, ...patch } : definition
      )
    );
  }

  private removeVirtualDisplayDefinition(instanceId: string, definitionId: string): void {
    const instance = this.providerInstances.find((entry) => entry.id === instanceId);
    if (!instance) {
      return;
    }
    this.updateVirtualDisplayDefinitions(
      instanceId,
      this.virtualDisplayDefinitions(instance).filter((definition) => definition.id !== definitionId)
    );
  }

  private renderVirtualDisplayDefinitions(instance: ProviderInstance): TemplateResult {
    const definitions = this.virtualDisplayDefinitions(instance);
    return html`
      <div class="section">
        <div class="row">
          <h3>Virtual Displays</h3>
          <button @click=${() => this.addVirtualDisplayDefinition(instance.id)}>Add virtual display</button>
        </div>
        ${definitions.map((definition) => html`
          <details open>
            <summary>${definition.name}</summary>
            <label>
              Name
              <input .value=${definition.name} @input=${(event: Event) => this.updateVirtualDisplayDefinition(instance.id, definition.id, { name: (event.target as HTMLInputElement).value })} />
            </label>
            <label>
              Reference
              <input .value=${definition.id} @input=${(event: Event) => this.updateVirtualDisplayDefinition(instance.id, definition.id, { id: (event.target as HTMLInputElement).value })} />
            </label>
            <label>
              Display type
              <select .value=${definition.displayTypeId} @change=${(event: Event) => this.updateVirtualDisplayDefinition(instance.id, definition.id, { displayTypeId: (event.target as HTMLSelectElement).value })}>
                ${(this.project.displayTypes ?? []).map((displayType) => html`<option value=${displayType.id}>${displayType.name}</option>`)}
              </select>
            </label>
            <button class="danger" @click=${() => this.removeVirtualDisplayDefinition(instance.id, definition.id)}>Remove virtual display</button>
          </details>
        `)}
        ${definitions.length ? html`<div class="muted">Save, then refresh display discovery to manage these displays.</div>` : html`<div class="muted">No virtual displays defined.</div>`}
      </div>
    `;
  }

  private renderProviderInstanceEditor(instance: ProviderInstance): TemplateResult {
    const descriptor = this.providerDescriptor(instance.providerId);
    if (!descriptor) {
      return html``;
    }
    const status = this.providerStatuses[instance.id];
    return html`
      <div class="section">
        <h2>${instance.name || descriptor.label}</h2>
        <div class="muted">${descriptor.label}</div>
        <label>
          Name
          <input .value=${instance.name} @input=${(event: Event) => {
            this.providerInstances = this.providerInstances.map((entry) =>
              entry.id === instance.id ? { ...entry, name: (event.target as HTMLInputElement).value } : entry
            );
          }} />
        </label>
        <label>
          <input
            type="checkbox"
            .checked=${Boolean(instance.enabled)}
            @change=${(event: Event) => {
              this.providerInstances = this.providerInstances.map((entry) =>
                entry.id === instance.id ? { ...entry, enabled: (event.target as HTMLInputElement).checked } : entry
              );
            }}
          />
          Enabled
        </label>
        ${(descriptor.configFields ?? []).map((field) => this.renderProviderField(instance, descriptor, field.key))}
        ${instance.providerId === "virtual" ? this.renderVirtualDisplayDefinitions(instance) : nothing}
        <div class="row">
          <button @click=${() => void this.testProvider(instance.id)}>Test</button>
          <button class="primary" @click=${() => void this.saveProvider(instance.id)}>Save</button>
          <button class="danger" @click=${() => void this.deleteProvider(instance.id)}>Delete</button>
        </div>
        ${status ? html`<div class=${status.ok ? "status-ok" : "status-error"}>${status.message}</div>` : nothing}
      </div>
    `;
  }

  private renderDetailPanel() {
    if (this.activePage === "displays") {
      const device = this.selectedDisplay;
      return html`
        <div class="detail">
          <div class="section">
            <h2>Display</h2>
            ${device
              ? html`
                  <label>
                    Name
                    <input .value=${device.name} @input=${(event: Event) => this.updateDisplay(device.id, { name: (event.target as HTMLInputElement).value })} />
                  </label>
                  <div class="detail-danger-action">
                    <button class="danger" @click=${() => this.removeDisplay(device.id)}>${device.virtual ? "Delete virtual display" : "Unmanage device"}</button>
                  </div>
                  <label>
                    Provider
                    <input .value=${device.providerKind} disabled />
                  </label>
                  <label>
                    Display type
                    <select .value=${device.displayTypeId} @change=${(event: Event) => this.updateDisplayDisplayType(device.id, (event.target as HTMLSelectElement).value)}>
                      ${(this.project.displayTypes ?? []).map((displayType) => html`<option value=${displayType.id}>${displayType.name}</option>`)}
                    </select>
                  </label>
                  <label>
                    <input type="checkbox" .checked=${device.managed} @change=${(event: Event) => this.updateDisplay(device.id, { managed: (event.target as HTMLInputElement).checked })} />
                    Managed by this tool
                  </label>
                  <div class="muted">${device.virtual ? "Virtual device" : "Provider-backed device"}</div>
                  ${device.metadata?.mac ? html`<div class="muted">MAC ${String(device.metadata.mac)}</div>` : nothing}
                  <div class="section">
                    <h3>Assignment</h3>
                    ${this.renderDisplayAssignmentEditor(device)}
                  </div>
                  ${this.renderDisplayUpdateLog()}
                  ${this.uploadStatusMessage ? html`<div class="muted">${this.uploadStatusMessage}</div>` : nothing}
                `
              : html`<div class="muted">Select display.</div>`}
          </div>
        </div>
      `;
    }

    if (this.activePage === "widgets") {
      const definition = this.selectedWidgetDefinition;
      return html`
        <div class="detail">
          <div class="section">
            <h2>Compound Widget</h2>
            ${definition
              ? html`
                  <label>Name <input .value=${definition.name} @input=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({ ...current, name: (event.target as HTMLInputElement).value }))} /></label>
                  <div class="detail-danger-action">
                    <button class="danger" @click=${() => this.removeWidgetDefinition(definition.id)}>Delete compound widget</button>
                  </div>
                  <div class="section">
                    <h3>Inputs</h3>
                    <button @click=${() => this.addCompoundInput(definition.id)}>Add input</button>
                    ${definition.inputSchema.map(
                      (input: CompoundInputDefinition) => html`
                        <details>
                          <summary>${input.name}</summary>
                          <div class="row">
                            <button class="danger" @click=${() => this.removeCompoundInput(definition.id, input.id)}>Delete input</button>
                          </div>
                          <label>Name <input .value=${input.name} @input=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({
                            ...current,
                            inputSchema: current.inputSchema.map((entry) => entry.id === input.id ? { ...entry, name: (event.target as HTMLInputElement).value } : entry)
                          }))} /></label>
                          <label>
                            Type
                            <select .value=${input.valueType} @change=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({
                              ...current,
                              inputSchema: current.inputSchema.map((entry) => entry.id === input.id ? { ...entry, valueType: (event.target as HTMLSelectElement).value as CompoundInputDefinition["valueType"] } : entry)
                            }))}>
                              <option value="entity">Entity</option>
                              <option value="string">String</option>
                              <option value="number">Number</option>
                              <option value="boolean">Boolean</option>
                            </select>
                          </label>
                          ${input.valueType === "string" || input.valueType === "entity"
                            ? html`
                                <label>
                                  Preview value
                                  <input .value=${String(input.previewValue ?? "")} @input=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({
                                    ...current,
                                    inputSchema: current.inputSchema.map((entry) => entry.id === input.id ? { ...entry, previewValue: (event.target as HTMLInputElement).value } : entry)
                                  }))} />
                                </label>
                              `
                            : nothing}
                          ${input.valueType === "number"
                            ? html`
                                <label>
                                  Preview value
                                  <input type="number" .value=${String(input.previewValue ?? 0)} @input=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({
                                    ...current,
                                    inputSchema: current.inputSchema.map((entry) => entry.id === input.id ? { ...entry, previewValue: Number((event.target as HTMLInputElement).value) } : entry)
                                  }))} />
                                </label>
                              `
                            : nothing}
                          ${input.valueType === "boolean"
                            ? html`
                                <label>
                                  Preview value
                                  <select .value=${String(input.previewValue ?? false)} @change=${(event: Event) => this.updateWidgetDefinition(definition.id, (current) => ({
                                    ...current,
                                    inputSchema: current.inputSchema.map((entry) => entry.id === input.id ? { ...entry, previewValue: (event.target as HTMLSelectElement).value === "true" } : entry)
                                  }))}>
                                    <option value="true">true</option>
                                    <option value="false">false</option>
                                  </select>
                                </label>
                              `
                            : nothing}
                        </details>
                      `
                    )}
                  </div>
                  <div class="editor-structure-preview">
                    <div class="row">
                      <strong>Visual Structure</strong>
                      <span class="muted">Click boxes to select. Drag to reorder/reparent.</span>
                    </div>
                    ${this.renderStructurePreviewStage()}
                  </div>
                  ${definition.rootNode
                    ? this.selectedEditorNode
                      ? this.renderNodeEditor(this.selectedEditorNode, definition, parentIdForNode(definition.rootNode, this.selectedEditorNode.id))
                      : html`<div class="empty-state">Select node.</div>`
                    : html`
                        <div class="empty-state">
                          <div class="muted">No root node.</div>
                          <div class="row">
                            <button @click=${() => this.setRootNode(definition, defaultRootNode("stack"))}>Add Stack Root</button>
                            <button @click=${() => this.setRootNode(definition, defaultRootNode("grid"))}>Add Grid Root</button>
                            <button @click=${() => this.setRootNode(definition, defaultRootNode("zstack"))}>Add ZStack Root</button>
                          </div>
                        </div>
                      `}
                `
              : html`<div class="muted">Select compound widget.</div>`}
          </div>
        </div>
      `;
    }

    if (this.activePage === "layouts") {
      const layout = this.selectedLayout;
      return html`
        <div class="detail">
          <div class="section">
            <h2>Layout</h2>
            ${layout
              ? html`
                  <label>Name <input .value=${layout.name} @input=${(event: Event) => this.updateLayout(layout.id, (current) => ({ ...current, name: (event.target as HTMLInputElement).value }))} /></label>
                  <div class="detail-danger-action">
                    <button class="danger" @click=${() => this.removeLayout(layout.id)}>Delete layout</button>
                  </div>
                  <label>
                    Kind
                    <select .value=${layout.kind} @change=${(event: Event) => this.updateLayout(layout.id, (current) => ({ ...current, kind: (event.target as HTMLSelectElement).value as LayoutDefinition["kind"] }))}>
                      <option value="fullscreen">Fullscreen</option>
                      <option value="popup">Popup</option>
                    </select>
                  </label>
                  ${layout.kind === "popup"
                    ? html`
                        <div class="row">
                          <label>Popup width <input type="number" .value=${String(layout.popupDefaults?.widthPx ?? 180)} @input=${(event: Event) => this.updateLayout(layout.id, (current) => ({ ...current, popupDefaults: { ...current.popupDefaults, widthPx: Number((event.target as HTMLInputElement).value) } }))} /></label>
                          <label>Popup height <input type="number" .value=${String(layout.popupDefaults?.heightPx ?? 80)} @input=${(event: Event) => this.updateLayout(layout.id, (current) => ({ ...current, popupDefaults: { ...current.popupDefaults, heightPx: Number((event.target as HTMLInputElement).value) } }))} /></label>
                        </div>
                      `
                    : nothing}
                  <div class="editor-structure-preview">
                    <div class="row">
                      <strong>Visual Structure</strong>
                      <span class="muted">Click boxes to select. Drag to reorder/reparent.</span>
                    </div>
                    ${this.renderStructurePreviewStage()}
                  </div>
                  ${layout.rootNode
                    ? this.selectedEditorNode
                      ? this.renderNodeEditor(this.selectedEditorNode, layout, parentIdForNode(layout.rootNode, this.selectedEditorNode.id))
                      : html`<div class="empty-state">Select node.</div>`
                    : html`
                        <div class="empty-state">
                          <div class="muted">No root node.</div>
                          <div class="row">
                            <button @click=${() => this.setRootNode(layout, defaultRootNode("stack"))}>Add Stack Root</button>
                            <button @click=${() => this.setRootNode(layout, defaultRootNode("grid"))}>Add Grid Root</button>
                            <button @click=${() => this.setRootNode(layout, defaultRootNode("zstack"))}>Add ZStack Root</button>
                          </div>
                        </div>
                      `}
                `
              : html`<div class="muted">Select layout.</div>`}
          </div>
        </div>
      `;
    }

    if (this.activePage === "themes") {
      const theme = this.selectedTheme;
      return html`
        <div class="detail">
          <div class="section">
            <h2>Theme</h2>
            ${theme
              ? html`
                  <label>Name <input .value=${theme.name} @input=${(event: Event) => this.updateTheme(theme.id, (current) => ({ ...current, name: (event.target as HTMLInputElement).value }))} /></label>
                  <div class="detail-danger-action">
                    <button class="danger" @click=${() => this.removeTheme(theme.id)}>Delete theme</button>
                  </div>
                  <label>
                    Background fill
                    <select .value=${theme.surface.fillRole ?? "none"} @change=${(event: Event) => this.updateTheme(theme.id, (current) => ({
                      ...current,
                      surface: {
                        ...current.surface,
                        fillRole: (event.target as HTMLSelectElement).value === "none"
                          ? undefined
                          : (event.target as HTMLSelectElement).value as FillRole
                      }
                    }))}>
                      <option value="none">None</option>
                      <option value="bg">${fillRoleLabel("bg")}</option>
                      <option value="fg">${fillRoleLabel("fg")}</option>
                      <option value="accent">${fillRoleLabel("accent")}</option>
                      <option value="gray">${fillRoleLabel("gray")}</option>
                      <option value="light-accent">${fillRoleLabel("light-accent")}</option>
                      <option value="dark-accent">${fillRoleLabel("dark-accent")}</option>
                    </select>
                  </label>
                  ${(["tiny", "normal", "normalEmphasis", "header"] as const).map(
                    (role) => {
                      const roleStyle = this.coerceTextStyleVariant(theme.fontRoles?.[role]);
                      const roleFamily = roleStyle.family ?? this.fonts[0]?.id ?? "arial";
                      return html`
                      <details>
                        <summary>${fontRoleLabel(role)} font</summary>
                        <label>
                          Family
                          <select .value=${roleFamily} @change=${(event: Event) => {
                            const family = (event.target as HTMLSelectElement).value;
                            const currentRole = this.coerceTextStyleVariant({ ...theme.fontRoles?.[role], family });
                            this.updateTheme(theme.id, (current) => ({
                              ...current,
                              fontRoles: { ...current.fontRoles, [role]: currentRole }
                            }));
                          }}>
                            ${this.renderFontFamilyOptions(roleFamily)}
                          </select>
                        </label>
                        ${this.renderTextVariantControls(roleFamily, roleStyle, (patch) =>
                          this.updateTheme(theme.id, (current) => ({
                            ...current,
                            fontRoles: { ...current.fontRoles, [role]: { ...current.fontRoles?.[role], family: roleFamily, ...patch } },
                            text: fontRoleThemeTextKey(role) && patch.colorRole && patch.colorRole !== "transparent"
                              ? { ...current.text, [fontRoleThemeTextKey(role)!]: patch.colorRole }
                              : current.text
                          }))
                        )}
                        <label>
                          Pixel size
                          ${this.renderFontPixelSizeControl(
                            roleFamily,
                            Number(theme.fontRoles?.[role]?.pixelSize ?? fontRoleBasePixelSize(this.project, role)),
                            (pixelSize) => this.updateTheme(theme.id, (current) => ({ ...current, fontRoles: { ...current.fontRoles, [role]: { ...current.fontRoles?.[role], pixelSize } } }))
                          )}
                        </label>
                      </details>
                    `}
                  )}
                  <details>
                    <summary>Text outline</summary>
                    <label>
                      <input type="checkbox" .checked=${Boolean(theme.textOutline?.enabled)} @change=${(event: Event) => this.updateTheme(theme.id, (current) => ({ ...current, textOutline: { ...current.textOutline, enabled: (event.target as HTMLInputElement).checked, colorRole: current.textOutline?.colorRole ?? "bg", thicknessPx: current.textOutline?.thicknessPx ?? 1 } }))} />
                      Enable glyph outline
                    </label>
                    <label>
                      Color
                      <select .value=${theme.textOutline?.colorRole ?? "bg"} @change=${(event: Event) => this.updateTheme(theme.id, (current) => ({ ...current, textOutline: { ...current.textOutline, enabled: current.textOutline?.enabled ?? false, colorRole: (event.target as HTMLSelectElement).value as "bg" | "fg" | "accent", thicknessPx: current.textOutline?.thicknessPx ?? 1 } }))}>
                        <option value="fg">black</option>
                        <option value="bg">white</option>
                        <option value="accent">accent</option>
                      </select>
                    </label>
                  </details>
                `
              : html`<div class="muted">Select theme.</div>`}
          </div>
        </div>
      `;
    }

    if (this.activePage === "config") {
      const userFonts = this.fonts
        .filter((family) => family.source === "user")
        .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
      const activeFontPreview = this.fontSpecimens[0];
      return html`
        <div class="detail">
          ${this.activeConfigSection === "project" ? html`<div class="section">
            <h2>Project</h2>
            <label>
              Name
              <input .value=${this.project.name} @input=${(event: Event) => {
                this.project = {
                  ...this.project,
                  name: (event.target as HTMLInputElement).value
                };
              }} />
            </label>
            <label>
              Locale
              <input .value=${this.project.locale ?? "en-US"} @input=${(event: Event) => {
                this.project = {
                  ...this.project,
                  locale: (event.target as HTMLInputElement).value
                };
              }} />
            </label>
            <div class="muted">Used by template format filters, for example en-US or nl-NL.</div>
            <label>
              Default source provider
              <select .value=${this.project.defaultSourceProviderInstanceId ?? this.activeSourceProviderInstance?.id ?? ""} @change=${async (event: Event) => {
                this.project = {
                  ...this.project,
                  defaultSourceProviderInstanceId: (event.target as HTMLSelectElement).value || undefined
                };
                const sourceProvider = this.activeSourceProviderInstance;
                this.entityCatalog = sourceProvider ? await fetchProviderEntities(sourceProvider.id).catch(() => this.entityCatalog) : [];
                await this.refreshPreview();
              }}>
                <option value="">Auto</option>
                ${this.sourceProviderOptions().map((instance) => html`<option value=${instance.id}>${instance.name || this.providerDescriptor(instance.providerId)?.label || instance.providerId}</option>`)}
              </select>
            </label>
            <div class="muted">Live data and widget entity lists use this provider.</div>
            <div class="section">
              <h3>Backup / Restore</h3>
              <div class="row">
                <button @click=${() => void this.downloadBackup()}>Download backup</button>
              </div>
              <label>
                Restore backup
                <input type="file" accept="application/json,.json" @change=${(event: Event) => void this.restoreBackup(event)} />
              </label>
              ${this.backupStatusMessage ? html`<div class="muted">${this.backupStatusMessage}</div>` : nothing}
            </div>
          </div>` : nothing}
          ${this.activeConfigSection === "sources" ? html`<div class="section">
            <h2>Sources</h2>
            <div class="row">
              ${this.providerKinds
                .filter((entry) => entry.domain === "source")
                .map((descriptor) => html`<button @click=${() => this.createProviderDraft(descriptor.id)}>Add ${descriptor.label}</button>`)}
            </div>
            ${this.providerInstances
              .filter((instance) => this.providerDescriptor(instance.providerId)?.domain === "source")
              .map((instance) => this.renderProviderInstanceEditor(instance))}
          </div>` : nothing}
          ${this.activeConfigSection === "display-systems" ? html`<div class="section">
            <h2>Display Systems</h2>
            <div class="row">
              ${this.providerKinds
                .filter((entry) => entry.domain === "display")
                .map((descriptor) => html`<button @click=${() => this.createProviderDraft(descriptor.id)}>Add ${descriptor.label}</button>`)}
            </div>
            ${this.providerInstances
              .filter((instance) => this.providerDescriptor(instance.providerId)?.domain === "display")
              .map((instance) => this.renderProviderInstanceEditor(instance))}
            <div class="section">
              <h3>Scheduled Update Log</h3>
              <label>
                Keep log for
                <input
                  type="number"
                  min="1"
                  .value=${String(this.scheduleUpdateLogSettings.retentionDays)}
                  @input=${(event: Event) => {
                    this.scheduleUpdateLogSettings = {
                      retentionDays: Math.max(1, Math.trunc(Number((event.target as HTMLInputElement).value) || 7))
                    };
                  }}
                />
                days
              </label>
              <button @click=${() => void this.persistScheduleUpdateLogSettings()}>Save log setting</button>
            </div>
            <div class="section">
              <h3>Display Types</h3>
              <button @click=${() => this.addDisplayType()}>Add display type</button>
              ${(this.project.displayTypes ?? []).map(
                (displayType) => html`
                  <details ?open=${displayType.id === this.selectedDisplayTypeId}>
                    <summary @click=${() => {
                      this.selectedDisplayTypeId = displayType.id;
                      void this.refreshPreview();
                    }}>${displayType.name}</summary>
                    <label>Name <input .value=${displayType.name} @input=${(event: Event) => this.updateDisplayType(displayType.id, { name: (event.target as HTMLInputElement).value })} /></label>
                    <div class="detail-danger-action">
                      <button class="danger" @click=${() => this.removeDisplayType(displayType.id)}>Delete display type</button>
                    </div>
                    <div class="row">
                      <label>Width <input type="number" .value=${String(displayType.width)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { width: Number((event.target as HTMLInputElement).value) })} /></label>
                      <label>Height <input type="number" .value=${String(displayType.height)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { height: Number((event.target as HTMLInputElement).value) })} /></label>
                    </div>
                    <div class="row">
                      <label>Grid unit <input type="number" .value=${String(displayType.gridUnitPx)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { gridUnitPx: Number((event.target as HTMLInputElement).value) })} /></label>
                      <label>Padding top <input type="number" .value=${String(displayType.contentPadding.top)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { contentPadding: { ...displayType.contentPadding, top: Number((event.target as HTMLInputElement).value) } })} /></label>
                      <label>Padding right <input type="number" .value=${String(displayType.contentPadding.right)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { contentPadding: { ...displayType.contentPadding, right: Number((event.target as HTMLInputElement).value) } })} /></label>
                    </div>
                    <div class="row">
                      <label>Padding bottom <input type="number" .value=${String(displayType.contentPadding.bottom)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { contentPadding: { ...displayType.contentPadding, bottom: Number((event.target as HTMLInputElement).value) } })} /></label>
                      <label>Padding left <input type="number" .value=${String(displayType.contentPadding.left)} @input=${(event: Event) => this.updateDisplayType(displayType.id, { contentPadding: { ...displayType.contentPadding, left: Number((event.target as HTMLInputElement).value) } })} /></label>
                    </div>
                    <label>Background <input .value=${displayType.palette.bg} @input=${(event: Event) => this.updateDisplayType(displayType.id, { palette: { ...displayType.palette, bg: (event.target as HTMLInputElement).value } })} /></label>
                    <label>Foreground <input .value=${displayType.palette.fg} @input=${(event: Event) => this.updateDisplayType(displayType.id, { palette: { ...displayType.palette, fg: (event.target as HTMLInputElement).value } })} /></label>
                    <label>Accent <input .value=${displayType.palette.accent} @input=${(event: Event) => this.updateDisplayType(displayType.id, { palette: { ...displayType.palette, accent: (event.target as HTMLInputElement).value } })} /></label>
                  </details>
                `
              )}
            </div>
          </div>` : nothing}
          ${this.activeConfigSection === "scripting" ? html`<div class="section">
            <h2>Scripting</h2>
            <div class="muted">Globals in templates and scripts: <code>now</code>, <code>today</code>, <code>locale</code>, <code>display</code>, <code>project</code>.</div>
            <div class="muted">Helpers: JS function source. Filters: JS function source with signature <code>(value, args, context) =&gt; result</code>.</div>
            <label>
              Shared source
              <code-editor-field language="javascript" min-lines="6" .value=${this.project.scripting?.sharedSource ?? ""} @input=${(event: Event) => {
                const value = String((event.target as HTMLElement & { value?: string }).value ?? "");
                this.updateProjectScripting((current) => ({ ...current, sharedSource: value }));
              }}></code-editor-field>
            </label>
            <div class="section-title">Helpers</div>
            ${(this.project.scripting?.helpers ?? []).map((entry, index) => html`
              <div class="card">
                <label>
                  Name
                  <input .value=${entry.name} @input=${(event: Event) => this.updateScriptingLibraryEntry("helpers", index, "name", (event.target as HTMLInputElement).value)} />
                </label>
                <label>
                  Source
                  <code-editor-field
                    language="javascript"
                    min-lines="5"
                    .value=${entry.source}
                    @input=${(event: Event) => this.updateScriptingLibraryEntry("helpers", index, "source", String((event.target as HTMLElement & { value?: string }).value ?? ""))}
                  ></code-editor-field>
                </label>
                <button @click=${() => this.removeScriptingLibraryEntry("helpers", index)}>Remove helper</button>
              </div>
            `)}
            <button @click=${() => this.addScriptingLibraryEntry("helpers")}>Add helper</button>
            <div class="section-title">Filters</div>
            ${(this.project.scripting?.filters ?? []).map((entry, index) => html`
              <div class="card">
                <label>
                  Name
                  <input .value=${entry.name} @input=${(event: Event) => this.updateScriptingLibraryEntry("filters", index, "name", (event.target as HTMLInputElement).value)} />
                </label>
                <label>
                  Source
                  <code-editor-field
                    language="javascript"
                    min-lines="5"
                    .value=${entry.source}
                    @input=${(event: Event) => this.updateScriptingLibraryEntry("filters", index, "source", String((event.target as HTMLElement & { value?: string }).value ?? ""))}
                  ></code-editor-field>
                </label>
                <button @click=${() => this.removeScriptingLibraryEntry("filters", index)}>Remove filter</button>
              </div>
            `)}
            <button @click=${() => this.addScriptingLibraryEntry("filters")}>Add filter</button>
            <div class="muted">Preview warnings surface compile/runtime script errors without crashing render.</div>
          </div>` : nothing}
          ${this.activeConfigSection === "fonts" ? html`<div class="section">
            <h2>Fonts</h2>
            <div class="row">
              <button @click=${() => void this.rescanFontDirectory()}>Rescan font dir</button>
            </div>
            <label>
              Font preview display
              <select .value=${this.selectedDisplayTypeId} @change=${(event: Event) => {
                this.selectedDisplayTypeId = (event.target as HTMLSelectElement).value;
                void this.refreshFontSpecimens();
              }}>
                ${(this.project.displayTypes ?? []).map((displayType) => html`<option value=${displayType.id}>${displayType.name}</option>`)}
              </select>
            </label>
            <label>
              Import font
              <input type="file" multiple accept=".ttf,.otf,font/ttf,font/otf" @change=${(event: Event) => void this.uploadFont(event)} />
            </label>
            <label>
              Sample text
              <input .value=${this.fontSpecimenSampleText} @input=${(event: Event) => {
                this.fontSpecimenSampleText = (event.target as HTMLInputElement).value;
              }} />
            </label>
            <label>
              <input type="checkbox" .checked=${this.showAllFontSpecimenSizes} @change=${(event: Event) => {
                this.showAllFontSpecimenSizes = (event.target as HTMLInputElement).checked;
                void this.refreshFontSpecimens();
              }} />
              Show all sizes
            </label>
            <div class="muted">Default: only currently selected sizes shown.</div>
            <button @click=${() => void this.refreshFontSpecimens()}>Refresh font preview</button>
            ${this.fontSpecimenLoading ? html`<div class="muted">Loading font preview...</div>` : nothing}
            ${userFonts
              .map((family) => {
                const previewFamily = family.id === activeFontPreview?.family ? activeFontPreview : undefined;
                const allowedSet = new Set(previewFamily?.allowedPixelSizes ?? family.allowedPixelSizes ?? []);
                const sizeRows = Array.from(
                  new Set(
                    previewFamily
                      ? previewFamily.variants.flatMap((variant) => variant.tiles.map((tile) => tile.size))
                      : family.allowedPixelSizes ?? []
                  )
                ).sort((left, right) => left - right);
                return html`
                  <div class="section font-preview-card">
                    <div class="row">
                      <strong>${family.label}</strong>
                      ${family.variants.map((variant) => html`<span class="muted">${variantKeyLabel(variant)}</span>`)}
                      ${family.importSource === "dafont" ? html`<span class="pill">DaFont</span>` : html`<span class="pill">Upload</span>`}
                      ${family.declaredPixelSize ? html`<span class="pill">${family.declaredPixelSize}px base</span>` : nothing}
                      ${family.licenseCategory ? html`<span class="pill">${family.licenseCategory}</span>` : nothing}
                      ${this.selectedFontPreviewFamilyId === family.id
                        ? html`<button class="primary" @click=${() => void this.refreshFontSpecimens()}>Reload preview</button>`
                        : html`<button @click=${() => {
                            this.selectedFontPreviewFamilyId = family.id;
                            void this.refreshFontSpecimens();
                          }}>Show preview</button>`}
                      ${this.confirmDeleteFontId === family.id
                        ? html`
                            <span class="muted">Delete ${family.label}?</span>
                            <button class="danger" @click=${() => void this.removeFontOption(family.id)}>Confirm</button>
                            <button @click=${() => { this.confirmDeleteFontId = ""; }}>Cancel</button>
                          `
                        : html`<button @click=${() => { this.confirmDeleteFontId = family.id; }}>Delete font</button>`}
                    </div>
                    ${family.sourceUrl ? html`<div class="muted"><a href=${family.sourceUrl} target="_blank" rel="noreferrer">Source</a></div>` : nothing}
                    <div class="muted">Allowed sizes chosen visually. Shared across whole family.</div>
                    ${previewFamily
                      ? html`
                          <div class="font-size-grid">
                            ${sizeRows.map((size) => html`
                              <div class="font-size-row">
                                <div class="font-size-row-head">
                                  <label>
                                    <input
                                      type="checkbox"
                                      .checked=${allowedSet.has(size)}
                                      @change=${(event: Event) => void this.toggleFontAllowedSize(family.id, size, (event.target as HTMLInputElement).checked)}
                                    />
                                    ${size}px
                                  </label>
                                </div>
                                <div class="font-variant-grid">
                                  ${previewFamily.variants.map((variant) => {
                                    const tile = variant.tiles.find((entry) => entry.size === size);
                                    return html`
                                      <div class="font-variant-card">
                                        <div class="font-variant-title">${variantKeyLabel(variant.variantKey)}</div>
                                        ${tile
                                          ? html`
                                              <div class="preview-stage">
                                                <img
                                                  class="font-specimen"
                                                  width=${tile.width}
                                                  height=${tile.height}
                                                  src=${`data:image/png;base64,${tile.pngBase64}`}
                                                />
                                              </div>
                                            `
                                          : html`<div class="muted">No variant</div>`}
                                      </div>
                                    `;
                                  })}
                                </div>
                              </div>
                            `)}
                          </div>
                        `
                      : html`<div class="muted">Preview not loaded.</div>`}
                  </div>
                `;
              })}
            ${this.fontSpecimenError ? html`<div class="status-error">${this.fontSpecimenError}</div>` : nothing}
            ${userFonts.length
              ? nothing
              : html`<div class="muted">No imported font previews yet.</div>`}
          </div>` : nothing}
        </div>
      `;
    }

    return html`
      <div class="detail">
        <div class="section">
          <div class="muted">Select item.</div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="shell">
        ${this.renderNavigation()}
        <section class="panel">${this.renderListPanel()}</section>
        <section class="panel detail">${this.renderDetailPanel()}</section>
        <section class="panel preview">${this.renderPreviewPanel()}</section>
      </div>
      ${this.renderUpdateLogImageModal()}
    `;
  }
}

customElements.define("epaper-editor-app", EpPaperEditorApp);
