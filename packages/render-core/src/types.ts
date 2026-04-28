export type PaletteRole = "bg" | "fg" | "accent";
export type HalftoneRole = "gray" | "light-accent" | "dark-accent";
export type FillRole = PaletteRole | HalftoneRole;
export type TextColorRole = PaletteRole | "transparent";
export type FontFamily = "px-sans" | "px-mono-special" | "ui-sans" | (string & {});
export type FontWeight = "regular" | "bold" | (string & {});
export type FontSlope = "roman" | "italic";
export type FontVariantKey = "regular" | "italic" | "bold" | "boldItalic" | (string & {});
export type FontSize = "tiny" | "normal" | "header";
export type FontRole = "tiny" | "normal" | "normalEmphasis" | "header";
export type WidgetThemeId = string;
export type BorderMergeMode = "inherit" | "always" | "never";
export type ThemeRef = "inherit" | WidgetThemeId;
export type NumericComparisonOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
export type ProviderKind = "openepaperlink" | "openepaperlink-ap" | "virtual" | (string & {});
export type ProviderDomain = "source" | "display";
export type BorderToken = "none" | "thin" | "thick";
export type WidgetBorderSize = "none" | "thin" | "thick" | "fat";
export type WidgetBorderPattern = "solid" | "dashed" | "double";
export type EdgeName = "top" | "right" | "bottom" | "left";
export type SizeSpecMode = "fixed_px" | "fill" | "fraction" | "fit_content" | "fit_glyph_bounds" | "intrinsic_font_height";
export type CompositionNodeType =
  | "stack"
  | "grid"
  | "zstack"
  | "primitive_instance"
  | "compound_ref"
  | "spacer"
  | "data_query"
  | "filter"
  | "unique"
  | "foreach"
  | "script"
  | "if_else";
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
  colorRole?: TextColorRole;
  tabularNumbers?: boolean;
  pixelSize?: number;
  lineSpacingPx?: number;
  topPaddingPx?: number;
  bypassAllowedPixelSizes?: boolean;
}

export interface IconDefinition {
  id: string;
  label: string;
  pack?: "solid" | "regular" | "brands";
  keywords?: string[];
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

export interface PlaceSearchEntry {
  id: string;
  name: string;
  displayName: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  admin1?: string;
}

export interface ProviderFieldOption {
  value: string;
  label: string;
}

export interface ProviderFieldDescriptor {
  key: string;
  label: string;
  kind: "text" | "password" | "checkbox" | "select" | "textarea";
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: unknown;
  options?: ProviderFieldOption[];
}

export interface ProviderDescriptor {
  id: string;
  label: string;
  domain: ProviderDomain;
  capabilities: string[];
  configFields: ProviderFieldDescriptor[];
}

export interface ProviderInstance {
  id: string;
  providerId: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ProviderConnectionStatus {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
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
  contentPadding: EdgeInsets;
  gridUnitPx: number;
  recommendedFontScale: number;
}

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface WidgetBorderSide {
  size?: WidgetBorderSize;
  pattern?: WidgetBorderPattern;
  thicknessPx?: number;
}

export type WidgetBorderEdges = Partial<Record<EdgeName, WidgetBorderSide>>;

export interface WidgetTheme {
  id: WidgetThemeId;
  name: string;
  border: {
    visible: boolean;
    colorRole: PaletteRole;
    mergeAdjacentBorders: boolean;
  };
  surface: {
    fillRole?: FillRole;
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
    normalEmphasis?: Partial<TextStyle>;
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
  scriptWarnings?: string[];
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
  padding?: Partial<EdgeInsets>;
  gapPx?: number;
  borderToken?: BorderToken;
  border?: WidgetBorderEdges;
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

export interface DataQueryLayoutNode extends LayoutNodeBase {
  type: "data_query";
  queryKind: "calendar_events" | "entity_states" | "weather_forecast" | "open_meteo_forecast" | "forecast" | (string & {});
  sourceProviderInstanceId?: string;
  variableName: string;
  dateVariableName?: string;
  calendarEntityIds: string[];
  entityIds?: string[];
  offsetDays: number;
  rolloverTime?: string;
  locationId?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  current?: string[] | string;
  hourly?: string[] | string;
  daily?: string[] | string;
  forecastDays?: number;
  child?: LayoutNode;
}

export interface ForEachLayoutNode extends LayoutNodeBase {
  type: "foreach";
  itemsRef: string;
  itemAlias: string;
  indexAlias: string;
  axis: "horizontal" | "vertical";
  maxItems?: number;
  child?: LayoutNode;
}

export interface FilterLayoutNode extends LayoutNodeBase {
  type: "filter";
  itemsRef: string;
  outputVariableName: string;
  itemAlias: string;
  indexAlias: string;
  condition: string;
  child?: LayoutNode;
}

export interface UniqueLayoutNode extends LayoutNodeBase {
  type: "unique";
  itemsRef: string;
  outputVariableName: string;
  itemAlias: string;
  indexAlias: string;
  keyTemplate: string;
  child?: LayoutNode;
}

export interface ScriptLibraryEntry {
  name: string;
  source: string;
}

export interface ProjectScripting {
  sharedSource?: string;
  helpers?: ScriptLibraryEntry[];
  filters?: ScriptLibraryEntry[];
}

export interface ScriptLayoutNode extends LayoutNodeBase {
  type: "script";
  source: string;
  outputMode: "merge_object";
  bindings?: Record<string, string>;
  child?: LayoutNode;
}

export interface IfElseLayoutNode extends LayoutNodeBase {
  type: "if_else";
  condition: string;
  thenChild?: LayoutNode;
  elseChild?: LayoutNode;
}

export type LayoutNode =
  | StackLayoutNode
  | GridLayoutNode
  | ZStackLayoutNode
  | PrimitiveInstanceNode
  | CompoundRefNode
  | SpacerNode
  | DataQueryLayoutNode
  | FilterLayoutNode
  | UniqueLayoutNode
  | ScriptLayoutNode
  | ForEachLayoutNode
  | IfElseLayoutNode;

export interface DisplayType {
  id: string;
  name: string;
  width: number;
  height: number;
  palette: Record<PaletteRole, string>;
  rotation: 0 | 90 | 180 | 270;
  contentPadding: EdgeInsets;
  gridUnitPx: number;
}

export interface ManagedDisplay {
  id: string;
  name: string;
  providerKind?: ProviderKind;
  providerRef?: string;
  displayProviderInstanceId?: string;
  providerDeviceRef?: string;
  displayTypeId: string;
  managed: boolean;
  virtual: boolean;
  metadata?: Record<string, unknown>;
}

export interface DiscoveredDisplayCandidate {
  id: string;
  name: string;
  providerKind?: ProviderKind;
  providerRef?: string;
  providerId: string;
  providerInstanceId: string;
  providerDeviceRef: string;
  suggestedDisplayTypeId?: string;
  suggestedDisplayType?: DisplayType;
  discoverySource?: "home-assistant" | "access-point" | "virtual";
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
  displayTypeId?: string;
  rootNode?: LayoutNode;
  popupDefaults?: {
    widthPx?: number;
    heightPx?: number;
  };
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
  | { type: "literal"; value: number | string | boolean };

export type Condition =
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition }
  | { kind: "entity_state"; entityId: string; equals: string }
  | { kind: "entity_matches"; entityId: string; pattern: string; flags?: string }
  | { kind: "entity_duration_ge"; entityId: string; state: string; minutes: number }
  | { kind: "numeric_compare"; left: ValueRef; op: "gt" | "gte" | "lt" | "lte" | "eq"; right: number }
  | { kind: "boolean_compare"; left: ValueRef; equals: boolean }
  | { kind: "is_defined"; ref: ValueRef; expected?: boolean }
  | { kind: "time_between"; start: string; end: string; weekdays?: number[] };

export interface DeviceAssignment {
  id: string;
  displayId: string;
  defaultFullscreenLayoutId?: string;
  defaultThemeId?: ThemeRef;
  schedule?: {
    enabled?: boolean;
    intervalMinutes?: number;
  };
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
  overflow?: "wrap" | "hide" | "ellipsis";
  lineSpacingPx?: number;
  renderEntityState?: boolean;
  paddingPx?: number;
  padding?: Partial<EdgeInsets>;
  borderToken?: BorderToken;
  fontRole?: FontRole;
  fixedPixelSize?: number;
  unavailableThemeId?: ThemeRef;
  numericThemeRules?: NumericThemeRule[];
  highlightFirst?: boolean;
  dateFormat?: "iso" | "day-month" | "weekday-date";
  timeFormat?: "24h" | "12h";
  colorRole?: FillRole;
  titleTextStyle?: Partial<TextStyle>;
  bodyTextStyle?: Partial<TextStyle>;
  valueTextStyle?: Partial<TextStyle>;
  items?: Array<{ label: string; color?: "fg" | "accent"; icon?: string }>;
  [key: string]: unknown;
}

export interface QueryDefinition {
  id: string;
  kind: "entity" | "history_range" | "calendar_range";
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
  locale?: string;
  defaultSourceProviderInstanceId?: string;
  scripting?: ProjectScripting;
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
  queries?: QueryDefinition[];
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

export interface ResolvedCalendarEvent {
  calendarEntityId: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  allday: boolean;
  location?: string;
  description?: string;
  raw: Record<string, unknown>;
}

export interface RenderData {
  now: string;
  entities: Record<string, EntityState>;
  queries: Record<string, QueryResult>;
  metaQueries?: Record<string, QueryResult>;
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
  scriptWarnings?: string[];
}
