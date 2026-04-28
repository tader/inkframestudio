import { createStableHash } from "./hash.js";
import { evaluateCondition } from "./condition-eval.js";
import { defaultIconId } from "./icons.js";
import { applyScopeTemplate, evaluateArrayExpression, evaluateScopeExpression, evaluateScopeValueExpression, resolveScopePath, stringifyScopeValue, type ScopeContext } from "./layout-meta.js";
import { COLOR_ACCENT, COLOR_BG, COLOR_FG, PixelBuffer, type PixelClipRect, type PixelPaint } from "./pixel-buffer.js";
import { formatQuantizedNumber } from "./quantize.js";
import { createActiveRenderScripting, type ActiveRenderScripting } from "./scripting.js";
import { layoutText } from "./text-layout.js";
import { DEFAULT_WIDGET_THEME_ID, DEFAULT_WIDGET_THEMES } from "./themes.js";
import type {
  BorderToken,
  DataQueryLayoutNode,
  DeviceAssignment,
  DisplayType,
  EdgeInsets,
  FillRole,
  FontRole,
  FilterLayoutNode,
  FontPresetValues,
  Frame,
  LayoutDefinition,
  LayoutInspectionGridCell,
  LayoutInspectionNode,
  LayoutInspectionResult,
  LayoutNode,
  ManagedDisplay,
  PrimitiveInstanceNode,
  Project,
  RenderData,
  RenderedImage,
  ScriptLayoutNode,
  SizeSpec,
  TextStyle,
  UniqueLayoutNode,
  WidgetBorderEdges,
  WidgetBorderPattern,
  WidgetBorderSide,
  WidgetBorderSize,
  WidgetTheme
} from "./types.js";

interface PixelFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

let activeRenderScripting: ActiveRenderScripting | undefined;

function withActiveRenderScripting<T>(value: ActiveRenderScripting, work: () => T): T {
  const previous = activeRenderScripting;
  activeRenderScripting = value;
  try {
    return work();
  } finally {
    activeRenderScripting = previous;
  }
}

function templateOptions(scope: ScopeContext, locale = "en-US") {
  return {
    locale,
    scope,
    globals: activeRenderScripting?.globals,
    helpers: activeRenderScripting?.helpers as Record<string, unknown> | undefined,
    filters: activeRenderScripting?.filters,
    warn: (message: string) => activeRenderScripting?.warnings.push(message)
  };
}

function parseHexColor(value: string): [number, number, number] {
  const safe = value.startsWith("#") ? value.slice(1) : value;
  const numeric = Number.parseInt(safe, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function rgbaFromPixels(buffer: PixelBuffer, displayType: DisplayType): Uint8ClampedArray {
  const colors = [
    parseHexColor(displayType.palette.bg),
    parseHexColor(displayType.palette.fg),
    parseHexColor(displayType.palette.accent)
  ];
  const rgba = new Uint8ClampedArray(buffer.width * buffer.height * 4);
  for (let index = 0; index < buffer.pixels.length; index += 1) {
    const [r, g, b] = colors[buffer.pixels[index]] ?? colors[0];
    const offset = index * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function roleToColor(role: "bg" | "fg" | "accent"): number {
  if (role === "bg") return COLOR_BG;
  if (role === "accent") return COLOR_ACCENT;
  return COLOR_FG;
}

function fillRoleToPaint(role: FillRole | undefined): PixelPaint | undefined {
  if (!role) {
    return undefined;
  }
  if (role === "gray") {
    return { kind: "checker", primary: COLOR_BG, secondary: COLOR_FG };
  }
  if (role === "light-accent") {
    return { kind: "checker", primary: COLOR_BG, secondary: COLOR_ACCENT };
  }
  if (role === "dark-accent") {
    return { kind: "checker", primary: COLOR_FG, secondary: COLOR_ACCENT };
  }
  return { kind: "solid", color: roleToColor(role) };
}

function textRoleToColor(role: TextStyle["colorRole"] | undefined, fallback: "bg" | "fg" | "accent"): number | undefined {
  if (role === "transparent") {
    return undefined;
  }
  return roleToColor((role ?? fallback) as "bg" | "fg" | "accent");
}

function resolveTheme(project: Project, themeId?: string): WidgetTheme {
  return (
    project.themes.find((theme) => theme.id === themeId) ??
    project.themes.find((theme) => theme.id === DEFAULT_WIDGET_THEME_ID) ??
    DEFAULT_WIDGET_THEMES[0]
  );
}

function resolveDisplayType(project: Project, displayTypeId: string): DisplayType {
  const displayType = project.displayTypes?.find((entry) => entry.id === displayTypeId);
  if (!displayType) {
    throw new Error(`Unknown display type ${displayTypeId}`);
  }
  return displayType;
}

function borderThickness(theme: WidgetTheme, token?: BorderToken): number {
  if (!token || token === "none") {
    return 0;
  }
  return theme.borderTokens?.[token]?.thicknessPx ?? (token === "thick" ? 2 : 1);
}

function borderColor(theme: WidgetTheme, token?: BorderToken): number {
  if (!token || token === "none") {
    return roleToColor(theme.border.colorRole);
  }
  return roleToColor(theme.borderTokens?.[token]?.colorRole ?? theme.border.colorRole);
}

function legacyBorderSide(token: BorderToken | undefined): WidgetBorderSide {
  if (!token || token === "none") {
    return { size: "none", pattern: "solid", thicknessPx: 0 };
  }
  return { size: token === "thick" ? "thick" : "thin", pattern: "solid", thicknessPx: token === "thick" ? 2 : 1 };
}

function defaultBorderThickness(size: WidgetBorderSize | undefined): number {
  if (!size || size === "none") return 0;
  if (size === "thick") return 2;
  if (size === "fat") return 3;
  return 1;
}

function normalizedBorderSide(side: WidgetBorderSide | undefined, fallback: WidgetBorderSide): WidgetBorderSide {
  const legacyPattern = side?.pattern as string | undefined;
  const size = side?.size ?? (legacyPattern === "none" || legacyPattern === "thin" || legacyPattern === "thick" || legacyPattern === "fat" ? legacyPattern : undefined) ?? fallback.size ?? "none";
  const pattern = side?.pattern && !["none", "thin", "thick", "fat"].includes(side.pattern) ? side.pattern : fallback.pattern ?? "solid";
  const thicknessPx = Math.max(0, Math.trunc(Number(side?.thicknessPx ?? fallback.thicknessPx ?? defaultBorderThickness(size)) || 0));
  return { size, pattern, thicknessPx: size === "none" ? 0 : Math.max(1, thicknessPx || defaultBorderThickness(size)) };
}

function nodeBorderEdges(node: LayoutNode): Required<WidgetBorderEdges> {
  const styleBorder = node.style?.border;
  const legacy = legacyBorderSide(node.type === "primitive_instance" ? node.props?.borderToken ?? node.style?.borderToken : node.style?.borderToken);
  return {
    top: normalizedBorderSide(styleBorder?.top, legacy),
    right: normalizedBorderSide(styleBorder?.right, legacy),
    bottom: normalizedBorderSide(styleBorder?.bottom, legacy),
    left: normalizedBorderSide(styleBorder?.left, legacy)
  };
}

function borderSideThickness(side: WidgetBorderSide | undefined): number {
  const lineThickness = side?.size === "none" ? 0 : Math.max(0, Math.trunc(Number(side?.thicknessPx ?? defaultBorderThickness(side?.size)) || 0));
  return side?.pattern === "double" && lineThickness > 0 ? lineThickness * 3 : lineThickness;
}

function borderSideLineThickness(side: WidgetBorderSide | undefined): number {
  return side?.size === "none" ? 0 : Math.max(0, Math.trunc(Number(side?.thicknessPx ?? defaultBorderThickness(side?.size)) || 0));
}

function nodeBorderInsets(node: LayoutNode): EdgeInsets {
  const border = nodeBorderEdges(node);
  return {
    top: borderSideThickness(border.top),
    right: borderSideThickness(border.right),
    bottom: borderSideThickness(border.bottom),
    left: borderSideThickness(border.left)
  };
}

function addInsets(left: Partial<EdgeInsets>, right: Partial<EdgeInsets>): EdgeInsets {
  return {
    top: Math.max(0, Number(left.top ?? 0)) + Math.max(0, Number(right.top ?? 0)),
    right: Math.max(0, Number(left.right ?? 0)) + Math.max(0, Number(right.right ?? 0)),
    bottom: Math.max(0, Number(left.bottom ?? 0)) + Math.max(0, Number(right.bottom ?? 0)),
    left: Math.max(0, Number(left.left ?? 0)) + Math.max(0, Number(right.left ?? 0))
  };
}

function subtractInsets(outer: Partial<EdgeInsets>, inner: Partial<EdgeInsets>): EdgeInsets {
  return {
    top: Math.max(0, Number(outer.top ?? 0) - Math.max(0, Number(inner.top ?? 0))),
    right: Math.max(0, Number(outer.right ?? 0) - Math.max(0, Number(inner.right ?? 0))),
    bottom: Math.max(0, Number(outer.bottom ?? 0) - Math.max(0, Number(inner.bottom ?? 0))),
    left: Math.max(0, Number(outer.left ?? 0) - Math.max(0, Number(inner.left ?? 0)))
  };
}

function maxHorizontalInsets(insets: Partial<EdgeInsets>): number {
  return Math.max(0, Number(insets.left ?? 0)) + Math.max(0, Number(insets.right ?? 0));
}

function maxVerticalInsets(insets: Partial<EdgeInsets>): number {
  return Math.max(0, Number(insets.top ?? 0)) + Math.max(0, Number(insets.bottom ?? 0));
}

function drawBorderSpan(
  buffer: PixelBuffer,
  color: number,
  horizontal: boolean,
  fixed: number,
  start: number,
  end: number,
  clip: PixelClipRect | undefined,
  draw: boolean
): void {
  if (!draw) return;
  for (let pos = start; pos < end; pos += 1) {
    if (horizontal) {
      buffer.setPixel(pos, fixed, color, clip);
    } else {
      buffer.setPixel(fixed, pos, color, clip);
    }
  }
}

function drawBorderSide(
  buffer: PixelBuffer,
  frame: PixelFrame,
  side: "top" | "right" | "bottom" | "left",
  spec: WidgetBorderSide,
  color: number,
  clip?: PixelClipRect
): void {
  const pattern = spec.pattern ?? "solid";
  const lineThickness = borderSideLineThickness(spec);
  const totalThickness = borderSideThickness(spec);
  if (spec.size === "none" || totalThickness <= 0 || frame.w <= 0 || frame.h <= 0) {
    return;
  }
  const horizontal = side === "top" || side === "bottom";
  const start = horizontal ? frame.x : frame.y;
  const end = horizontal ? frame.x + frame.w : frame.y + frame.h;
  const outer = side === "top" ? frame.y : side === "bottom" ? frame.y + frame.h - 1 : side === "left" ? frame.x : frame.x + frame.w - 1;
  for (let offset = 0; offset < totalThickness; offset += 1) {
    const fixed = side === "top" || side === "left" ? outer + offset : outer - offset;
    const draw =
      pattern === "dashed"
        ? Math.floor((offset + (horizontal ? start : fixed)) / 4) % 2 === 0
        : pattern !== "double" || offset < lineThickness || offset >= lineThickness * 2;
    if (pattern === "dashed") {
      for (let pos = start; pos < end; pos += 1) {
        const dashed = Math.floor((pos - start) / 4) % 2 === 0;
        drawBorderSpan(buffer, color, horizontal, fixed, pos, pos + 1, clip, dashed);
      }
    } else {
      drawBorderSpan(buffer, color, horizontal, fixed, start, end, clip, draw);
    }
  }
}

function drawNodeBorder(buffer: PixelBuffer, node: LayoutNode, frame: PixelFrame, theme: WidgetTheme, visibleFrame: PixelFrame): void {
  const border = nodeBorderEdges(node);
  const color = borderColor(theme, node.type === "primitive_instance" ? node.props?.borderToken ?? node.style?.borderToken : node.style?.borderToken);
  const clip = toClipRect(visibleFrame);
  drawBorderSide(buffer, frame, "top", border.top, color, clip);
  drawBorderSide(buffer, frame, "right", border.right, color, clip);
  drawBorderSide(buffer, frame, "bottom", border.bottom, color, clip);
  drawBorderSide(buffer, frame, "left", border.left, color, clip);
}

function insetFrame(frame: PixelFrame, pixels: number): PixelFrame {
  return {
    x: frame.x + pixels,
    y: frame.y + pixels,
    w: Math.max(0, frame.w - pixels * 2),
    h: Math.max(0, frame.h - pixels * 2)
  };
}

function insetFrameByEdges(frame: PixelFrame, insets?: Partial<EdgeInsets>): PixelFrame {
  const top = Math.max(0, Math.trunc(Number(insets?.top ?? 0) || 0));
  const right = Math.max(0, Math.trunc(Number(insets?.right ?? 0) || 0));
  const bottom = Math.max(0, Math.trunc(Number(insets?.bottom ?? 0) || 0));
  const left = Math.max(0, Math.trunc(Number(insets?.left ?? 0) || 0));
  return {
    x: frame.x + left,
    y: frame.y + top,
    w: Math.max(0, frame.w - left - right),
    h: Math.max(0, frame.h - top - bottom)
  };
}

function asFrame(frame: PixelFrame): Frame {
  return {
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h
  };
}

function hasArea(frame: PixelFrame | undefined): frame is PixelFrame {
  return Boolean(frame && frame.w > 0 && frame.h > 0);
}

function intersectFrame(frame: PixelFrame, clip: PixelFrame): PixelFrame | undefined {
  const x = Math.max(frame.x, clip.x);
  const y = Math.max(frame.y, clip.y);
  const right = Math.min(frame.x + frame.w, clip.x + clip.w);
  const bottom = Math.min(frame.y + frame.h, clip.y + clip.h);
  if (right <= x || bottom <= y) {
    return undefined;
  }
  return {
    x,
    y,
    w: right - x,
    h: bottom - y
  };
}

function toClipRect(frame: PixelFrame): PixelClipRect {
  return frame;
}

function nodeLabel(project: Project, node: LayoutNode): string {
  if (node.type === "primitive_instance") {
    return node.primitiveType;
  }
  if (node.type === "compound_ref") {
    return (
      project.widgetDefinitions?.find((entry) => entry.id === node.definitionId)?.name ??
      "compound"
    );
  }
  if (node.type === "data_query") {
    return `query:${node.variableName || "data"}`;
  }
  if (node.type === "filter") {
    return `filter:${node.outputVariableName || "items"}`;
  }
  if (node.type === "unique") {
    return `unique:${node.outputVariableName || "items"}`;
  }
  if (node.type === "foreach") {
    return `foreach:${node.itemAlias || "item"}`;
  }
  if (node.type === "script") {
    return "script";
  }
  if (node.type === "if_else") {
    return "if/else";
  }
  return node.type;
}

function buildInspectionNode(
  project: Project,
  node: LayoutNode,
  frame: PixelFrame,
  contentFrame: PixelFrame,
  themeId: string | undefined,
  children: LayoutInspectionNode[],
  extras?: Partial<LayoutInspectionNode>
): LayoutInspectionNode {
  return {
    nodeId: node.id,
    nodeType: node.type,
    label: nodeLabel(project, node),
    frame: asFrame(frame),
    contentFrame: asFrame(contentFrame),
    children,
    themeId,
    isContainer:
      node.type === "stack" ||
      node.type === "grid" ||
      node.type === "zstack" ||
      node.type === "data_query" ||
      node.type === "filter" ||
      node.type === "unique" ||
      node.type === "foreach" ||
      node.type === "script" ||
      node.type === "if_else",
    ...extras
  };
}

function getNodePadding(node: LayoutNode): number {
  if (node.type === "primitive_instance") {
    return Math.max(0, Number(node.props?.paddingPx ?? node.style?.paddingPx ?? 0));
  }
  return Math.max(0, Number(node.style?.paddingPx ?? 0));
}

function getNodePaddingEdges(node: LayoutNode): EdgeInsets {
  const uniform = getNodePadding(node);
  const stylePadding = node.style?.padding;
  const propPadding = node.type === "primitive_instance" ? node.props?.padding : undefined;
  return {
    top: Math.max(0, Number(propPadding?.top ?? stylePadding?.top ?? uniform)),
    right: Math.max(0, Number(propPadding?.right ?? stylePadding?.right ?? uniform)),
    bottom: Math.max(0, Number(propPadding?.bottom ?? stylePadding?.bottom ?? uniform)),
    left: Math.max(0, Number(propPadding?.left ?? stylePadding?.left ?? uniform))
  };
}

function getNodeChromeInsets(node: LayoutNode): EdgeInsets {
  return addInsets(nodeBorderInsets(node), getNodePaddingEdges(node));
}

function textOverflowMode(node: PrimitiveInstanceNode): "wrap" | "hide" | "ellipsis" {
  return node.primitiveType === "text"
    ? (node.props?.overflow as "wrap" | "hide" | "ellipsis" | undefined) ?? "wrap"
    : "hide";
}

function textLineSpacingPx(node: PrimitiveInstanceNode, theme: WidgetTheme): number {
  if (node.primitiveType !== "text") {
    return 0;
  }
  const fontRole = node.props?.fontRole ?? "normal";
  return Math.round(Number(
    node.props?.lineSpacingPx
      ?? node.props?.bodyTextStyle?.lineSpacingPx
      ?? theme.fontRoles?.[fontRole]?.lineSpacingPx
      ?? 0
  ));
}

function textTopPaddingPx(node: PrimitiveInstanceNode, theme: WidgetTheme): number {
  if (node.primitiveType !== "text") {
    return 0;
  }
  const fontRole = node.props?.fontRole ?? "normal";
  return Math.round(Number(
    node.props?.bodyTextStyle?.topPaddingPx
      ?? theme.fontRoles?.[fontRole]?.topPaddingPx
      ?? 0
  ));
}

function totalTextBlockHeight(metrics: Array<{ lineHeight: number }>, lineSpacingPx = 0): number {
  return metrics.reduce((sum, entry, index) => (
    sum + entry.lineHeight + (index < metrics.length - 1 ? lineSpacingPx : 0)
  ), 0);
}

function adjustedTextBlockHeight(totalHeight: number, topPaddingPx = 0): number {
  return Math.max(1, totalHeight + topPaddingPx);
}

function lineAdvance(lineHeight: number, lineSpacingPx = 0): number {
  return Math.max(1, lineHeight + lineSpacingPx);
}

function fontRoleToSize(role: FontRole): TextStyle["size"] {
  if (role === "tiny" || role === "header") {
    return role;
  }
  return "normal";
}

function primitiveTextStyles(
  node: PrimitiveInstanceNode,
  theme: WidgetTheme
): { bodyStyle: Partial<TextStyle>; valueStyle: Partial<TextStyle> } {
  const fontRole = (node.props?.fontRole ?? (node.primitiveType === "number" ? "header" : "normal")) as FontRole;
  return {
    bodyStyle: {
      family: theme.fontRoles?.[fontRole]?.family ?? node.props?.bodyTextStyle?.family ?? "px-sans",
      weight: theme.fontRoles?.[fontRole]?.weight ?? node.props?.bodyTextStyle?.weight ?? "regular",
      slope: theme.fontRoles?.[fontRole]?.slope ?? node.props?.bodyTextStyle?.slope ?? "roman",
      size: node.props?.bodyTextStyle?.size ?? fontRoleToSize(fontRole),
      pixelSize: theme.fontRoles?.[fontRole]?.pixelSize,
      colorRole: node.props?.bodyTextStyle?.colorRole ?? theme.fontRoles?.[fontRole]?.colorRole,
      lineSpacingPx: node.props?.bodyTextStyle?.lineSpacingPx ?? theme.fontRoles?.[fontRole]?.lineSpacingPx,
      topPaddingPx: node.props?.bodyTextStyle?.topPaddingPx ?? theme.fontRoles?.[fontRole]?.topPaddingPx
    },
    valueStyle: {
      family: theme.fontRoles?.[fontRole]?.family ?? node.props?.valueTextStyle?.family ?? "px-mono-special",
      weight: theme.fontRoles?.[fontRole]?.weight ?? node.props?.valueTextStyle?.weight ?? "regular",
      slope: theme.fontRoles?.[fontRole]?.slope ?? node.props?.valueTextStyle?.slope ?? "roman",
      size: node.props?.valueTextStyle?.size ?? fontRoleToSize(fontRole),
      pixelSize: theme.fontRoles?.[fontRole]?.pixelSize,
      colorRole: node.props?.valueTextStyle?.colorRole ?? theme.fontRoles?.[fontRole]?.colorRole,
      lineSpacingPx: node.props?.valueTextStyle?.lineSpacingPx ?? theme.fontRoles?.[fontRole]?.lineSpacingPx,
      topPaddingPx: node.props?.valueTextStyle?.topPaddingPx ?? theme.fontRoles?.[fontRole]?.topPaddingPx,
      tabularNumbers: node.primitiveType === "number"
    }
  };
}

function autoFitAllowed(node: PrimitiveInstanceNode): boolean {
  return (
    node.width?.mode !== "fit_content" &&
    node.height?.mode !== "fit_content" &&
    node.width?.mode !== "fit_glyph_bounds" &&
    node.height?.mode !== "fit_glyph_bounds"
  );
}

const FIT_CONTENT_MAX = 10_000;

function intrinsicWidthForNode(
  node: LayoutNode,
  availableWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number {
  const spec = node.width;
  if (!spec || spec.mode === "fill") {
    return fitContentWidth(node, availableWidth, buffer, theme, fontPresets, data, inputContext, locale);
  }
  return resolveSize(spec, FIT_CONTENT_MAX, "width", node, buffer, theme, fontPresets, data, inputContext, availableWidth, locale);
}

function intrinsicHeightForNode(
  node: LayoutNode,
  contentWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number {
  const spec = node.height;
  if (!spec || spec.mode === "fill") {
    return fitContentHeight(node, contentWidth, buffer, theme, fontPresets, data, inputContext, locale);
  }
  return resolveSize(spec, FIT_CONTENT_MAX, "height", node, buffer, theme, fontPresets, data, inputContext, contentWidth, locale);
}

function assignStackMainSizes(
  children: LayoutNode[],
  horizontal: boolean,
  availableMain: number,
  crossAvailable: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number[] {
  const assigned = new Array<number>(children.length).fill(0);
  let consumed = 0;
  let fillCount = 0;
  let fractionTotal = 0;
  children.forEach((child, index) => {
    const spec = horizontal ? child.width : child.height;
    if (!spec || spec.mode === "fill") {
      fillCount += 1;
      return;
    }
    if (spec.mode === "fraction") {
      fractionTotal += spec.value ?? 1;
      return;
    }
    const contentWidthHint = horizontal
      ? availableMain
      : resolveSize(
          child.width,
          crossAvailable,
          "width",
          child,
          buffer,
          theme,
          fontPresets,
          data,
          inputContext,
          crossAvailable,
          locale
        );
    assigned[index] = resolveSize(
      spec,
      availableMain,
      horizontal ? "width" : "height",
      child,
      buffer,
      theme,
      fontPresets,
      data,
      inputContext,
      contentWidthHint,
      locale
    );
    consumed += assigned[index];
  });
  const remainingAfterFixed = Math.max(0, availableMain - consumed);
  children.forEach((child, index) => {
    const spec = horizontal ? child.width : child.height;
    if (spec?.mode === "fraction") {
      assigned[index] = Math.floor(remainingAfterFixed * ((spec.value ?? 1) / Math.max(1, fractionTotal)));
    }
  });
  const used = assigned.reduce((sum, value) => sum + value, 0);
  const remaining = Math.max(0, availableMain - used);
  children.forEach((child, index) => {
    const spec = horizontal ? child.width : child.height;
    if (!spec || spec.mode === "fill") {
      assigned[index] = Math.floor(remaining / Math.max(1, fillCount));
    }
  });
  return assigned;
}

function fitContentWidth(
  node: LayoutNode,
  availableWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number {
  const chromeInsets = getNodeChromeInsets(node);
  const chrome = maxHorizontalInsets(chromeInsets);
  const innerWidth = Math.max(1, availableWidth - chrome);

  if (node.type === "stack") {
    const gap = Math.max(0, Number(node.style?.gapPx ?? 0));
    if (!node.children.length) {
      return chrome;
    }
    if (node.axis === "horizontal") {
      const total = node.children.reduce((sum, child) => (
        sum + intrinsicWidthForNode(child, innerWidth, buffer, theme, fontPresets, data, inputContext, locale)
      ), 0);
      return total + gap * Math.max(0, node.children.length - 1) + chrome;
    }
    const maxChild = node.children.reduce((max, child) => (
      Math.max(max, intrinsicWidthForNode(child, innerWidth, buffer, theme, fontPresets, data, inputContext, locale))
    ), 0);
    return maxChild + chrome;
  }

  if (node.type === "zstack") {
    const maxChild = node.children.reduce((max, child) => (
      Math.max(max, intrinsicWidthForNode(child, innerWidth, buffer, theme, fontPresets, data, inputContext, locale))
    ), 0);
    return maxChild + chrome;
  }

  if (node.type === "data_query" || node.type === "filter" || node.type === "unique") {
    const nestedContext =
      node.type === "data_query"
        ? dataQueryScope(node, data, inputContext)
        : node.type === "filter"
          ? filterNodeScope(node, inputContext, locale)
          : uniqueNodeScope(node, inputContext, locale);
    return (node.child
      ? intrinsicWidthForNode(node.child, innerWidth, buffer, theme, fontPresets, data, nestedContext, locale)
      : 0) + chrome;
  }

  if (node.type === "script") {
    const nestedContext = scriptNodeScope(node, inputContext, locale);
    return (node.child
      ? intrinsicWidthForNode(node.child, innerWidth, buffer, theme, fontPresets, data, nestedContext, locale)
      : 0) + chrome;
  }

  if (node.type === "foreach") {
    return (node.child
      ? intrinsicWidthForNode(node.child, innerWidth, buffer, theme, fontPresets, data, inputContext, locale)
      : 0) + chrome;
  }

  if (node.type === "if_else") {
    const branch = evaluateScopeExpression(node.condition, inputContext) ? node.thenChild : node.elseChild;
    return (branch
      ? intrinsicWidthForNode(branch, innerWidth, buffer, theme, fontPresets, data, inputContext, locale)
      : 0) + chrome;
  }

  if (node.type !== "primitive_instance") {
    return chrome;
  }

  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);
  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveEntityState(node.bindings?.entity, data, inputContext, locale)
      : String(node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext, locale));
    const text = applyInputTemplate(rawText, inputContext, locale);
    const style = { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    const widestLine = text.split("\n").reduce((max, line) => Math.max(max, buffer.measureText(line, style).width), 0);
    return widestLine + chrome;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveEntityState(node.bindings?.entity, data, inputContext, locale), inputContext, locale);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext, locale);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext, locale);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const style = { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    return buffer.measureText(display, style).width + chrome;
  }

  if (node.primitiveType === "icon") {
    return 10 + chrome;
  }

  if (node.primitiveType === "line") {
    return 1 + chrome;
  }

  return buffer.measureText(node.primitiveType.toUpperCase(), bodyStyle).width + chrome;
}

function fitContentHeight(
  node: LayoutNode,
  contentWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number {
  const chromeInsets = getNodeChromeInsets(node);
  const chrome = maxVerticalInsets(chromeInsets);
  const innerWidth = Math.max(1, contentWidth - maxHorizontalInsets(chromeInsets));

  if (node.type === "stack") {
    const horizontal = node.axis === "horizontal";
    const children = node.children;
    const gap = Math.max(0, Number(node.style?.gapPx ?? 0));
    if (!children.length) {
      return chrome;
    }
    if (horizontal) {
      const availableMain = Math.max(0, innerWidth - gap * Math.max(0, children.length - 1));
      const assigned = assignStackMainSizes(children, true, availableMain, innerWidth, buffer, theme, fontPresets, data, inputContext, locale);
      const cross = children.reduce((max, child, index) => (
        Math.max(max, intrinsicHeightForNode(child, Math.max(1, assigned[index] ?? innerWidth), buffer, theme, fontPresets, data, inputContext, locale))
      ), 0);
      return cross + chrome;
    }
    const total = children.reduce((sum, child) => {
      const childWidth = resolveSize(child.width, innerWidth, "width", child, buffer, theme, fontPresets, data, inputContext, innerWidth, locale);
      return sum + intrinsicHeightForNode(child, Math.max(1, childWidth), buffer, theme, fontPresets, data, inputContext, locale);
    }, 0);
    return total + gap * Math.max(0, children.length - 1) + chrome;
  }

  if (node.type === "zstack") {
    const maxChild = node.children.reduce((max, child) => {
      const childWidth = resolveSize(child.width, innerWidth, "width", child, buffer, theme, fontPresets, data, inputContext, innerWidth, locale);
      return Math.max(max, intrinsicHeightForNode(child, Math.max(1, childWidth), buffer, theme, fontPresets, data, inputContext, locale));
    }, 0);
    return maxChild + chrome;
  }

  if (node.type === "data_query" || node.type === "filter" || node.type === "unique") {
    const nestedContext =
      node.type === "data_query"
        ? dataQueryScope(node, data, inputContext)
        : node.type === "filter"
          ? filterNodeScope(node, inputContext, locale)
          : uniqueNodeScope(node, inputContext, locale);
    return (node.child
      ? intrinsicHeightForNode(node.child, innerWidth, buffer, theme, fontPresets, data, nestedContext, locale)
      : 0) + chrome;
  }

  if (node.type === "script") {
    const nestedContext = scriptNodeScope(node, inputContext, locale);
    return (node.child
      ? intrinsicHeightForNode(node.child, innerWidth, buffer, theme, fontPresets, data, nestedContext, locale)
      : 0) + chrome;
  }

  if (node.type === "foreach") {
    return (node.child
      ? intrinsicHeightForNode(node.child, innerWidth, buffer, theme, fontPresets, data, inputContext, locale)
      : 0) + chrome;
  }

  if (node.type === "if_else") {
    const branch = evaluateScopeExpression(node.condition, inputContext) ? node.thenChild : node.elseChild;
    return (branch
      ? intrinsicHeightForNode(branch, innerWidth, buffer, theme, fontPresets, data, inputContext, locale)
      : 0) + chrome;
  }

  if (node.type !== "primitive_instance") {
    return chrome;
  }

  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);

  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveEntityState(node.bindings?.entity, data, inputContext, locale)
      : String(node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext, locale));
    const text = applyInputTemplate(rawText, inputContext, locale);
    const placeholder = applyInputTemplate(String(node.props?.placeholderText ?? ""), inputContext, locale);
    const overflow = textOverflowMode(node);
    const lineSpacingPx = textLineSpacingPx(node, theme);
    const topPaddingPx = textTopPaddingPx(node, theme);
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          { x: 0, y: 0, w: innerWidth, h: 10_000 },
          bodyStyle,
          text,
          placeholder,
          overflow === "wrap",
          lineSpacingPx
        )
      : { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    const lines = layoutTextLines(buffer, text, style, innerWidth, overflow);
    const totalHeight = totalTextBlockHeight(lines.map((line) => buffer.measureText(line, style)), lineSpacingPx);
    return adjustedTextBlockHeight(totalHeight, topPaddingPx) + chrome;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveEntityState(node.bindings?.entity, data, inputContext, locale), inputContext, locale);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext, locale);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext, locale);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const placeholder = `${prefix}${applyInputTemplate(String(node.props?.placeholderValue ?? ""), inputContext, locale)}${suffix}`;
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          { x: 0, y: 0, w: innerWidth, h: 10_000 },
          valueStyle,
          display,
          placeholder,
          false
        )
      : { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    return adjustedTextBlockHeight(buffer.measureText(display, style).lineHeight, Math.round(Number(style.topPaddingPx ?? 0))) + chrome;
  }

  if (node.primitiveType === "icon") {
    return 10 + chrome;
  }

  if (node.primitiveType === "line") {
    return 1 + chrome;
  }

  return adjustedTextBlockHeight(buffer.measureText(node.primitiveType.toUpperCase(), bodyStyle).lineHeight, Math.round(Number(bodyStyle.topPaddingPx ?? 0))) + chrome;
}

function renderedTextBlockHeight(
  buffer: PixelBuffer,
  lines: string[],
  style: Partial<TextStyle>,
  width: number,
  lineSpacingPx = 0,
  outlineThickness = 0
): number {
  const raster = rasterizedTextBlock(buffer, lines, style, width, lineSpacingPx, COLOR_FG, outlineThickness > 0 ? COLOR_FG : undefined, "left");
  return raster.paintedHeight > 0 ? raster.paintedHeight : raster.totalHeight;
}

function rasterizedTextBlock(
  buffer: PixelBuffer,
  lines: string[],
  style: Partial<TextStyle>,
  width: number,
  lineSpacingPx: number,
  fillColor: number | undefined,
  outlineColor: number | undefined,
  horizontalAlign: "left" | "center" | "right"
): { raster: PixelBuffer; minY: number; maxY: number; paintedHeight: number; totalHeight: number } {
  if (!lines.length) {
    return {
      raster: new PixelBuffer(Math.max(1, width), 1, COLOR_BG, buffer.fontPresets),
      minY: 0,
      maxY: -1,
      paintedHeight: 0,
      totalHeight: 0
    };
  }
  const metrics = lines.map((line) => buffer.measureText(line, style));
  const totalHeight = totalTextBlockHeight(metrics, lineSpacingPx);
  const temp = new PixelBuffer(Math.max(1, width), Math.max(1, totalHeight), COLOR_BG, buffer.fontPresets);
  let cursorY = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const runMetrics = metrics[index]!;
    const startX =
      horizontalAlign === "left"
        ? 0
        : horizontalAlign === "right"
          ? temp.width - runMetrics.width
          : Math.floor((temp.width - runMetrics.width) / 2);
    const mask = new PixelBuffer(temp.width, temp.height, COLOR_BG, buffer.fontPresets);
    mask.drawText(line, startX, cursorY, style, COLOR_FG);
    if (outlineColor !== undefined) {
      for (let y = 0; y < temp.height; y += 1) {
        for (let x = 0; x < temp.width; x += 1) {
          if (mask.getPixel(x, y) !== COLOR_FG) {
            continue;
          }
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              if (ox === 0 && oy === 0) {
                continue;
              }
              const px = x + ox;
              const py = y + oy;
              if (px < 0 || py < 0 || px >= temp.width || py >= temp.height) {
                continue;
              }
              if (mask.getPixel(px, py) === COLOR_BG) {
                temp.setPixel(px, py, outlineColor);
              }
            }
          }
        }
      }
    }
    for (let y = 0; y < temp.height; y += 1) {
      for (let x = 0; x < temp.width; x += 1) {
        if (fillColor !== undefined && mask.getPixel(x, y) === COLOR_FG) {
          temp.setPixel(x, y, fillColor);
        }
      }
    }
    cursorY += lineAdvance(runMetrics.lineHeight, index < lines.length - 1 ? lineSpacingPx : 0);
  }
  let minY = totalHeight;
  let maxY = -1;
  for (let y = 0; y < temp.height; y += 1) {
    for (let x = 0; x < temp.width; x += 1) {
      if (temp.getPixel(x, y) === COLOR_BG) {
        continue;
      }
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    raster: temp,
    minY: maxY >= 0 ? minY : 0,
    maxY,
    paintedHeight: maxY >= 0 ? maxY - minY + 1 : 0,
    totalHeight
  };
}

function fitGlyphBoundsHeight(
  node: LayoutNode,
  contentWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  data: RenderData,
  inputContext: ScopeContext,
  locale = "en-US"
): number {
  const chromeInsets = getNodeChromeInsets(node);
  const chrome = maxVerticalInsets(chromeInsets);
  const innerWidth = Math.max(1, contentWidth - maxHorizontalInsets(chromeInsets));
  const outlineThickness = theme.textOutline?.enabled ? Math.max(1, theme.textOutline.thicknessPx ?? 1) : 0;

  if (node.type !== "primitive_instance") {
    return fitContentHeight(node, contentWidth, buffer, theme, buffer.fontPresets, data, inputContext, locale);
  }

  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);
  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveEntityState(node.bindings?.entity, data, inputContext, locale)
      : String(node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext, locale));
    const text = applyInputTemplate(rawText, inputContext, locale);
    const style = { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    const lines = layoutTextLines(buffer, text, style, innerWidth, textOverflowMode(node));
    return renderedTextBlockHeight(buffer, lines, style, innerWidth, textLineSpacingPx(node, theme), outlineThickness) + chrome;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveEntityState(node.bindings?.entity, data, inputContext, locale), inputContext, locale);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext, locale);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext, locale);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const style = { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    return renderedTextBlockHeight(buffer, [display], style, innerWidth, outlineThickness) + chrome;
  }

  return fitContentHeight(node, contentWidth, buffer, theme, buffer.fontPresets, data, inputContext, locale);
}

function resolveSize(
  spec: SizeSpec | undefined,
  available: number,
  axis: "width" | "height",
  node: LayoutNode,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  fontPresets: FontPresetValues,
  data: RenderData,
  inputContext: ScopeContext,
  contentWidthHint: number,
  locale = "en-US"
): number {
  if (!spec || spec.mode === "fill") {
    return available;
  }
  if (spec.mode === "fixed_px") {
    return Math.max(0, Math.min(available, Math.round(spec.value ?? 0)));
  }
  if (spec.mode === "fraction") {
    return Math.max(0, Math.min(available, Math.round(available * (spec.value ?? 1))));
  }
  if (spec.mode === "fit_content") {
    if (axis === "width") {
      return Math.max(0, Math.min(available, fitContentWidth(node, contentWidthHint, buffer, theme, fontPresets, data, inputContext, locale)));
    }
    return Math.max(0, Math.min(available, fitContentHeight(node, contentWidthHint, buffer, theme, fontPresets, data, inputContext, locale)));
  }
  if (spec.mode === "fit_glyph_bounds") {
    if (axis !== "height") {
      return available;
    }
    return Math.max(0, Math.min(available, fitGlyphBoundsHeight(node, contentWidthHint, buffer, theme, data, inputContext, locale)));
  }
  const role = spec.fontRole ?? "header";
  const style = {
    family: theme.fontRoles?.[role]?.family ?? "px-sans",
    weight: theme.fontRoles?.[role]?.weight ?? "regular",
    slope: theme.fontRoles?.[role]?.slope ?? "roman",
    size: role,
    pixelSize: theme.fontRoles?.[role]?.pixelSize ?? fontPresets[role]
  } as Partial<TextStyle>;
  const metrics = buffer.measureText("Hg", style);
  const chrome = maxVerticalInsets(getNodeChromeInsets(node));
  const intrinsic = metrics.lineHeight + chrome + Math.max(0, Number(spec.paddingPx ?? 0));
  return Math.max(0, Math.min(available, axis === "height" ? intrinsic : available));
}

function drawLine(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number,
  clip?: PixelFrame
): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    buffer.setPixel(x, y, color, clip ? toClipRect(clip) : undefined);
    if (x === x1 && y === y1) {
      break;
    }
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function drawCircle(
  buffer: PixelBuffer,
  frame: PixelFrame,
  color: number,
  filled: boolean,
  clip?: PixelFrame
): void {
  const rx = Math.max(1, Math.floor(frame.w / 2));
  const ry = Math.max(1, Math.floor(frame.h / 2));
  const cx = frame.x + Math.floor(frame.w / 2);
  const cy = frame.y + Math.floor(frame.h / 2);
  for (let y = frame.y; y < frame.y + frame.h; y += 1) {
    for (let x = frame.x; x < frame.x + frame.w; x += 1) {
      const normX = (x - cx) / rx;
      const normY = (y - cy) / ry;
      const value = normX * normX + normY * normY;
      if (filled) {
        if (value <= 1) {
          buffer.setPixel(x, y, color, clip ? toClipRect(clip) : undefined);
        }
      } else if (value <= 1 && value >= 0.82) {
        buffer.setPixel(x, y, color, clip ? toClipRect(clip) : undefined);
      }
    }
  }
}

function wrapByCharacter(buffer: PixelBuffer, text: string, style: Partial<TextStyle>, maxWidth: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = "";
  for (const char of chars) {
    const next = `${current}${char}`;
    if (!current || paintedTextWidth(buffer, next, style) <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = char;
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [text];
}

function paintedTextWidth(buffer: PixelBuffer, text: string, style: Partial<TextStyle>): number {
  const run = layoutText(text, style, buffer.fontPresets);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const glyph of run.glyphs) {
    if (glyph.width <= 0 || glyph.height <= 0) {
      continue;
    }
    minX = Math.min(minX, glyph.x);
    maxX = Math.max(maxX, glyph.x + glyph.width);
  }
  return Number.isFinite(minX) ? Math.max(1, maxX - minX) : 0;
}

function wrapText(buffer: PixelBuffer, text: string, style: Partial<TextStyle>, maxWidth: number): string[] {
  const paragraphs = text.split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (!current || paintedTextWidth(buffer, candidate, style) <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      if (paintedTextWidth(buffer, word, style) <= maxWidth) {
        current = word;
      } else {
        const broken = wrapByCharacter(buffer, word, style, maxWidth);
        lines.push(...broken.slice(0, -1));
        current = broken[broken.length - 1] ?? "";
      }
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines.length ? lines : [text];
}

function textLines(text: string): string[] {
  const lines = text.split(/\n/);
  return lines.length ? lines : [text];
}

function truncateTextToWidth(
  buffer: PixelBuffer,
  text: string,
  style: Partial<TextStyle>,
  maxWidth: number,
  suffix = ""
): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (paintedTextWidth(buffer, text, style) <= maxWidth) {
    return text;
  }
  const suffixWidth = suffix ? paintedTextWidth(buffer, suffix, style) : 0;
  if (suffixWidth > maxWidth) {
    return truncateTextToWidth(buffer, suffix, style, maxWidth, "");
  }
  const chars = Array.from(text);
  while (chars.length) {
    const candidate = `${chars.join("")}${suffix}`;
    if (paintedTextWidth(buffer, candidate, style) <= maxWidth) {
      return candidate;
    }
    chars.pop();
  }
  return suffix;
}

function layoutTextLines(
  buffer: PixelBuffer,
  text: string,
  style: Partial<TextStyle>,
  maxWidth: number,
  overflow: "wrap" | "hide" | "ellipsis"
): string[] {
  if (overflow === "wrap") {
    return wrapText(buffer, text, style, maxWidth);
  }
  const lines = textLines(text);
  if (overflow === "ellipsis") {
    return lines.map((line) => truncateTextToWidth(buffer, line, style, maxWidth, "..."));
  }
  return lines.map((line) => truncateTextToWidth(buffer, line, style, maxWidth));
}

function pickAutoTextStyle(
  buffer: PixelBuffer,
  frame: PixelFrame,
  baseStyle: Partial<TextStyle>,
  value: string,
  placeholder: string | undefined,
  wrap: boolean,
  lineSpacingPx = 0
): Partial<TextStyle> {
  const topPaddingPx = Math.round(Number(baseStyle.topPaddingPx ?? 0));
  const fitsAtSize = (pixelSize: number): boolean => {
    const candidate = { ...baseStyle, pixelSize };
    const entries = [value, placeholder].filter((entry): entry is string => Boolean(entry));
    return entries.every((entry) => {
      if (!wrap) {
        return (
          paintedTextWidth(buffer, entry, candidate) <= frame.w &&
          adjustedTextBlockHeight(
            renderedTextBlockHeight(buffer, [entry], candidate, frame.w, 0),
            topPaddingPx
          ) <= frame.h
        );
      }
      return adjustedTextBlockHeight(
        renderedTextBlockHeight(
          buffer,
          wrapText(buffer, entry, candidate, frame.w),
          candidate,
          frame.w,
          lineSpacingPx
        ),
        topPaddingPx
      ) <= frame.h;
    });
  };
  const maxPixelSize = Math.max(4, Math.ceil(Math.max(frame.w, frame.h)));
  let low = 4;
  let high = maxPixelSize;
  let best = 4;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fitsAtSize(mid)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { ...baseStyle, pixelSize: best };
}

function drawGlyphOutlinedText(
  buffer: PixelBuffer,
  text: string,
  frame: PixelFrame,
  style: Partial<TextStyle>,
  fillColor: number | undefined,
  outlineColor: number | undefined,
  horizontalAlign: "left" | "center" | "right",
  verticalAlign: "top" | "middle" | "bottom",
  overflow: "wrap" | "hide" | "ellipsis",
  lineSpacingPx = 0,
  topPaddingPx = 0,
  trimGlyphBounds = false,
  clip?: PixelFrame
): void {
  if (fillColor === undefined && outlineColor === undefined) {
    return;
  }
  const lines = layoutTextLines(buffer, text, style, frame.w, overflow);
  const metrics = lines.map((line) => buffer.measureText(line, style));
  const totalHeight = totalTextBlockHeight(metrics, lineSpacingPx);
  const adjustedHeight = adjustedTextBlockHeight(totalHeight, topPaddingPx);
  if (trimGlyphBounds) {
    const block = rasterizedTextBlock(buffer, lines, style, frame.w, lineSpacingPx, fillColor, outlineColor, horizontalAlign);
    const blockHeight = block.paintedHeight > 0 ? block.paintedHeight : totalHeight;
    const targetY =
      verticalAlign === "top"
        ? frame.y
        : verticalAlign === "bottom"
          ? frame.y + frame.h - blockHeight
          : frame.y + Math.floor((frame.h - blockHeight) / 2);
    for (let y = block.minY; y <= block.maxY; y += 1) {
      for (let x = 0; x < block.raster.width; x += 1) {
        const pixel = block.raster.getPixel(x, y);
        if (pixel === COLOR_BG) {
          continue;
        }
        buffer.setPixel(frame.x + x, targetY + (y - block.minY), pixel, clip ? toClipRect(clip) : undefined);
      }
    }
    return;
  }
  const maskColor = COLOR_FG;
  const blockY =
    verticalAlign === "top"
      ? frame.y
      : verticalAlign === "bottom"
        ? frame.y + frame.h - adjustedHeight
        : frame.y + Math.floor((frame.h - adjustedHeight) / 2);
  let cursorY = blockY + topPaddingPx;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const runMetrics = metrics[lineIndex];
    const startX =
      horizontalAlign === "left"
        ? frame.x
        : horizontalAlign === "right"
          ? frame.x + frame.w - runMetrics.width
          : frame.x + Math.floor((frame.w - runMetrics.width) / 2);
    const temp = new PixelBuffer(buffer.width, buffer.height, COLOR_BG, buffer.fontPresets);
    temp.drawText(line, startX, cursorY, style, maskColor, clip ? toClipRect(clip) : undefined);
    if (outlineColor !== undefined) {
      for (let y = frame.y; y < frame.y + frame.h; y += 1) {
        for (let x = frame.x; x < frame.x + frame.w; x += 1) {
          if (temp.getPixel(x, y) !== maskColor) {
            continue;
          }
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              if (ox === 0 && oy === 0) {
                continue;
              }
              const px = x + ox;
              const py = y + oy;
              if (px < frame.x || py < frame.y || px >= frame.x + frame.w || py >= frame.y + frame.h) {
                continue;
              }
              if (clip && !clipContainsPoint(clip, px, py)) {
                continue;
              }
              if (temp.getPixel(px, py) === COLOR_BG) {
                buffer.setPixel(px, py, outlineColor, clip ? toClipRect(clip) : undefined);
              }
            }
          }
        }
      }
    }
    for (let y = frame.y; y < frame.y + frame.h; y += 1) {
      for (let x = frame.x; x < frame.x + frame.w; x += 1) {
        if (fillColor !== undefined && temp.getPixel(x, y) === maskColor) {
          buffer.setPixel(x, y, fillColor, clip ? toClipRect(clip) : undefined);
        }
      }
    }
    cursorY += lineAdvance(runMetrics.lineHeight, lineIndex < lines.length - 1 ? lineSpacingPx : 0);
  }
}

function clipContainsPoint(frame: PixelFrame, x: number, y: number): boolean {
  return x >= frame.x && y >= frame.y && x < frame.x + frame.w && y < frame.y + frame.h;
}

function alignedOffset(
  outerStart: number,
  outerSize: number,
  innerSize: number,
  align: "left" | "center" | "right" | "top" | "middle" | "bottom"
): number {
  if (align === "left" || align === "top") {
    return outerStart;
  }
  if (align === "right" || align === "bottom") {
    return outerStart + outerSize - innerSize;
  }
  return outerStart + Math.floor((outerSize - innerSize) / 2);
}

function resolveEntityValue(entityId: string | undefined, data: RenderData): string {
  if (!entityId) {
    return "";
  }
  return String(data.entities[entityId]?.state ?? "unknown");
}

function resolveEntityReference(entityRef: string | undefined, inputContext: ScopeContext, locale = "en-US"): string | undefined {
  if (!entityRef) {
    return undefined;
  }
  const direct = resolveScopePath(inputContext, entityRef);
  if (typeof direct === "string" && direct) {
    return direct;
  }
  const templated = applyInputTemplate(entityRef, inputContext, locale).trim();
  return templated || undefined;
}

function resolveEntityState(entityRef: string | undefined, data: RenderData, inputContext: ScopeContext, locale = "en-US"): string {
  if (!entityRef) {
    return "";
  }
  const resolved = resolveEntityReference(entityRef, inputContext, locale);
  if (!resolved) {
    return "";
  }
  const liveValue = data.entities[resolved]?.state;
  if (liveValue !== undefined) {
    return String(liveValue);
  }
  const templated = applyInputTemplate(entityRef, inputContext, locale).trim();
  if (templated && templated !== entityRef) {
    return templated;
  }
  return "unknown";
}

function resolveBindingValue(binding: string | undefined, inputContext: ScopeContext, locale = "en-US"): string | undefined {
  const raw = String(binding ?? "").trim();
  if (!raw) {
    return undefined;
  }
  if (raw.includes("{{") || raw.includes("${")) {
    return applyInputTemplate(raw, inputContext, locale);
  }
  const direct = resolveScopePath(inputContext, raw);
  if (direct !== undefined) {
    return stringifyScopeValue(direct);
  }
  if (raw.includes("|")) {
    const resolved = evaluateScopeValueExpression(raw, inputContext, templateOptions(inputContext, locale));
    if (resolved !== undefined && resolved !== null) {
      return stringifyScopeValue(resolved);
    }
  }
  return raw;
}

function resolveWidgetValue(valueRef: string | undefined, entityRef: string | undefined, data: RenderData, inputContext: ScopeContext, locale = "en-US"): string {
  return resolveBindingValue(valueRef, inputContext, locale) ?? resolveEntityState(entityRef, data, inputContext, locale);
}

function applyInputTemplate(template: string, inputContext: ScopeContext, locale = "en-US"): string {
  return applyScopeTemplate(template, inputContext, templateOptions(inputContext, locale));
}

function resolveArrayItems(
  expression: string | undefined,
  inputContext: ScopeContext,
  locale = "en-US",
  itemAlias?: string,
  indexAlias?: string
): ScopeContext[string][] {
  return evaluateArrayExpression(expression, inputContext, {
    ...templateOptions(inputContext, locale),
    itemAlias,
    indexAlias
  }) as ScopeContext[string][];
}

function dataQueryScope(node: DataQueryLayoutNode, data: RenderData, inputContext: ScopeContext): ScopeContext {
  const meta = data.metaQueries?.[node.id]?.meta;
  const dateVariableName = String(meta?.dateVariableName ?? node.dateVariableName ?? "date").trim() || "date";
  return {
    ...inputContext,
    [node.variableName]: (data.metaQueries?.[node.id]?.items ?? []) as ScopeContext[string],
    [dateVariableName]: String(meta?.date ?? "")
  };
}

function filterNodeScope(node: FilterLayoutNode, inputContext: ScopeContext, locale = "en-US"): ScopeContext {
  return {
    ...inputContext,
    [node.outputVariableName]: resolveArrayItems(
      `__items | filter(${node.condition})`,
      {
        ...inputContext,
        __items: resolveArrayItems(node.itemsRef, inputContext, locale, node.itemAlias, node.indexAlias)
      },
      locale,
      node.itemAlias,
      node.indexAlias
    )
  };
}

function uniqueNodeScope(node: UniqueLayoutNode, inputContext: ScopeContext, locale = "en-US"): ScopeContext {
  return {
    ...inputContext,
    [node.outputVariableName]: resolveArrayItems(
      `__items | unique_by(${JSON.stringify(node.keyTemplate)})`,
      {
        ...inputContext,
        __items: resolveArrayItems(node.itemsRef, inputContext, locale, node.itemAlias, node.indexAlias)
      },
      locale,
      node.itemAlias,
      node.indexAlias
    )
  };
}

function resolveScriptBindingValue(expression: string, inputContext: ScopeContext, locale = "en-US"): ScopeContext[string] {
  const trimmed = expression.trim();
  if (!trimmed) {
    return "";
  }
  if (
    (trimmed.startsWith("{{") && trimmed.endsWith("}}")) ||
    (trimmed.startsWith("${") && trimmed.endsWith("}"))
  ) {
    return applyInputTemplate(trimmed, inputContext, locale);
  }
  return evaluateScopeValueExpression(trimmed, inputContext, templateOptions(inputContext, locale)) as ScopeContext[string];
}

function scriptNodeScope(node: ScriptLayoutNode, inputContext: ScopeContext, locale = "en-US"): ScopeContext {
  const bindings = Object.fromEntries(
    Object.entries(node.bindings ?? {}).map(([key, expression]) => [
      key,
      resolveScriptBindingValue(String(expression ?? ""), inputContext, locale)
    ])
  ) as ScopeContext;
  const output = activeRenderScripting?.executeScriptNode(String(node.source ?? ""), inputContext, bindings, locale);
  return output && typeof output === "object" && !Array.isArray(output)
    ? { ...inputContext, ...output }
    : inputContext;
}

function drawGraph(buffer: PixelBuffer, frame: PixelFrame, data: RenderData, queryId: string | undefined, paint: PixelPaint): void {
  const points = data.queries[queryId ?? ""]?.points ?? [];
  if (!points.length) {
    return;
  }
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const barWidth = Math.max(1, Math.floor(frame.w / points.length));
  points.forEach((point, index) => {
    const height = Math.max(1, Math.round(((point.value - min) / spread) * Math.max(1, frame.h - 1)));
    buffer.drawPaintRect(frame.x + index * barWidth, frame.y + frame.h - height, Math.max(1, barWidth - 1), height, paint);
  });
}

function resolveBindingRaw(binding: string | undefined, inputContext: ScopeContext, locale = "en-US"): ScopeContext[string] | undefined {
  const raw = String(binding ?? "").trim();
  if (!raw) {
    return undefined;
  }
  if (raw.includes("{{") || raw.includes("${")) {
    return applyInputTemplate(raw, inputContext, locale);
  }
  const direct = resolveScopePath(inputContext, raw);
  if (direct !== undefined) {
    return direct;
  }
  if (raw.includes("|")) {
    const resolved = evaluateScopeValueExpression(raw, inputContext, templateOptions(inputContext, locale));
    if (resolved !== undefined && resolved !== null) {
      return resolved as ScopeContext[string];
    }
  }
  return undefined;
}

function numericChartValue(item: ScopeContext[string], valueKey: string): number | undefined {
  if (typeof item === "number" && Number.isFinite(item)) {
    return item;
  }
  if (typeof item === "string") {
    const parsed = Number(item);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const raw = (item as Record<string, unknown>)[valueKey];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}

function barChartValues(node: PrimitiveInstanceNode, inputContext: ScopeContext, locale: string): number[] {
  const raw = resolveBindingRaw(node.bindings?.value, inputContext, locale);
  if (!Array.isArray(raw)) {
    return [];
  }
  const valueKey = String(node.props?.valueKey ?? "value").trim() || "value";
  return raw.flatMap((item) => {
    const value = numericChartValue(item, valueKey);
    return value === undefined ? [] : [value];
  });
}

function drawBarChart(buffer: PixelBuffer, frame: PixelFrame, values: number[], node: PrimitiveInstanceNode, theme: WidgetTheme, clip?: PixelFrame): void {
  if (!values.length || frame.w <= 0 || frame.h <= 0) {
    return;
  }
  const paint = fillRoleToPaint(node.props?.colorRole ?? theme.accentRole) ?? { kind: "solid", color: roleToColor(theme.accentRole) };
  const orientation = node.props?.barOrientation === "horizontal" ? "horizontal" : "vertical";
  const gap = Math.max(0, Math.trunc(Number(node.props?.barGapPx ?? 1) || 0));
  const autoMin = Math.min(0, ...values);
  const autoMax = Math.max(0, ...values);
  let min = typeof node.props?.minValue === "number" && Number.isFinite(node.props.minValue) ? node.props.minValue : autoMin;
  let max = typeof node.props?.maxValue === "number" && Number.isFinite(node.props.maxValue) ? node.props.maxValue : autoMax;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const baseline = Math.max(min, Math.min(max, Number(node.props?.baselineValue ?? 0) || 0));
  const range = Math.max(0.000001, max - min);
  const visible = clip ? intersectFrame(frame, clip) : frame;
  if (!hasArea(visible)) {
    return;
  }
  if (orientation === "horizontal") {
    const slot = Math.max(1, Math.floor((frame.h + gap) / values.length));
    const barH = Math.max(1, slot - gap);
    const baseX = frame.x + Math.round(((baseline - min) / range) * Math.max(0, frame.w - 1));
    values.forEach((value, index) => {
      const targetX = frame.x + Math.round(((Math.max(min, Math.min(max, value)) - min) / range) * Math.max(0, frame.w - 1));
      const x = Math.min(baseX, targetX);
      const w = Math.max(1, Math.abs(targetX - baseX) + 1);
      const y = frame.y + index * slot;
      const h = Math.max(0, Math.min(barH, frame.y + frame.h - y));
      if (h > 0) {
        buffer.drawPaintRect(x, y, w, h, paint, toClipRect(visible));
      }
    });
    return;
  }
  const slot = Math.max(1, Math.floor((frame.w + gap) / values.length));
  const barW = Math.max(1, slot - gap);
  const baseY = frame.y + frame.h - 1 - Math.round(((baseline - min) / range) * Math.max(0, frame.h - 1));
  values.forEach((value, index) => {
    const targetY = frame.y + frame.h - 1 - Math.round(((Math.max(min, Math.min(max, value)) - min) / range) * Math.max(0, frame.h - 1));
    const y = Math.min(baseY, targetY);
    const h = Math.max(1, Math.abs(targetY - baseY) + 1);
    const x = frame.x + index * slot;
    const w = Math.max(0, Math.min(barW, frame.x + frame.w - x));
    if (w > 0) {
      buffer.drawPaintRect(x, y, w, h, paint, toClipRect(visible));
    }
  });
}

function drawPrimitiveNode(
  buffer: PixelBuffer,
  project: Project,
  node: PrimitiveInstanceNode,
  frame: PixelFrame,
  data: RenderData,
  theme: WidgetTheme,
  inputContext: ScopeContext,
  clip?: PixelFrame,
  contentInsets?: Partial<EdgeInsets>
): void {
  const borderInsets = nodeBorderInsets(node);
  const paddingInsets = getNodePaddingEdges(node);
  const baseInnerFrame = insetFrameByEdges(frame, addInsets(borderInsets, paddingInsets));
  const innerFrame = insetFrameByEdges(baseInnerFrame, contentInsets);
  const visibleFrame = clip ? intersectFrame(frame, clip) : frame;
  const visibleInnerFrame = clip ? intersectFrame(innerFrame, clip) : innerFrame;
  if (!hasArea(visibleFrame)) {
    return;
  }
  drawNodeBorder(buffer, node, frame, theme, visibleFrame);
  const fillPaint = fillRoleToPaint(theme.surface.fillRole);
  if (fillPaint && baseInnerFrame.w > 0 && baseInnerFrame.h > 0) {
    const fillFrame = insetFrameByEdges(frame, borderInsets);
    const visibleBaseInnerFrame = clip ? intersectFrame(fillFrame, clip) : fillFrame;
    if (hasArea(visibleBaseInnerFrame)) {
      buffer.drawPaintRect(fillFrame.x, fillFrame.y, fillFrame.w, fillFrame.h, fillPaint, toClipRect(visibleBaseInnerFrame));
    }
  }
  if (!hasArea(visibleInnerFrame)) {
    return;
  }

  const outlineColor = theme.textOutline?.enabled ? roleToColor(theme.textOutline.colorRole) : undefined;
  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);

  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveWidgetValue(node.bindings?.value, node.bindings?.entity, data, inputContext, project.locale)
      : String(resolveBindingValue(node.bindings?.value, inputContext, project.locale) ?? node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext, project.locale));
    const text = applyInputTemplate(rawText, inputContext, project.locale);
    const placeholder = applyInputTemplate(String(node.props?.placeholderText ?? ""), inputContext, project.locale);
    const overflow = textOverflowMode(node);
    const lineSpacingPx = textLineSpacingPx(node, theme);
    const topPaddingPx = textTopPaddingPx(node, theme);
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          innerFrame,
          bodyStyle,
          text,
          placeholder,
          overflow === "wrap",
          lineSpacingPx
        )
      : { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    const fillColor = textRoleToColor(style.colorRole, theme.text.body);
    drawGlyphOutlinedText(
      buffer,
      text,
      innerFrame,
      style,
      fillColor,
      outlineColor,
      (node.props?.horizontalAlign ?? "left") as "left" | "center" | "right",
      (node.props?.verticalAlign ?? "top") as "top" | "middle" | "bottom",
      overflow,
      lineSpacingPx,
      topPaddingPx,
      node.height?.mode === "fit_glyph_bounds" || Boolean(node.props?.autoFit && autoFitAllowed(node)),
      visibleInnerFrame
    );
    return;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveWidgetValue(node.bindings?.value, node.bindings?.entity, data, inputContext, project.locale), inputContext, project.locale);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext, project.locale);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext, project.locale);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const placeholder = `${prefix}${applyInputTemplate(String(node.props?.placeholderValue ?? ""), inputContext, project.locale)}${suffix}`;
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          innerFrame,
          valueStyle,
          display,
          placeholder,
          false
        )
      : { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    const fillColor = textRoleToColor(style.colorRole, theme.text.value);
    drawGlyphOutlinedText(
      buffer,
      display,
      innerFrame,
      style,
      fillColor,
      outlineColor,
      (node.props?.horizontalAlign ?? "center") as "left" | "center" | "right",
      (node.props?.verticalAlign ?? "middle") as "top" | "middle" | "bottom",
      "hide",
      0,
      Math.round(Number(style.topPaddingPx ?? 0)),
      node.height?.mode === "fit_glyph_bounds" || Boolean(node.props?.autoFit && autoFitAllowed(node)),
      visibleInnerFrame
    );
    return;
  }

  if (node.primitiveType === "icon") {
    const scale = Math.max(1, Math.floor(Math.min(innerFrame.w / 10, innerFrame.h / 10)));
    const iconWidth = 10 * scale;
    const iconHeight = 10 * scale;
    const x = alignedOffset(
      innerFrame.x,
      innerFrame.w,
      iconWidth,
      (node.props?.horizontalAlign ?? "center") as "left" | "center" | "right"
    );
    const y = alignedOffset(
      innerFrame.y,
      innerFrame.h,
      iconHeight,
      (node.props?.verticalAlign ?? "middle") as "top" | "middle" | "bottom"
    );
    const iconId = resolveBindingValue(node.bindings?.value ?? node.bindings?.icon, inputContext, project.locale) || String(node.props?.icon ?? defaultIconId());
    buffer.drawIcon(iconId, x, y, scale, roleToColor(theme.text.body), toClipRect(visibleInnerFrame));
    return;
  }

  if (node.primitiveType === "graph") {
    drawGraph(buffer, visibleInnerFrame, data, node.bindings?.query, fillRoleToPaint(node.props?.colorRole ?? theme.accentRole) ?? { kind: "solid", color: roleToColor(theme.accentRole) });
    return;
  }

  if (node.primitiveType === "bar_chart") {
    drawBarChart(buffer, visibleInnerFrame, barChartValues(node, inputContext, project.locale ?? "en-US"), node, theme, visibleInnerFrame);
    return;
  }

  if (node.primitiveType === "line") {
    const direction = String(node.props?.lineDirection ?? "horizontal");
    if (direction === "vertical") {
      drawLine(buffer, innerFrame.x + Math.floor(innerFrame.w / 2), innerFrame.y, innerFrame.x + Math.floor(innerFrame.w / 2), innerFrame.y + innerFrame.h - 1, roleToColor(theme.text.body), visibleInnerFrame);
    } else if (direction === "diag_down") {
      drawLine(buffer, innerFrame.x, innerFrame.y, innerFrame.x + innerFrame.w - 1, innerFrame.y + innerFrame.h - 1, roleToColor(theme.text.body), visibleInnerFrame);
    } else if (direction === "diag_up") {
      drawLine(buffer, innerFrame.x, innerFrame.y + innerFrame.h - 1, innerFrame.x + innerFrame.w - 1, innerFrame.y, roleToColor(theme.text.body), visibleInnerFrame);
    } else {
      drawLine(buffer, innerFrame.x, innerFrame.y + Math.floor(innerFrame.h / 2), innerFrame.x + innerFrame.w - 1, innerFrame.y + Math.floor(innerFrame.h / 2), roleToColor(theme.text.body), visibleInnerFrame);
    }
    return;
  }

  if (node.primitiveType === "box") {
    buffer.drawRect(innerFrame.x, innerFrame.y, innerFrame.w, innerFrame.h, roleToColor(theme.text.body), false, toClipRect(visibleInnerFrame));
    return;
  }

  if (node.primitiveType === "circle") {
    drawCircle(buffer, innerFrame, roleToColor(theme.text.body), Boolean(node.props?.filled), visibleInnerFrame);
    return;
  }

  drawGlyphOutlinedText(
    buffer,
    node.primitiveType.toUpperCase(),
    innerFrame,
    bodyStyle,
    roleToColor(theme.text.body),
    outlineColor,
    (node.props?.horizontalAlign ?? "center") as "left" | "center" | "right",
    (node.props?.verticalAlign ?? "middle") as "top" | "middle" | "bottom",
    "wrap",
    0,
    Math.round(Number(bodyStyle.topPaddingPx ?? 0)),
    false,
    visibleInnerFrame
  );
}

function renderNode(
  buffer: PixelBuffer,
  project: Project,
  node: LayoutNode,
  frame: PixelFrame,
  data: RenderData,
  inheritedThemeId?: string,
  inputContext: ScopeContext = {},
  collectInspection = false,
  expandCompoundRefs = false,
  clipFrame?: PixelFrame,
  contentInsets?: Partial<EdgeInsets>
): LayoutInspectionNode | undefined {
  const resolvedThemeId = node.style?.themeId && node.style.themeId !== "inherit" ? node.style.themeId : inheritedThemeId;
  const theme = resolveTheme(project, resolvedThemeId);
  const visibleFrame = clipFrame ? intersectFrame(frame, clipFrame) : frame;
  if (!hasArea(frame) || !hasArea(visibleFrame)) {
    return undefined;
  }
  if (node.type === "primitive_instance") {
    const primitiveContentFrame = insetFrameByEdges(
      insetFrameByEdges(frame, getNodeChromeInsets(node)),
      contentInsets
    );
    drawPrimitiveNode(buffer, project, node, frame, data, theme, inputContext, visibleFrame, contentInsets);
    return collectInspection
      ? buildInspectionNode(project, node, frame, primitiveContentFrame, resolvedThemeId, [])
      : undefined;
  }
  if (node.type === "compound_ref") {
    const definition = project.widgetDefinitions?.find((entry) => entry.id === node.definitionId && entry.rootNode);
    if (definition?.rootNode) {
      const nestedContext: ScopeContext = { ...inputContext };
      for (const input of definition.inputSchema ?? []) {
        const key = input.id;
        const alias = input.name;
        let value: ScopeContext[string] = input.defaultValue ?? "";
        if (input.valueType === "entity") {
          const binding = node.inputBindings?.[key] ?? node.inputBindings?.[alias];
          const explicit = node.inputValues?.[key] ?? node.inputValues?.[alias];
          value = binding ?? explicit ?? input.previewValue ?? "";
        } else {
          const explicit = node.inputValues?.[key] ?? node.inputValues?.[alias];
          if (explicit !== undefined) {
            value = explicit;
          } else if (input.previewValue !== undefined) {
            value = input.previewValue;
          }
        }
        nestedContext[key] = value;
        nestedContext[alias] = value;
      }
      renderNode(
        buffer,
        project,
        definition.rootNode,
        frame,
        data,
        resolvedThemeId,
        nestedContext,
        false,
        expandCompoundRefs,
        visibleFrame,
        contentInsets
      );
      const nestedInspection =
        collectInspection && expandCompoundRefs
          ? renderNode(
              buffer,
              project,
              definition.rootNode,
              frame,
              data,
              resolvedThemeId,
              nestedContext,
              true,
              true,
              visibleFrame,
              contentInsets
            )
          : undefined;
      return collectInspection
        ? buildInspectionNode(project, node, frame, frame, resolvedThemeId, nestedInspection ? [nestedInspection] : [])
        : undefined;
    }
    return collectInspection ? buildInspectionNode(project, node, frame, frame, resolvedThemeId, []) : undefined;
  }
  if (node.type === "spacer") {
    return collectInspection ? buildInspectionNode(project, node, frame, frame, resolvedThemeId, []) : undefined;
  }

  const borderInsets = nodeBorderInsets(node);
  const contentFrame = insetFrameByEdges(frame, borderInsets);
  const visibleContentFrame = intersectFrame(contentFrame, visibleFrame) ?? visibleFrame;
  drawNodeBorder(buffer, node, frame, theme, visibleFrame);
  const containerFillPaint = fillRoleToPaint(theme.surface.fillRole);
  if (containerFillPaint && contentFrame.w > 0 && contentFrame.h > 0) {
    buffer.drawPaintRect(contentFrame.x, contentFrame.y, contentFrame.w, contentFrame.h, containerFillPaint, toClipRect(visibleContentFrame));
  }
  const baseInnerFrame = insetFrameByEdges(contentFrame, getNodePaddingEdges(node));
  const innerFrame = insetFrameByEdges(baseInnerFrame, contentInsets);
  const visibleInnerFrame = intersectFrame(innerFrame, visibleFrame);
  const gap = Math.max(0, Number(node.style?.gapPx ?? 0));
  if (!hasArea(innerFrame) || !hasArea(visibleInnerFrame)) {
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, [])
      : undefined;
  }

  if (node.type === "zstack") {
    const children: LayoutInspectionNode[] = [];
    for (const child of node.children) {
      const inspection = renderNode(buffer, project, child, innerFrame, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs, visibleInnerFrame);
      if (inspection) {
        children.push(inspection);
      }
    }
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, children)
      : undefined;
  }

  if (node.type === "stack") {
    const horizontal = node.axis === "horizontal";
    const children = node.children;
    const availableMain = (horizontal ? innerFrame.w : innerFrame.h) - gap * Math.max(0, children.length - 1);
    const assigned = assignStackMainSizes(
      children,
      horizontal,
      availableMain,
      horizontal ? innerFrame.h : innerFrame.w,
      buffer,
      theme,
      project.fontPresets,
      data,
      inputContext
    );
    let cursor = horizontal ? innerFrame.x : innerFrame.y;
    const inspectionChildren: LayoutInspectionNode[] = [];
    children.forEach((child, index) => {
      const main = Math.max(0, assigned[index]);
      const cross = horizontal
        ? resolveSize(child.height, innerFrame.h, "height", child, buffer, theme, project.fontPresets, data, inputContext, main)
        : resolveSize(child.width, innerFrame.w, "width", child, buffer, theme, project.fontPresets, data, inputContext, innerFrame.w);
      const childFrame = horizontal
        ? { x: cursor, y: innerFrame.y, w: main, h: cross }
        : { x: innerFrame.x, y: cursor, w: cross, h: main };
      const inspection = renderNode(buffer, project, child, childFrame, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs, visibleInnerFrame);
      if (inspection) {
        inspectionChildren.push(inspection);
      }
      cursor += main + gap;
    });
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, inspectionChildren, { stackAxis: node.axis })
      : undefined;
  }

  if (node.type === "grid") {
    const rowHeights = node.rows.map((row) => resolveSize(row.size, innerFrame.h, "height", node, buffer, theme, project.fontPresets, data, inputContext, innerFrame.w));
    const columnWidths = node.columns.map((column) => resolveSize(column.size, innerFrame.w, "width", node, buffer, theme, project.fontPresets, data, inputContext, innerFrame.w));
    const rowPositions: number[] = [];
    const columnPositions: number[] = [];
    let rowCursor = innerFrame.y;
    for (const height of rowHeights) {
      rowPositions.push(rowCursor);
      rowCursor += height + gap;
    }
    let columnCursor = innerFrame.x;
    for (const width of columnWidths) {
      columnPositions.push(columnCursor);
      columnCursor += width + gap;
    }
    const inspectionChildren: LayoutInspectionNode[] = [];
    const gridCells: LayoutInspectionGridCell[] = [];
    for (let row = 0; row < rowHeights.length; row += 1) {
      for (let column = 0; column < columnWidths.length; column += 1) {
        gridCells.push({
          row,
          column,
          frame: {
            x: columnPositions[column] ?? innerFrame.x,
            y: rowPositions[row] ?? innerFrame.y,
            w: columnWidths[column] ?? 0,
            h: rowHeights[row] ?? 0
          }
        });
      }
    }
    for (const child of node.children) {
      const row = Math.max(0, child.placement.row);
      const column = Math.max(0, child.placement.column);
      const rowSpan = Math.max(1, child.placement.rowSpan ?? 1);
      const columnSpan = Math.max(1, child.placement.columnSpan ?? 1);
      const x = columnPositions[column] ?? innerFrame.x;
      const y = rowPositions[row] ?? innerFrame.y;
      const w = columnWidths.slice(column, column + columnSpan).reduce((sum, value) => sum + value, 0) + gap * Math.max(0, columnSpan - 1);
      const h = rowHeights.slice(row, row + rowSpan).reduce((sum, value) => sum + value, 0) + gap * Math.max(0, rowSpan - 1);
      const inspection = renderNode(buffer, project, child.node, { x, y, w, h }, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs, visibleInnerFrame);
      if (inspection) {
        inspectionChildren.push({
          ...inspection,
          gridPlacement: { ...child.placement }
        });
      }
    }
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, inspectionChildren, { gridCells })
      : undefined;
  }

  if (node.type === "data_query") {
    const nestedContext = dataQueryScope(node, data, inputContext);
    const childInspection = node.child
      ? renderNode(buffer, project, node.child, innerFrame, data, resolvedThemeId, nestedContext, collectInspection, expandCompoundRefs, visibleInnerFrame)
      : undefined;
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, childInspection ? [childInspection] : [])
      : undefined;
  }

  if (node.type === "filter") {
    const nestedContext = filterNodeScope(node, inputContext, project.locale);
    const childInspection = node.child
      ? renderNode(buffer, project, node.child, innerFrame, data, resolvedThemeId, nestedContext, collectInspection, expandCompoundRefs, visibleInnerFrame)
      : undefined;
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, childInspection ? [childInspection] : [])
      : undefined;
  }

  if (node.type === "unique") {
    const nestedContext = uniqueNodeScope(node, inputContext, project.locale);
    const childInspection = node.child
      ? renderNode(buffer, project, node.child, innerFrame, data, resolvedThemeId, nestedContext, collectInspection, expandCompoundRefs, visibleInnerFrame)
      : undefined;
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, childInspection ? [childInspection] : [])
      : undefined;
  }

  if (node.type === "script") {
    const nestedContext = scriptNodeScope(node, inputContext, project.locale);
    const childInspection = node.child
      ? renderNode(buffer, project, node.child, innerFrame, data, resolvedThemeId, nestedContext, collectInspection, expandCompoundRefs, visibleInnerFrame)
      : undefined;
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, childInspection ? [childInspection] : [])
      : undefined;
  }

  if (node.type === "foreach") {
    const values = resolveArrayItems(node.itemsRef, inputContext, project.locale, node.itemAlias, node.indexAlias);
    const maxItems = typeof node.maxItems === "number" && Number.isFinite(node.maxItems)
      ? Math.max(0, Math.floor(node.maxItems))
      : values.length;
    const template = node.child;
    const inspectionChildren: LayoutInspectionNode[] = [];
    if (!template || maxItems === 0 || !values.length) {
      return collectInspection
        ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, inspectionChildren, { stackAxis: node.axis })
        : undefined;
    }
    const count = Math.min(values.length, maxItems);
    const horizontal = node.axis === "horizontal";
    const availableMain = (horizontal ? innerFrame.w : innerFrame.h) - gap * Math.max(0, count - 1);
    const mainSpec = horizontal ? template.width : template.height;
    const sharedMain =
      !mainSpec || mainSpec.mode === "fill" || mainSpec.mode === "fraction"
        ? Math.floor(Math.max(0, availableMain) / Math.max(1, count))
        : undefined;
    let cursor = horizontal ? innerFrame.x : innerFrame.y;
    for (let index = 0; index < count; index += 1) {
      if ((horizontal && cursor >= innerFrame.x + innerFrame.w) || (!horizontal && cursor >= innerFrame.y + innerFrame.h)) {
        break;
      }
      const itemScope: ScopeContext = {
        ...inputContext,
        [node.itemAlias]: values[index] as ScopeContext[string],
        [node.indexAlias]: index
      };
      const contentWidthHint = horizontal
        ? availableMain
        : resolveSize(template.width, innerFrame.w, "width", template, buffer, theme, project.fontPresets, data, itemScope, innerFrame.w);
      const main = Math.max(0, sharedMain ?? resolveSize(
        mainSpec,
        availableMain,
        horizontal ? "width" : "height",
        template,
        buffer,
        theme,
        project.fontPresets,
        data,
        itemScope,
        contentWidthHint
      ));
      const cross = horizontal
        ? resolveSize(template.height, innerFrame.h, "height", template, buffer, theme, project.fontPresets, data, itemScope, main)
        : resolveSize(template.width, innerFrame.w, "width", template, buffer, theme, project.fontPresets, data, itemScope, innerFrame.w);
      const childFrame = horizontal
        ? { x: cursor, y: innerFrame.y, w: main, h: cross }
        : { x: innerFrame.x, y: cursor, w: cross, h: main };
      const inspection = renderNode(buffer, project, template, childFrame, data, resolvedThemeId, itemScope, collectInspection, expandCompoundRefs, visibleInnerFrame);
      if (inspection) {
        inspectionChildren.push(inspection);
      }
      cursor += main + gap;
    }
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, inspectionChildren, { stackAxis: node.axis })
      : undefined;
  }

  if (node.type === "if_else") {
    const branch = evaluateScopeExpression(node.condition, inputContext) ? node.thenChild : node.elseChild;
    const childInspection = branch
      ? renderNode(buffer, project, branch, innerFrame, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs, visibleInnerFrame)
      : undefined;
    return collectInspection
      ? buildInspectionNode(project, node, frame, innerFrame, resolvedThemeId, childInspection ? [childInspection] : [])
      : undefined;
  }
  return undefined;
}

export function resolveAssignedLayout(project: Project, displayId: string, data: RenderData): { layout: LayoutDefinition; popup?: LayoutDefinition; assignment: DeviceAssignment; display: ManagedDisplay } {
  const display = project.devices?.find((entry) => entry.id === displayId);
  if (!display) {
    throw new Error(`Unknown display ${displayId}`);
  }
  const assignment = project.deviceAssignments?.find((entry) => entry.displayId === displayId) ?? {
    id: `implicit-assignment-${display.id}`,
    displayId: display.id,
    defaultThemeId: DEFAULT_WIDGET_THEME_ID,
    fullscreenRules: [],
    popupRules: []
  };
  const fullscreenRule = assignment.fullscreenRules
    .slice()
    .sort((left, right) => right.priority - left.priority)
    .find((rule) => evaluateCondition(rule.condition, data) && rule.action.type === "activate_fullscreen_layout");
  const popupRule = assignment.popupRules
    .slice()
    .sort((left, right) => right.priority - left.priority)
    .find((rule) => evaluateCondition(rule.condition, data) && rule.action.type === "activate_popup_layout");
  const layoutId =
    fullscreenRule && fullscreenRule.action.type === "activate_fullscreen_layout"
      ? fullscreenRule.action.layoutId
      : assignment.defaultFullscreenLayoutId;
  const layout = layoutId
    ? project.layoutDefinitions?.find((entry) => entry.id === layoutId)
    : undefined;
  const fallbackLayout =
    project.layoutDefinitions?.find((entry) => entry.kind === "fullscreen");
  if (!layout) {
    if (!fallbackLayout) {
      throw new Error(`Unknown fullscreen layout ${layoutId ?? ""}`);
    }
    return { layout: fallbackLayout, popup: undefined, assignment, display };
  }
  const popupLayoutId =
    popupRule && popupRule.action.type === "activate_popup_layout"
      ? popupRule.action.layoutId
      : undefined;
  const popup = popupLayoutId
    ? project.layoutDefinitions?.find((entry) => entry.id === popupLayoutId)
    : undefined;
  return { layout, popup, assignment, display };
}

function resolveLayoutDisplayType(project: Project, layout: LayoutDefinition, displayTypeId?: string): DisplayType {
  return resolveDisplayType(project, displayTypeId ?? layout.displayTypeId ?? project.displayTypes?.[0]?.id ?? "");
}

export function renderLayoutDefinition(
  project: Project,
  layout: LayoutDefinition,
  data: RenderData,
  popup?: LayoutDefinition,
  themeId?: string,
  displayTypeId?: string
): RenderedImage {
  const displayType = resolveLayoutDisplayType(project, layout, displayTypeId);
  const rootContentPadding = layout.kind === "fullscreen" ? displayType.contentPadding : undefined;
  const buffer = new PixelBuffer(displayType.width, displayType.height, COLOR_BG, project.fontPresets);
  buffer.fill(COLOR_BG);
  const scripting = createActiveRenderScripting(project, data, displayType);
  withActiveRenderScripting(scripting, () => {
    if (layout.rootNode) {
      renderNode(
        buffer,
        project,
        layout.rootNode,
        { x: 0, y: 0, w: displayType.width, h: displayType.height },
        data,
        themeId,
        scripting.globals,
        false,
        false,
        undefined,
        rootContentPadding
      );
    }
    if (popup) {
      const popupWidth = Math.min(displayType.width, popup.popupDefaults?.widthPx ?? Math.floor(displayType.width * 0.8));
      const popupHeight = Math.min(displayType.height, popup.popupDefaults?.heightPx ?? Math.floor(displayType.height * 0.5));
      const popupFrame = {
        x: Math.floor((displayType.width - popupWidth) / 2),
        y: Math.floor((displayType.height - popupHeight) / 2),
        w: popupWidth,
        h: popupHeight
      };
      if (popup.rootNode) {
        renderNode(buffer, project, popup.rootNode, popupFrame, data, themeId, scripting.globals, false);
      }
    }
  });
  const rgba = rgbaFromPixels(buffer, displayType);
  const hash = createStableHash([displayType.id, layout.id, popup?.id ?? "", buffer.pixels]);
  return {
    width: buffer.width,
    height: buffer.height,
    pixels: buffer.pixels,
    rgba,
    hash,
    activeScreenId: layout.id,
    activeOverlayId: popup?.id,
    scriptWarnings: scripting.warnings.length ? [...new Set(scripting.warnings)] : undefined
  };
}

export function inspectLayoutDefinition(
  project: Project,
  layout: LayoutDefinition,
  data: RenderData,
  popup?: LayoutDefinition,
  themeId?: string,
  expandCompoundRefs = false,
  displayTypeId?: string
): LayoutInspectionResult {
  const displayType = resolveLayoutDisplayType(project, layout, displayTypeId);
  const rootContentPadding = layout.kind === "fullscreen" ? displayType.contentPadding : undefined;
  const buffer = new PixelBuffer(displayType.width, displayType.height, COLOR_BG, project.fontPresets);
  const scripting = createActiveRenderScripting(project, data, displayType);
  let root: LayoutInspectionNode | undefined;
  let popupInspection: LayoutInspectionNode | undefined;
  withActiveRenderScripting(scripting, () => {
    root = layout.rootNode
      ? renderNode(
          buffer,
          project,
          layout.rootNode,
          { x: 0, y: 0, w: displayType.width, h: displayType.height },
          data,
          themeId,
          scripting.globals,
          true,
          expandCompoundRefs,
          undefined,
          rootContentPadding
        )
      : undefined;
    if (popup?.rootNode) {
      const popupWidth = Math.min(displayType.width, popup.popupDefaults?.widthPx ?? Math.floor(displayType.width * 0.8));
      const popupHeight = Math.min(displayType.height, popup.popupDefaults?.heightPx ?? Math.floor(displayType.height * 0.5));
      const popupFrame = {
        x: Math.floor((displayType.width - popupWidth) / 2),
        y: Math.floor((displayType.height - popupHeight) / 2),
        w: popupWidth,
        h: popupHeight
      };
      popupInspection = renderNode(buffer, project, popup.rootNode, popupFrame, data, themeId, scripting.globals, true, expandCompoundRefs);
    }
  });
  return {
    width: displayType.width,
    height: displayType.height,
    root,
    popup: popupInspection,
    scriptWarnings: scripting.warnings.length ? [...new Set(scripting.warnings)] : undefined
  };
}

export function renderAssignedDisplay(project: Project, displayId: string, data: RenderData): RenderedImage {
  const resolved = resolveAssignedLayout(project, displayId, data);
  return renderLayoutDefinition(project, resolved.layout, data, resolved.popup, resolved.assignment.defaultThemeId, resolved.display.displayTypeId);
}
