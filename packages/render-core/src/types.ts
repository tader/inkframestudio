export type PaletteRole = "bg" | "fg" | "accent";
export type FontFamily = "px-sans" | "px-mono-special" | "ui-sans" | (string & {});
export type FontWeight = "regular" | "bold";
export type FontSlope = "roman" | "italic";
export type FontVariantKey = "regular" | "italic" | "bold" | "boldItalic";
export type FontSize = "tiny" | "normal" | "header";
export type WidgetThemeId = string;
export type BorderMergeMode = "inherit" | "always" | "never";
export type ThemeRef = "inherit" | WidgetThemeId;
export type NumericComparisonOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
export type ProviderKind = "openepaperlink" | "openepaperlink-ap" | "virtual" | (string & {});
export type BorderToken = "none" | "thin" | "thick";
export type SizeSpecMode = "fixed_px" | "fill" | "fraction" | "fit_content" | "intrinsic_font_height";
export type CompositionNodeType = "stack" | "grid" | "zstack" | "primitive_instance" | "compound_ref" | "spacer";
export type PrimitiveWidgetKind =
  | "text"
  | "number"
  | "icon"
  | "graph"
  | "line"
  | "box"
  | "circle"
  | "date_time_compact"
  | "agenda_list"
  | "state_tile"
  | "alert_banner"
  | "status_strip"
  | "history_bars";

export interface FontPresetValues {
  tiny: number;
  normal: number;
  header: number;
}

export interface TextStyle {
  family: FontFamily;
  weight: FontWeight;
  slope: FontSlope;
  size: FontSize;
  tabularNumbers?: boolean;
  pixelSize?: number;
  bypassAllowedPixelSizes?: boolean;
}

export interface IconDefinition {
  id: string;
  label: string;
}

export interface FontOption {
  id: string;
  label: string;
  source: "built-in" | "user";
  variants: FontVariantKey[];
  allowedPixelSizes?: number[];
  importSource?: "upload" | "dafont";
  sourceUrl?: string;
  previewUrl?: string;
  declaredPixelSize?: number;
  licenseCategory?: string;
}

export interface EntityCatalogEntry {
  entityId: string;
  friendlyName: string;
  domain: string;
  unit?: string;
}

export type PreviewDataSource = "live" | "sample";

export interface HomeAssistantConnectionSettings {
  host: string;
  token: string;
  mode: "custom" | "supervisor";
  useSupervisorProxy: boolean;
  allowInsecureTls?: boolean;
}

export interface OpenEpaperLinkAccessPointSettings {
  url: string;
  defaultTestDisplayMac?: string;
}

export interface OpenEpaperLinkAccessPointStatus {
  ok: boolean;
  message: string;
  tagCount?: number;
  networkError?: boolean;
}

export interface HomeAssistantConnectionStatus {
  ok: boolean;
  mode: HomeAssistantConnectionSettings["mode"];
  message: string;
  serverVersion?: string;
  authError?: boolean;
  networkError?: boolean;
}

export interface EditorPreviewOptions {
  showWidgetFrames: boolean;
  showWidgetLabels: boolean;
  showOverlayFrames: boolean;
  showGrid: boolean;
  showSafeMargins: boolean;
}

export interface DisplayProfile {
  id: string;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  palette: Record<PaletteRole, string>;
  safeMarginPx: number;
  gridUnitPx: number;
  recommendedFontScale: number;
}

export interface WidgetTheme {
  id: WidgetThemeId;
  name: string;
  border: {
    visible: boolean;
    colorRole: PaletteRole;
    mergeAdjacentBorders: boolean;
  };
  surface: {
    fillRole?: PaletteRole;
  };
  text: {
    title: PaletteRole;
    body: PaletteRole;
    value: PaletteRole;
  };
  accentRole: PaletteRole;
  autoFitFontFamily?: FontFamily;
  fontRoles?: {
    tiny?: Partial<TextStyle>;
    normal?: Partial<TextStyle>;
    header?: Partial<TextStyle>;
  };
  borderTokens?: Record<
    Exclude<BorderToken, "none">,
    {
      thicknessPx: number;
      colorRole: PaletteRole;
    }
  >;
  textOutline?: {
    enabled: boolean;
    colorRole: PaletteRole;
    thicknessPx: number;
  };
}

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInspectionGridCell {
  row: number;
  column: number;
  frame: Frame;
}

export interface LayoutInspectionNode {
  nodeId: string;
  nodeType: CompositionNodeType;
  label: string;
  frame: Frame;
  contentFrame: Frame;
  children: LayoutInspectionNode[];
  themeId?: string;
  isContainer: boolean;
  stackAxis?: "horizontal" | "vertical";
  gridPlacement?: GridPlacement;
  gridCells?: LayoutInspectionGridCell[];
}

export interface LayoutInspectionResult {
  width: number;
  height: number;
  root?: LayoutInspectionNode;
  popup?: LayoutInspectionNode;
}

export interface NumericThemeRule {
  op: NumericComparisonOp;
  value: number;
  themeId: ThemeRef;
}

export interface SizeSpec {
  mode: SizeSpecMode;
  value?: number;
  fontRole?: keyof FontPresetValues;
  paddingPx?: number;
}

export interface LayoutStyle {
  paddingPx?: number;
  gapPx?: number;
  borderToken?: BorderToken;
  themeId?: ThemeRef;
  horizontalAlign?: "left" | "center" | "right" | "fill";
  verticalAlign?: "top" | "middle" | "bottom" | "fill";
}

export interface CompoundInputDefinition {
  id: string;
  name: string;
  valueType: "entity" | "string" | "number" | "boolean";
  required?: boolean;
  defaultValue?: string | number | boolean;
  previewValue?: string | number | boolean;
}

export interface LayoutNodeBase {
  id: string;
  type: CompositionNodeType;
  style?: LayoutStyle;
  width?: SizeSpec;
  height?: SizeSpec;
}

export interface StackLayoutNode extends LayoutNodeBase {
  type: "stack";
  axis: "horizontal" | "vertical";
  children: LayoutNode[];
}

export interface GridTrack {
  size: SizeSpec;
}

export interface GridPlacement {
  row: number;
  column: number;
  rowSpan?: number;
  columnSpan?: number;
}

export interface GridChild {
  placement: GridPlacement;
  node: LayoutNode;
}

export interface GridLayoutNode extends LayoutNodeBase {
  type: "grid";
  rows: GridTrack[];
  columns: GridTrack[];
  children: GridChild[];
}

export interface ZStackLayoutNode extends LayoutNodeBase {
  type: "zstack";
  children: LayoutNode[];
}

export interface PrimitiveInstanceNode extends LayoutNodeBase {
  type: "primitive_instance";
  primitiveType: PrimitiveWidgetKind;
  props?: WidgetProps;
  bindings?: Record<string, string>;
}

export interface CompoundRefNode extends LayoutNodeBase {
  type: "compound_ref";
  definitionId: string;
  inputBindings?: Record<string, string>;
  inputValues?: Record<string, string | number | boolean>;
}

export interface SpacerNode extends LayoutNodeBase {
  type: "spacer";
}

export type LayoutNode =
  | StackLayoutNode
  | GridLayoutNode
  | ZStackLayoutNode
  | PrimitiveInstanceNode
  | CompoundRefNode
  | SpacerNode;

export interface DisplayType {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: Record<PaletteRole, string>;
  rotation: 0 | 90 | 180 | 270;
  safeMarginPx: number;
  gridUnitPx: number;
}

export interface ManagedDisplay {
  id: string;
  name: string;
  providerKind: ProviderKind;
  providerRef: string;
  displayTypeId: string;
  managed: boolean;
  virtual: boolean;
  metadata?: Record<string, unknown>;
}

export interface DiscoveredDisplayCandidate {
  id: string;
  name: string;
  providerKind: ProviderKind;
  providerRef: string;
  suggestedDisplayTypeId?: string;
  suggestedDisplayType?: DisplayType;
  discoverySource?: "home-assistant" | "access-point";
  metadata?: Record<string, unknown>;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  kind: "primitive" | "compound";
  primitiveType?: PrimitiveWidgetKind;
  inputSchema: CompoundInputDefinition[];
  rootNode?: LayoutNode;
}

export interface LayoutDefinition {
  id: string;
  name: string;
  kind: "fullscreen" | "popup";
  displayTypeId: string;
  rootNode?: LayoutNode;
  popupDefaults?: {
    widthPx?: number;
    heightPx?: number;
  };
  legacyScreenId?: string;
  legacyOverlayId?: string;
}

export type RuleAction =
  | { type: "activate_screen"; screenId: string }
  | { type: "activate_overlay"; overlayId: string }
  | { type: "activate_fullscreen_layout"; layoutId: string }
  | { type: "activate_popup_layout"; layoutId: string };

export interface Rule {
  id: string;
  scope: "screen_activation" | "overlay_activation" | "fullscreen_activation" | "popup_activation";
  priority: number;
  condition: Condition;
  action: RuleAction;
}

export type ValueRef =
  | { type: "entity_state"; entityId: string }
  | { type: "entity_attribute"; entityId: string; attribute: string }
  | { type: "query_value"; queryId: string; path?: string }
  | { type: "literal"; value: number | string | boolean };

export type Condition =
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | { kind: "entity_state"; entityId: string; equals: string }
  | { kind: "entity_matches"; entityId: string; pattern: string; flags?: string }
  | { kind: "entity_duration_ge"; entityId: string; state: string; minutes: number }
  | { kind: "query_empty"; queryId: string }
  | { kind: "query_not_empty"; queryId: string }
  | { kind: "numeric_compare"; left: ValueRef; op: "gt" | "gte" | "lt" | "lte" | "eq"; right: number }
  | { kind: "boolean_compare"; left: ValueRef; equals: boolean }
  | { kind: "is_defined"; ref: ValueRef; expected?: boolean }
  | { kind: "time_between"; start: string; end: string; weekdays?: number[] };

export interface DeviceAssignment {
  id: string;
  displayId: string;
  defaultFullscreenLayoutId?: string;
  defaultThemeId?: ThemeRef;
  fullscreenRules: Rule[];
  popupRules: Rule[];
}

export interface Screen {
  id: string;
  name: string;
  displayProfileId: string;
  default: boolean;
  widgetThemeId?: WidgetThemeId;
  baseWidgetIds: string[];
  overlayIds: string[];
  rules: Rule[];
}

export interface Overlay {
  id: string;
  name: string;
  screenId: string;
  frame: Frame;
  widgetIds: string[];
  priority: number;
}

export interface WidgetInstance {
  id: string;
  type:
    | "text"
    | "number"
    | "icon"
    | "graph"
    | "static_text"
    | "box"
    | "line"
    | "circle"
    | "state_tile"
    | "big_value"
    | "numeric_state"
    | "agenda_list"
    | "alert_banner"
    | "date_time_compact"
    | "status_strip"
    | "history_bars"
    | "placeholder";
  frame: Frame;
  screenId?: string;
  overlayId?: string;
  bindings: Record<string, string>;
  props: WidgetProps;
}

export interface WidgetProps {
  title?: string;
  text?: string;
  label?: string;
  header?: string;
  headline?: string;
  detail?: string;
  emptyText?: string;
  icon?: string;
  accent?: "fg" | "accent";
  border?: boolean;
  borderMerge?: BorderMergeMode;
  themeId?: ThemeRef;
  showDuration?: boolean;
  stateText?: string;
  maxItems?: number;
  quantizeStep?: number;
  digits?: number;
  unit?: string;
  lineDirection?: "horizontal" | "vertical" | "diag_down" | "diag_up";
  filled?: boolean;
  horizontalAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  valueSizingMode?: "auto_placeholder" | "fixed";
  autoFit?: boolean;
  placeholderValue?: string;
  prefix?: string;
  suffix?: string;
  placeholderText?: string;
  renderEntityState?: boolean;
  paddingPx?: number;
  borderToken?: BorderToken;
  fontRole?: "tiny" | "normal" | "header";
  fixedPixelSize?: number;
  unavailableThemeId?: ThemeRef;
  numericThemeRules?: NumericThemeRule[];
  highlightFirst?: boolean;
  dateFormat?: "iso" | "day-month" | "weekday-date";
  timeFormat?: "24h" | "12h";
  colorRole?: PaletteRole;
  titleTextStyle?: Partial<TextStyle>;
  bodyTextStyle?: Partial<TextStyle>;
  valueTextStyle?: Partial<TextStyle>;
  items?: Array<{ label: string; color?: "fg" | "accent"; icon?: string }>;
  [key: string]: unknown;
}

export interface QueryDefinition {
  id: string;
  kind: "entity" | "history_range" | "calendar_range" | "template_derived";
  params: Record<string, unknown>;
  refreshPolicy: {
    mode: "poll" | "event";
    intervalSeconds?: number;
  };
}

export interface Scenario {
  id: string;
  name: string;
  frozenNow?: string;
  entityOverrides?: Record<string, EntityState>;
  queryOverrides?: Record<string, QueryResult>;
  forcedScreenId?: string;
  forcedOverlayId?: string;
}

export interface Project {
  id: string;
  name: string;
  version: number;
  fontPresets: FontPresetValues;
  themes: WidgetTheme[];
  displayTypes?: DisplayType[];
  devices?: ManagedDisplay[];
  widgetDefinitions?: WidgetDefinition[];
  layoutDefinitions?: LayoutDefinition[];
  deviceAssignments?: DeviceAssignment[];
  screens: Screen[];
  overlays: Overlay[];
  widgets: WidgetInstance[];
  queries: QueryDefinition[];
  scenarios: Scenario[];
}

export interface EntityState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
}

export interface QueryResult {
  kind: string;
  value?: number | string | boolean | null;
  items?: Array<Record<string, unknown>>;
  points?: Array<{ timestamp: string; value: number }>;
  meta?: Record<string, unknown>;
}

export interface RenderData {
  now: string;
  entities: Record<string, EntityState>;
  queries: Record<string, QueryResult>;
}

export interface ResolvedProjectState {
  displayProfile: DisplayProfile;
  activeScreen: Screen;
  activeOverlay?: Overlay;
  widgets: WidgetInstance[];
  data: RenderData;
}

export interface RenderedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
  rgba: Uint8ClampedArray;
  hash: string;
  activeScreenId: string;
  activeOverlayId?: string;
}
