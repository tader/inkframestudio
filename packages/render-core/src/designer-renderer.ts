import { createStableHash } from "./hash.js";
import { ICONS } from "./icons.js";
import { COLOR_ACCENT, COLOR_BG, COLOR_FG, PixelBuffer } from "./pixel-buffer.js";
import { formatQuantizedNumber } from "./quantize.js";
import { evaluateCondition } from "./resolve.js";
import { DEFAULT_WIDGET_THEME_ID, DEFAULT_WIDGET_THEMES } from "./themes.js";
import type {
  BorderToken,
  DeviceAssignment,
  DisplayType,
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
  SizeSpec,
  TextStyle,
  WidgetTheme
} from "./types.js";
import { renderProject as renderLegacyProject } from "./renderer.js";

interface PixelFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

type InputContext = Record<string, string | number | boolean>;

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

function insetFrame(frame: PixelFrame, pixels: number): PixelFrame {
  return {
    x: frame.x + pixels,
    y: frame.y + pixels,
    w: Math.max(0, frame.w - pixels * 2),
    h: Math.max(0, frame.h - pixels * 2)
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
    isContainer: node.type === "stack" || node.type === "grid" || node.type === "zstack",
    ...extras
  };
}

function getNodePadding(node: LayoutNode): number {
  if (node.type === "primitive_instance") {
    return Math.max(0, Number(node.props?.paddingPx ?? node.style?.paddingPx ?? 0));
  }
  return Math.max(0, Number(node.style?.paddingPx ?? 0));
}

function primitiveTextStyles(
  node: PrimitiveInstanceNode,
  theme: WidgetTheme
): { bodyStyle: Partial<TextStyle>; valueStyle: Partial<TextStyle> } {
  const fontRole = node.props?.fontRole ?? (node.primitiveType === "number" ? "header" : "normal");
  return {
    bodyStyle: {
      family: theme.fontRoles?.[fontRole]?.family ?? node.props?.bodyTextStyle?.family ?? "px-sans",
      weight: theme.fontRoles?.[fontRole]?.weight ?? node.props?.bodyTextStyle?.weight ?? "regular",
      slope: theme.fontRoles?.[fontRole]?.slope ?? node.props?.bodyTextStyle?.slope ?? "roman",
      size: node.props?.bodyTextStyle?.size ?? fontRole,
      pixelSize: theme.fontRoles?.[fontRole]?.pixelSize
    },
    valueStyle: {
      family: theme.fontRoles?.[fontRole]?.family ?? node.props?.valueTextStyle?.family ?? "px-mono-special",
      weight: theme.fontRoles?.[fontRole]?.weight ?? node.props?.valueTextStyle?.weight ?? "regular",
      slope: theme.fontRoles?.[fontRole]?.slope ?? node.props?.valueTextStyle?.slope ?? "roman",
      size: node.props?.valueTextStyle?.size ?? fontRole,
      pixelSize: theme.fontRoles?.[fontRole]?.pixelSize,
      tabularNumbers: node.primitiveType === "number"
    }
  };
}

function autoFitAllowed(node: PrimitiveInstanceNode): boolean {
  return node.width?.mode !== "fit_content" && node.height?.mode !== "fit_content";
}

function fitContentHeight(
  node: LayoutNode,
  contentWidth: number,
  buffer: PixelBuffer,
  theme: WidgetTheme,
  data: RenderData,
  inputContext: InputContext
): number {
  const token = node.type === "primitive_instance" ? node.props?.borderToken ?? node.style?.borderToken : node.style?.borderToken;
  const chrome = (borderThickness(theme, token) + getNodePadding(node)) * 2;
  const innerWidth = Math.max(1, contentWidth - chrome);

  if (node.type !== "primitive_instance") {
    return chrome;
  }

  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);

  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveEntityState(node.bindings?.entity, data, inputContext)
      : String(node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext));
    const text = applyInputTemplate(rawText, inputContext);
    const placeholder = applyInputTemplate(String(node.props?.placeholderText ?? ""), inputContext);
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          { x: 0, y: 0, w: innerWidth, h: 10_000 },
          { ...bodyStyle, family: theme.autoFitFontFamily ?? bodyStyle.family },
          text,
          placeholder,
          true
        )
      : { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    const lines = wrapText(buffer, text, style, innerWidth);
    const totalHeight = lines.reduce((sum, line) => sum + buffer.measureText(line, style).lineHeight, 0);
    return totalHeight + chrome;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveEntityState(node.bindings?.entity, data, inputContext), inputContext);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const placeholder = `${prefix}${applyInputTemplate(String(node.props?.placeholderValue ?? ""), inputContext)}${suffix}`;
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          { x: 0, y: 0, w: innerWidth, h: 10_000 },
          { ...valueStyle, family: theme.autoFitFontFamily ?? valueStyle.family },
          display,
          placeholder,
          false
        )
      : { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    return buffer.measureText(display, style).lineHeight + chrome;
  }

  if (node.primitiveType === "icon") {
    const iconRows = ICONS[String(node.props?.icon ?? "warning")] ?? ICONS.warning;
    return iconRows.length + chrome;
  }

  if (node.primitiveType === "line") {
    return 1 + chrome;
  }

  return buffer.measureText(node.primitiveType.toUpperCase(), bodyStyle).lineHeight + chrome;
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
  inputContext: InputContext,
  contentWidthHint: number
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
    if (axis !== "height") {
      return available;
    }
    return Math.max(0, Math.min(available, fitContentHeight(node, contentWidthHint, buffer, theme, data, inputContext)));
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
  const token = node.type === "primitive_instance" ? node.props?.borderToken ?? node.style?.borderToken : node.style?.borderToken;
  const chrome = (borderThickness(theme, token) + getNodePadding(node)) * 2;
  const intrinsic = metrics.lineHeight + chrome + Math.max(0, Number(spec.paddingPx ?? 0));
  return Math.max(0, Math.min(available, axis === "height" ? intrinsic : available));
}

function drawLine(buffer: PixelBuffer, x0: number, y0: number, x1: number, y1: number, color: number): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    buffer.setPixel(x, y, color);
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

function drawCircle(buffer: PixelBuffer, frame: PixelFrame, color: number, filled: boolean): void {
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
          buffer.setPixel(x, y, color);
        }
      } else if (value <= 1 && value >= 0.82) {
        buffer.setPixel(x, y, color);
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
    if (!current || buffer.measureText(next, style).width <= maxWidth) {
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
      if (!current || buffer.measureText(candidate, style).width <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current);
      if (buffer.measureText(word, style).width <= maxWidth) {
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

function linesFit(
  buffer: PixelBuffer,
  lines: string[],
  style: Partial<TextStyle>,
  frame: PixelFrame
): boolean {
  const metrics = lines.map((line) => buffer.measureText(line, style));
  return (
    metrics.every((entry) => entry.width <= frame.w) &&
    metrics.reduce((sum, entry) => sum + entry.lineHeight, 0) <= frame.h
  );
}

function pickAutoTextStyle(
  buffer: PixelBuffer,
  frame: PixelFrame,
  baseStyle: Partial<TextStyle>,
  value: string,
  placeholder: string | undefined,
  wrap: boolean
): Partial<TextStyle> {
  for (let pixelSize = 36; pixelSize >= 4; pixelSize -= 1) {
    const candidate = { ...baseStyle, pixelSize };
    const entries = [value, placeholder].filter((entry): entry is string => Boolean(entry));
    const fits = entries.every((entry) => {
      if (!wrap) {
        return buffer.measureText(entry, candidate).width <= frame.w && buffer.measureText(entry, candidate).height <= frame.h;
      }
      return linesFit(buffer, wrapText(buffer, entry, candidate, frame.w), candidate, frame);
    });
    if (fits) {
      return candidate;
    }
  }
  return { ...baseStyle, pixelSize: 4 };
}

function drawGlyphOutlinedText(
  buffer: PixelBuffer,
  text: string,
  frame: PixelFrame,
  style: Partial<TextStyle>,
  fillColor: number,
  outlineColor: number | undefined,
  horizontalAlign: "left" | "center" | "right",
  verticalAlign: "top" | "middle" | "bottom",
  wrap: boolean
): void {
  const maskColor = COLOR_FG;
  const lines = wrap ? wrapText(buffer, text, style, frame.w) : [text];
  const metrics = lines.map((line) => buffer.measureText(line, style));
  const totalHeight = metrics.reduce((sum, entry) => sum + entry.lineHeight, 0);
  let cursorY =
    verticalAlign === "top"
      ? frame.y
      : verticalAlign === "bottom"
        ? frame.y + frame.h - totalHeight
        : frame.y + Math.floor((frame.h - totalHeight) / 2);
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
    temp.drawText(line, startX, cursorY, style, maskColor);
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
              if (temp.getPixel(px, py) === COLOR_BG) {
                buffer.setPixel(px, py, outlineColor);
              }
            }
          }
        }
      }
    }
    for (let y = frame.y; y < frame.y + frame.h; y += 1) {
      for (let x = frame.x; x < frame.x + frame.w; x += 1) {
        if (temp.getPixel(x, y) === maskColor) {
          buffer.setPixel(x, y, fillColor);
        }
      }
    }
    cursorY += runMetrics.lineHeight;
  }
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

function resolveEntityReference(entityRef: string | undefined, inputContext: InputContext): string | undefined {
  if (!entityRef) {
    return undefined;
  }
  const direct = inputContext[entityRef];
  if (typeof direct === "string" && direct) {
    return direct;
  }
  const templated = applyInputTemplate(entityRef, inputContext).trim();
  return templated || undefined;
}

function resolveEntityState(entityRef: string | undefined, data: RenderData, inputContext: InputContext): string {
  if (!entityRef) {
    return "";
  }
  const resolved = resolveEntityReference(entityRef, inputContext);
  if (!resolved) {
    return "";
  }
  const liveValue = data.entities[resolved]?.state;
  if (liveValue !== undefined) {
    return String(liveValue);
  }
  const templated = applyInputTemplate(entityRef, inputContext).trim();
  if (templated && templated !== entityRef) {
    return templated;
  }
  return "unknown";
}

function applyInputTemplate(template: string, inputContext: InputContext): string {
  let output = template;
  for (const [key, value] of Object.entries(inputContext)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizedValue = String(value);
    output = output
      .replace(new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "g"), normalizedValue)
      .replace(new RegExp(`\\$\\{\\s*${escapedKey}\\s*\\}`, "g"), normalizedValue);
  }
  return output;
}

function drawGraph(buffer: PixelBuffer, frame: PixelFrame, data: RenderData, queryId: string | undefined, color: number): void {
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
    buffer.drawRect(frame.x + index * barWidth, frame.y + frame.h - height, Math.max(1, barWidth - 1), height, color, true);
  });
}

function drawPrimitiveNode(
  buffer: PixelBuffer,
  project: Project,
  node: PrimitiveInstanceNode,
  frame: PixelFrame,
  data: RenderData,
  theme: WidgetTheme,
  inputContext: InputContext
): void {
  const token = node.props?.borderToken ?? node.style?.borderToken;
  const thickness = borderThickness(theme, token);
  const innerFrame = insetFrame(frame, thickness + getNodePadding(node));
  if (thickness > 0) {
    buffer.drawRect(frame.x, frame.y, frame.w, frame.h, borderColor(theme, token), false);
    if (thickness > 1) {
      buffer.drawRect(frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2, borderColor(theme, token), false);
    }
  }
  const fillColor = theme.surface.fillRole ? roleToColor(theme.surface.fillRole) : undefined;
  if (fillColor !== undefined && innerFrame.w > 0 && innerFrame.h > 0) {
    buffer.drawRect(innerFrame.x, innerFrame.y, innerFrame.w, innerFrame.h, fillColor, true);
  }

  const outlineColor = theme.textOutline?.enabled ? roleToColor(theme.textOutline.colorRole) : undefined;
  const { bodyStyle, valueStyle } = primitiveTextStyles(node, theme);

  if (node.primitiveType === "text") {
    const rawText = node.props?.renderEntityState
      ? resolveEntityState(node.bindings?.entity, data, inputContext)
      : String(node.props?.text ?? resolveEntityState(node.bindings?.entity, data, inputContext));
    const text = applyInputTemplate(rawText, inputContext);
    const placeholder = applyInputTemplate(String(node.props?.placeholderText ?? ""), inputContext);
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          innerFrame,
          { ...bodyStyle, family: theme.autoFitFontFamily ?? bodyStyle.family },
          text,
          placeholder,
          true
        )
      : { ...bodyStyle, pixelSize: node.props?.fixedPixelSize ?? bodyStyle.pixelSize };
    drawGlyphOutlinedText(
      buffer,
      text,
      innerFrame,
      style,
      roleToColor(theme.text.body),
      outlineColor,
      (node.props?.horizontalAlign ?? "left") as "left" | "center" | "right",
      (node.props?.verticalAlign ?? "top") as "top" | "middle" | "bottom",
      true
    );
    return;
  }

  if (node.primitiveType === "number") {
    const raw = applyInputTemplate(resolveEntityState(node.bindings?.entity, data, inputContext), inputContext);
    const prefix = applyInputTemplate(String(node.props?.prefix ?? ""), inputContext);
    const suffix = applyInputTemplate(String(node.props?.suffix ?? ""), inputContext);
    const quantizeStep = typeof node.props?.quantizeStep === "number" ? Number(node.props.quantizeStep) : 0;
    const display = `${prefix}${formatQuantizedNumber(raw, quantizeStep, Number(node.props?.digits ?? 0))}${suffix}`;
    const placeholder = `${prefix}${applyInputTemplate(String(node.props?.placeholderValue ?? ""), inputContext)}${suffix}`;
    const style = node.props?.autoFit && autoFitAllowed(node)
      ? pickAutoTextStyle(
          buffer,
          innerFrame,
          { ...valueStyle, family: theme.autoFitFontFamily ?? valueStyle.family },
          display,
          placeholder,
          false
        )
      : { ...valueStyle, pixelSize: node.props?.fixedPixelSize ?? valueStyle.pixelSize };
    drawGlyphOutlinedText(
      buffer,
      display,
      innerFrame,
      style,
      roleToColor(theme.text.value),
      outlineColor,
      (node.props?.horizontalAlign ?? "center") as "left" | "center" | "right",
      (node.props?.verticalAlign ?? "middle") as "top" | "middle" | "bottom",
      false
    );
    return;
  }

  if (node.primitiveType === "icon") {
    const iconRows = ICONS[String(node.props?.icon ?? "warning")] ?? ICONS.warning;
    const scale = Math.max(1, Math.floor(Math.min(innerFrame.w / iconRows[0].length, innerFrame.h / iconRows.length)));
    const iconWidth = iconRows[0].length * scale;
    const iconHeight = iconRows.length * scale;
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
    buffer.drawIcon(String(node.props?.icon ?? "warning"), x, y, scale, roleToColor(theme.text.body));
    return;
  }

  if (node.primitiveType === "graph") {
    drawGraph(buffer, innerFrame, data, node.bindings?.query, roleToColor(theme.accentRole));
    return;
  }

  if (node.primitiveType === "line") {
    const direction = String(node.props?.lineDirection ?? "horizontal");
    if (direction === "vertical") {
      drawLine(buffer, innerFrame.x + Math.floor(innerFrame.w / 2), innerFrame.y, innerFrame.x + Math.floor(innerFrame.w / 2), innerFrame.y + innerFrame.h - 1, roleToColor(theme.text.body));
    } else if (direction === "diag_down") {
      drawLine(buffer, innerFrame.x, innerFrame.y, innerFrame.x + innerFrame.w - 1, innerFrame.y + innerFrame.h - 1, roleToColor(theme.text.body));
    } else if (direction === "diag_up") {
      drawLine(buffer, innerFrame.x, innerFrame.y + innerFrame.h - 1, innerFrame.x + innerFrame.w - 1, innerFrame.y, roleToColor(theme.text.body));
    } else {
      drawLine(buffer, innerFrame.x, innerFrame.y + Math.floor(innerFrame.h / 2), innerFrame.x + innerFrame.w - 1, innerFrame.y + Math.floor(innerFrame.h / 2), roleToColor(theme.text.body));
    }
    return;
  }

  if (node.primitiveType === "box") {
    buffer.drawRect(innerFrame.x, innerFrame.y, innerFrame.w, innerFrame.h, roleToColor(theme.text.body), false);
    return;
  }

  if (node.primitiveType === "circle") {
    drawCircle(buffer, innerFrame, roleToColor(theme.text.body), Boolean(node.props?.filled));
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
    true
  );
}

function renderNode(
  buffer: PixelBuffer,
  project: Project,
  node: LayoutNode,
  frame: PixelFrame,
  data: RenderData,
  inheritedThemeId?: string,
  inputContext: InputContext = {},
  collectInspection = false,
  expandCompoundRefs = false
): LayoutInspectionNode | undefined {
  const resolvedThemeId = node.style?.themeId && node.style.themeId !== "inherit" ? node.style.themeId : inheritedThemeId;
  const theme = resolveTheme(project, resolvedThemeId);
  if (node.type === "primitive_instance") {
    drawPrimitiveNode(buffer, project, node, frame, data, theme, inputContext);
    return collectInspection
      ? buildInspectionNode(project, node, frame, insetFrame(frame, borderThickness(theme, node.props?.borderToken ?? node.style?.borderToken) + getNodePadding(node)), resolvedThemeId, [])
      : undefined;
  }
  if (node.type === "compound_ref") {
    const definition = project.widgetDefinitions?.find((entry) => entry.id === node.definitionId && entry.rootNode);
    if (definition?.rootNode) {
      const nestedContext = { ...inputContext };
      for (const input of definition.inputSchema ?? []) {
        const key = input.id;
        const alias = input.name;
        let value: string | number | boolean = input.defaultValue ?? "";
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
        expandCompoundRefs
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
              true
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

  const token = node.style?.borderToken;
  const thickness = borderThickness(theme, token);
  const contentFrame = insetFrame(frame, thickness);
  if (thickness > 0) {
    buffer.drawRect(frame.x, frame.y, frame.w, frame.h, borderColor(theme, token), false);
    if (thickness > 1) {
      buffer.drawRect(frame.x + 1, frame.y + 1, frame.w - 2, frame.h - 2, borderColor(theme, token), false);
    }
  }
  const containerFillColor = theme.surface.fillRole ? roleToColor(theme.surface.fillRole) : undefined;
  if (containerFillColor !== undefined && contentFrame.w > 0 && contentFrame.h > 0) {
    buffer.drawRect(contentFrame.x, contentFrame.y, contentFrame.w, contentFrame.h, containerFillColor, true);
  }
  const innerFrame = insetFrame(contentFrame, getNodePadding(node));
  const gap = Math.max(0, Number(node.style?.gapPx ?? 0));

  if (node.type === "zstack") {
    const children: LayoutInspectionNode[] = [];
    for (const child of node.children) {
      const inspection = renderNode(buffer, project, child, innerFrame, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs);
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
            innerFrame.w,
            "width",
            child,
            buffer,
            theme,
            project.fontPresets,
            data,
            inputContext,
            innerFrame.w
          );
      assigned[index] = resolveSize(
        spec,
        availableMain,
        horizontal ? "width" : "height",
        child,
        buffer,
        theme,
        project.fontPresets,
        data,
        inputContext,
        contentWidthHint
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
      const inspection = renderNode(buffer, project, child, childFrame, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs);
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
      const inspection = renderNode(buffer, project, child.node, { x, y, w, h }, data, resolvedThemeId, inputContext, collectInspection, expandCompoundRefs);
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
  return undefined;
}

export function resolveAssignedLayout(project: Project, displayId: string, data: RenderData): { layout: LayoutDefinition; popup?: LayoutDefinition; assignment: DeviceAssignment; display: ManagedDisplay } {
  const display = project.devices?.find((entry) => entry.id === displayId);
  if (!display) {
    throw new Error(`Unknown display ${displayId}`);
  }
  const assignment = project.deviceAssignments?.find((entry) => entry.displayId === displayId);
  if (!assignment) {
    throw new Error(`No assignment for display ${displayId}`);
  }
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
  const layout = project.layoutDefinitions?.find((entry) => entry.id === layoutId);
  if (!layout) {
    throw new Error(`Unknown fullscreen layout ${layoutId ?? ""}`);
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

export function renderLayoutDefinition(
  project: Project,
  layout: LayoutDefinition,
  data: RenderData,
  popup?: LayoutDefinition,
  themeId?: string
): RenderedImage {
  if (layout.legacyScreenId) {
    const forcedScenarioId = `designer-legacy-${layout.id}`;
    const legacyProject = {
      ...project,
      scenarios: [
        ...(project.scenarios ?? []).filter((entry) => entry.id !== forcedScenarioId),
        {
          id: forcedScenarioId,
          name: "Designer legacy preview",
          forcedScreenId: layout.legacyScreenId,
          forcedOverlayId: popup?.legacyOverlayId
        }
      ]
    };
    return renderLegacyProject(legacyProject, layout.displayTypeId, data, forcedScenarioId);
  }
  const displayType = resolveDisplayType(project, layout.displayTypeId);
  const buffer = new PixelBuffer(displayType.width, displayType.height, COLOR_BG, project.fontPresets);
  buffer.fill(COLOR_BG);
  if (layout.rootNode) {
    renderNode(buffer, project, layout.rootNode, { x: 0, y: 0, w: displayType.width, h: displayType.height }, data, themeId, {}, false);
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
      renderNode(buffer, project, popup.rootNode, popupFrame, data, themeId, {}, false);
    }
  }
  const rgba = rgbaFromPixels(buffer, displayType);
  const hash = createStableHash([displayType.id, layout.id, popup?.id ?? "", buffer.pixels]);
  return {
    width: buffer.width,
    height: buffer.height,
    pixels: buffer.pixels,
    rgba,
    hash,
    activeScreenId: layout.id,
    activeOverlayId: popup?.id
  };
}

export function inspectLayoutDefinition(
  project: Project,
  layout: LayoutDefinition,
  data: RenderData,
  popup?: LayoutDefinition,
  themeId?: string,
  expandCompoundRefs = false
): LayoutInspectionResult {
  const displayType = resolveDisplayType(project, layout.displayTypeId);
  const buffer = new PixelBuffer(displayType.width, displayType.height, COLOR_BG, project.fontPresets);
  const root = layout.rootNode
    ? renderNode(
        buffer,
        project,
        layout.rootNode,
        { x: 0, y: 0, w: displayType.width, h: displayType.height },
        data,
        themeId,
        {},
        true,
        expandCompoundRefs
      )
    : undefined;
  let popupInspection: LayoutInspectionNode | undefined;
  if (popup?.rootNode) {
    const popupWidth = Math.min(displayType.width, popup.popupDefaults?.widthPx ?? Math.floor(displayType.width * 0.8));
    const popupHeight = Math.min(displayType.height, popup.popupDefaults?.heightPx ?? Math.floor(displayType.height * 0.5));
    const popupFrame = {
      x: Math.floor((displayType.width - popupWidth) / 2),
      y: Math.floor((displayType.height - popupHeight) / 2),
      w: popupWidth,
      h: popupHeight
    };
    popupInspection = renderNode(buffer, project, popup.rootNode, popupFrame, data, themeId, {}, true, expandCompoundRefs);
  }
  return {
    width: displayType.width,
    height: displayType.height,
    root,
    popup: popupInspection
  };
}

export function renderAssignedDisplay(project: Project, displayId: string, data: RenderData): RenderedImage {
  const resolved = resolveAssignedLayout(project, displayId, data);
  return renderLayoutDefinition(project, resolved.layout, data, resolved.popup, resolved.assignment.defaultThemeId);
}
