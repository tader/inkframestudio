import { createStableHash } from "./hash.js";
import { layoutText } from "./bitmap-font.js";
import { COLOR_ACCENT, COLOR_BG, COLOR_FG, PixelBuffer } from "./pixel-buffer.js";
import { formatQuantizedNumber } from "./quantize.js";
import { resolveProjectState } from "./resolve.js";
import { getThemeByRef, getWidgetTheme } from "./themes.js";
import type {
  DisplayProfile,
  NumericThemeRule,
  Overlay,
  PaletteRole,
  Project,
  QueryResult,
  RenderData,
  RenderedImage,
  Screen,
  TextStyle,
  WidgetInstance,
  WidgetTheme
} from "./types.js";

interface PixelFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ResolvedWidgetRender {
  widget: WidgetInstance;
  frame: PixelFrame;
  theme: WidgetTheme;
  titleColor: number;
  bodyColor: number;
  valueColor: number;
  accentColor: number;
  borderColor: number;
  surfaceColor?: number;
  borderVisible: boolean;
  borderMergeEnabled: boolean;
}

interface TextClipFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseHexColor(value: string): [number, number, number] {
  const safe = value.startsWith("#") ? value.slice(1) : value;
  const numeric = Number.parseInt(safe, 16);
  return [(numeric >> 16) & 0xff, (numeric >> 8) & 0xff, numeric & 0xff];
}

function toPixelFrame(frame: WidgetInstance["frame"], profile: DisplayProfile): PixelFrame {
  return {
    x: Math.round(frame.x * profile.gridUnitPx),
    y: Math.round(frame.y * profile.gridUnitPx),
    w: Math.round(frame.w * profile.gridUnitPx),
    h: Math.round(frame.h * profile.gridUnitPx)
  };
}

function rgbaFromPixels(buffer: PixelBuffer, profile: DisplayProfile): Uint8ClampedArray {
  const colors = [
    parseHexColor(profile.palette.bg),
    parseHexColor(profile.palette.fg),
    parseHexColor(profile.palette.accent)
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

function colorForRole(role: PaletteRole): number {
  if (role === "bg") return COLOR_BG;
  if (role === "accent") return COLOR_ACCENT;
  return COLOR_FG;
}

function drawHistoryBars(
  buffer: PixelBuffer,
  frame: PixelFrame,
  result: QueryResult | undefined,
  color: number,
  textColor: number
): void {
  const points = result?.points ?? [];
  if (!points.length) {
    buffer.drawText("NO DATA", frame.x + 2, frame.y + 2, { size: "tiny", weight: "regular" }, textColor);
    return;
  }
  const values = points.map((point) => point.value);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const spread = Math.max(1, maxValue - minValue);
  const barWidth = Math.max(1, Math.floor(frame.w / points.length));
  points.forEach((point, index) => {
    const normalized = (point.value - minValue) / spread;
    const height = Math.max(1, Math.round((frame.h - 2) * normalized));
    buffer.drawRect(
      frame.x + index * barWidth,
      frame.y + frame.h - height,
      Math.max(1, barWidth - 1),
      height,
      color,
      true
    );
  });
}

function mergeTextStyle(
  base: Partial<TextStyle>,
  override?: Partial<TextStyle>
): Partial<TextStyle> {
  return {
    ...base,
    ...(override ?? {})
  };
}

function parseNumeric(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function compareNumeric(value: number, rule: NumericThemeRule): boolean {
  if (rule.op === "gt") return value > rule.value;
  if (rule.op === "gte") return value >= rule.value;
  if (rule.op === "lt") return value < rule.value;
  if (rule.op === "lte") return value <= rule.value;
  if (rule.op === "eq") return value === rule.value;
  return value !== rule.value;
}

function resolveNumericTheme(
  project: Project,
  screen: Screen,
  widget: WidgetInstance,
  data: RenderData
): WidgetTheme {
  const baseTheme = getWidgetTheme(project, screen, widget);
  const entity = widget.bindings.entity ? data.entities[widget.bindings.entity] : undefined;
  const rawValue = entity?.attributes?.value ?? entity?.state;
  const numeric = parseNumeric(rawValue);
  if (numeric === undefined) {
    return widget.props.unavailableThemeId
      ? getThemeByRef(project, screen, widget.props.unavailableThemeId)
      : baseTheme;
  }
  const rules = (widget.props.numericThemeRules as NumericThemeRule[] | undefined) ?? [];
  const matched = rules.find((rule) => compareNumeric(numeric, rule));
  return matched ? getThemeByRef(project, screen, matched.themeId) : baseTheme;
}

function resolveRenderTheme(
  project: Project,
  screen: Screen,
  widget: WidgetInstance,
  data: RenderData
): WidgetTheme {
  if (widget.type === "numeric_state") {
    return resolveNumericTheme(project, screen, widget, data);
  }
  return getWidgetTheme(project, screen, widget);
}

function drawLayoutRunClipped(
  buffer: PixelBuffer,
  text: string,
  x: number,
  y: number,
  style: Partial<TextStyle>,
  color: number,
  clip: TextClipFrame
): void {
  const run = layoutText(text, style, buffer.fontPresets);
  for (const glyph of run.glyphs) {
    for (let gy = 0; gy < glyph.height; gy += 1) {
      for (let gx = 0; gx < glyph.width; gx += 1) {
        if (!glyph.pixels[gy]?.[gx]) {
          continue;
        }
        const pixelX = x + glyph.x + gx;
        const pixelY = y + glyph.y + gy;
        if (
          pixelX < clip.x ||
          pixelY < clip.y ||
          pixelX >= clip.x + clip.w ||
          pixelY >= clip.y + clip.h
        ) {
          continue;
        }
        buffer.setPixel(pixelX, pixelY, color);
      }
    }
  }
}

function wrapTextByCharacter(
  text: string,
  style: Partial<TextStyle>,
  maxWidth: number,
  buffer: PixelBuffer
): string[] {
  const characters = Array.from(text);
  const lines: string[] = [];
  let current = "";
  for (const character of characters) {
    const next = `${current}${character}`;
    if (!current || layoutText(next, style, buffer.fontPresets).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = character;
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [text];
}

function drawWrappedTextBlock(
  buffer: PixelBuffer,
  text: string,
  frame: TextClipFrame,
  style: Partial<TextStyle>,
  color: number,
  horizontalAlign: "left" | "center" | "right",
  verticalAlign: "top" | "middle" | "bottom"
): void {
  const lines = wrapTextByCharacter(text, style, frame.w, buffer);
  const runs = lines.map((line) => ({
    text: line,
    metrics: layoutText(line, style, buffer.fontPresets)
  }));
  const totalHeight = runs.reduce((sum, run) => sum + run.metrics.lineHeight, 0);
  const startY =
    verticalAlign === "top"
      ? frame.y
      : verticalAlign === "bottom"
        ? frame.y + frame.h - totalHeight
        : frame.y + Math.floor((frame.h - totalHeight) / 2);
  let cursorY = startY;
  for (const run of runs) {
    const startX =
      horizontalAlign === "left"
        ? frame.x
        : horizontalAlign === "right"
          ? frame.x + frame.w - run.metrics.width
          : frame.x + Math.floor((frame.w - run.metrics.width) / 2);
    drawLayoutRunClipped(buffer, run.text, startX, cursorY, style, color, frame);
    cursorY += run.metrics.lineHeight;
  }
}

function bestFittingSingleLineSize(
  buffer: PixelBuffer,
  texts: string[],
  style: Partial<TextStyle>,
  frame: TextClipFrame
): number {
  for (let size = 36; size >= 4; size -= 1) {
    const candidate = { ...style, pixelSize: size };
    if (
      texts.every((entry) => {
        const metrics = layoutText(entry, candidate, buffer.fontPresets);
        return metrics.width <= frame.w && metrics.height <= frame.h;
      })
    ) {
      return size;
    }
  }
  return 4;
}

function drawVerticalLine(buffer: PixelBuffer, x: number, y: number, h: number, color: number): void {
  for (let py = y; py < y + h; py += 1) {
    buffer.setPixel(x, py, color);
  }
}

function drawHorizontalLine(buffer: PixelBuffer, x: number, y: number, w: number, color: number): void {
  for (let px = x; px < x + w; px += 1) {
    buffer.setPixel(px, y, color);
  }
}

function drawLineSegment(
  buffer: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number
): void {
  let currentX = x0;
  let currentY = y0;
  const deltaX = Math.abs(x1 - x0);
  const stepX = x0 < x1 ? 1 : -1;
  const deltaY = -Math.abs(y1 - y0);
  const stepY = y0 < y1 ? 1 : -1;
  let error = deltaX + deltaY;
  while (true) {
    buffer.setPixel(currentX, currentY, color);
    if (currentX === x1 && currentY === y1) {
      break;
    }
    const doubled = error * 2;
    if (doubled >= deltaY) {
      error += deltaY;
      currentX += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      currentY += stepY;
    }
  }
}

function drawEllipse(buffer: PixelBuffer, frame: PixelFrame, color: number, filled = false): void {
  const radiusX = Math.max(1, Math.floor(frame.w / 2));
  const radiusY = Math.max(1, Math.floor(frame.h / 2));
  const centerX = frame.x + Math.floor(frame.w / 2);
  const centerY = frame.y + Math.floor(frame.h / 2);
  for (let y = frame.y; y < frame.y + frame.h; y += 1) {
    for (let x = frame.x; x < frame.x + frame.w; x += 1) {
      const normX = (x - centerX + 0.5) / radiusX;
      const normY = (y - centerY + 0.5) / radiusY;
      const distance = normX * normX + normY * normY;
      if (filled) {
        if (distance <= 1) {
          buffer.setPixel(x, y, color);
        }
      } else if (distance <= 1 && distance >= 0.78) {
        buffer.setPixel(x, y, color);
      }
    }
  }
}

function resolveWidgetRender(
  project: Project,
  screen: Screen,
  widget: WidgetInstance,
  profile: DisplayProfile,
  data: RenderData,
  overlay?: Overlay
): ResolvedWidgetRender {
  const localFrame = toPixelFrame(widget.frame, profile);
  const frame = overlay
    ? {
        x: overlay.frame.x * profile.gridUnitPx + localFrame.x,
        y: overlay.frame.y * profile.gridUnitPx + localFrame.y,
        w: localFrame.w,
        h: localFrame.h
      }
    : localFrame;
  const theme = resolveRenderTheme(project, screen, widget, data);
  const borderVisible = widget.props.border ?? theme.border.visible;
  const borderMergeEnabled =
    widget.props.borderMerge === "always"
      ? true
      : widget.props.borderMerge === "never"
        ? false
        : theme.border.mergeAdjacentBorders;

  return {
    widget,
    frame,
    theme,
    titleColor: colorForRole(theme.text.title),
    bodyColor: colorForRole(theme.text.body),
    valueColor: colorForRole(theme.text.value),
    accentColor: widget.props.accent === "fg" ? COLOR_FG : colorForRole(theme.accentRole),
    borderColor: colorForRole(theme.border.colorRole),
    surfaceColor: theme.surface.fillRole ? colorForRole(theme.surface.fillRole) : undefined,
    borderVisible,
    borderMergeEnabled
  };
}

function drawWidgetContent(
  buffer: PixelBuffer,
  resolved: ResolvedWidgetRender,
  data: RenderData
): void {
  const { widget, frame, surfaceColor, titleColor, bodyColor, valueColor, accentColor } = resolved;
  const title = String(widget.props.title ?? widget.id);
  const titleStyle = mergeTextStyle({ size: "tiny", weight: "regular", family: "px-sans" }, widget.props.titleTextStyle);
  const bodyStyle = mergeTextStyle({ size: "tiny", weight: "regular", family: "px-sans" }, widget.props.bodyTextStyle);
  const valueStyle = mergeTextStyle(
    { size: "header", weight: "bold", family: "px-mono-special", tabularNumbers: true },
    widget.props.valueTextStyle
  );

  if (surfaceColor !== undefined && surfaceColor !== COLOR_BG) {
    buffer.drawRect(frame.x, frame.y, frame.w, frame.h, surfaceColor, true);
  }

  switch (widget.type) {
    case "static_text": {
      const text = String(widget.props.text ?? widget.props.title ?? widget.id);
      const horizontalAlign =
        widget.props.horizontalAlign === "center" || widget.props.horizontalAlign === "right"
          ? widget.props.horizontalAlign
          : "left";
      const verticalAlign =
        widget.props.verticalAlign === "middle" || widget.props.verticalAlign === "bottom"
          ? widget.props.verticalAlign
          : "top";
      drawWrappedTextBlock(
        buffer,
        text,
        {
          x: frame.x + (resolved.borderVisible ? 2 : 0),
          y: frame.y + (resolved.borderVisible ? 2 : 0),
          w: Math.max(1, frame.w - (resolved.borderVisible ? 4 : 0)),
          h: Math.max(1, frame.h - (resolved.borderVisible ? 4 : 0))
        },
        mergeTextStyle({ size: "normal", weight: "regular", family: "px-sans" }, widget.props.bodyTextStyle),
        bodyColor,
        horizontalAlign,
        verticalAlign
      );
      break;
    }
    case "box": {
      break;
    }
    case "line": {
      const direction = widget.props.lineDirection ?? "horizontal";
      if (direction === "vertical") {
        drawLineSegment(buffer, frame.x + Math.floor(frame.w / 2), frame.y, frame.x + Math.floor(frame.w / 2), frame.y + frame.h - 1, bodyColor);
      } else if (direction === "diag_down") {
        drawLineSegment(buffer, frame.x, frame.y, frame.x + frame.w - 1, frame.y + frame.h - 1, bodyColor);
      } else if (direction === "diag_up") {
        drawLineSegment(buffer, frame.x, frame.y + frame.h - 1, frame.x + frame.w - 1, frame.y, bodyColor);
      } else {
        drawLineSegment(buffer, frame.x, frame.y + Math.floor(frame.h / 2), frame.x + frame.w - 1, frame.y + Math.floor(frame.h / 2), bodyColor);
      }
      break;
    }
    case "circle": {
      drawEllipse(buffer, frame, bodyColor, Boolean(widget.props.filled));
      break;
    }
    case "state_tile": {
      const label = String(widget.props.label ?? title);
      const entity = data.entities[widget.bindings.entity];
      const state = String(widget.props.stateText ?? entity?.state ?? "UNKNOWN");
      const subline =
        entity && widget.props.showDuration
          ? `SINCE ${new Date(entity.lastChanged).toISOString().slice(11, 16)}`
          : String(widget.props.subline ?? "");
      const iconName = String(widget.props.icon ?? "garage");
      buffer.drawText(label, frame.x + 4, frame.y + 4, titleStyle, titleColor);
      buffer.drawIcon(iconName, frame.x + 4, frame.y + 18, 2, bodyColor);
      buffer.drawText(state, frame.x + 36, frame.y + 24, valueStyle, accentColor);
      if (subline) {
        buffer.drawText(subline, frame.x + 4, frame.y + frame.h - 12, bodyStyle, bodyColor);
      }
      break;
    }
    case "big_value": {
      const entity = data.entities[widget.bindings.entity];
      const rawValue = entity?.attributes?.value ?? entity?.state;
      const unit = String(widget.props.unit ?? entity?.attributes?.unit_of_measurement ?? "");
      const step = typeof widget.props.quantizeStep === "number" ? Number(widget.props.quantizeStep) : 0;
      const digits = typeof widget.props.digits === "number" ? Number(widget.props.digits) : undefined;
      buffer.drawText(title, frame.x + 2, frame.y + 2, titleStyle, titleColor);
      buffer.drawText(
        formatQuantizedNumber(rawValue, step, digits),
        frame.x + 2,
        frame.y + 16,
        valueStyle,
        valueColor
      );
      if (unit) {
        buffer.drawText(unit, frame.x + 2, frame.y + frame.h - 10, bodyStyle, accentColor);
      }
      break;
    }
    case "numeric_state": {
      const entity = data.entities[widget.bindings.entity];
      const rawValue = entity?.attributes?.value ?? entity?.state;
      const step = typeof widget.props.quantizeStep === "number" ? Number(widget.props.quantizeStep) : 0;
      const digits = typeof widget.props.digits === "number" ? Number(widget.props.digits) : undefined;
      const displayText = formatQuantizedNumber(rawValue, step, digits);
      const horizontalAlign =
        widget.props.horizontalAlign === "left" || widget.props.horizontalAlign === "right"
          ? widget.props.horizontalAlign
          : "center";
      const verticalAlign =
        widget.props.verticalAlign === "top" || widget.props.verticalAlign === "bottom"
          ? widget.props.verticalAlign
          : "middle";
      const sizingMode =
        widget.props.valueSizingMode === "fixed" || widget.props.fixedPixelSize
          ? "fixed"
          : "auto_placeholder";
      const clipFrame = {
        x: frame.x + (resolved.borderVisible ? 2 : 0),
        y: frame.y + (resolved.borderVisible ? 2 : 0),
        w: Math.max(1, frame.w - (resolved.borderVisible ? 4 : 0)),
        h: Math.max(1, frame.h - (resolved.borderVisible ? 4 : 0))
      };
      const numericStyle = mergeTextStyle(
        { family: "px-mono-special", weight: "regular", size: "normal", tabularNumbers: true },
        widget.props.valueTextStyle
      );
      if (sizingMode === "fixed") {
        drawWrappedTextBlock(
          buffer,
          displayText,
          clipFrame,
          {
            ...numericStyle,
            pixelSize: Math.max(4, Math.min(36, Number(widget.props.fixedPixelSize ?? 12)))
          },
          valueColor,
          horizontalAlign,
          verticalAlign
        );
      } else {
        const placeholder = String(widget.props.placeholderValue ?? displayText);
        const fittedSize = bestFittingSingleLineSize(buffer, [displayText, placeholder], numericStyle, clipFrame);
        const finalStyle = {
          ...numericStyle,
          pixelSize: fittedSize
        };
        const metrics = layoutText(displayText, finalStyle, buffer.fontPresets);
        const startX =
          horizontalAlign === "left"
            ? clipFrame.x
            : horizontalAlign === "right"
              ? clipFrame.x + clipFrame.w - metrics.width
              : clipFrame.x + Math.floor((clipFrame.w - metrics.width) / 2);
        const startY =
          verticalAlign === "top"
            ? clipFrame.y
            : verticalAlign === "bottom"
              ? clipFrame.y + clipFrame.h - metrics.height
              : clipFrame.y + Math.floor((clipFrame.h - metrics.height) / 2);
        drawLayoutRunClipped(buffer, displayText, startX, startY, finalStyle, valueColor, clipFrame);
      }
      break;
    }
    case "agenda_list": {
      const query = data.queries[widget.bindings.query];
      const items = query?.items ?? [];
      buffer.drawText(String(widget.props.header ?? title), frame.x + 2, frame.y + 2, titleStyle, titleColor);
      if (!items.length) {
        buffer.drawText(
          String(widget.props.emptyText ?? "NO EVENTS"),
          frame.x + 2,
          frame.y + 18,
          valueStyle,
          accentColor
        );
        break;
      }
      items.slice(0, Number(widget.props.maxItems ?? 4)).forEach((item, index) => {
        const start = String(item.start ?? "--:--");
        const summary = String(item.summary ?? "UNTITLED");
        const color = widget.props.highlightFirst !== false && index === 0 ? accentColor : bodyColor;
        buffer.drawText(
          start.slice(11, 16),
          frame.x + 2,
          frame.y + 16 + index * 12,
          mergeTextStyle(bodyStyle, { family: "px-mono-special", tabularNumbers: true }),
          color
        );
        buffer.drawText(summary.slice(0, 18), frame.x + 40, frame.y + 16 + index * 12, bodyStyle, color);
      });
      break;
    }
    case "alert_banner": {
      buffer.drawIcon(String(widget.props.icon ?? "warning"), frame.x + 4, frame.y + 4, 2, accentColor);
      buffer.drawText(String(widget.props.headline ?? title), frame.x + 32, frame.y + 6, valueStyle, accentColor);
      if (widget.props.detail) {
        buffer.drawText(String(widget.props.detail), frame.x + 4, frame.y + frame.h - 12, bodyStyle, bodyColor);
      }
      break;
    }
    case "date_time_compact": {
      const now = new Date(data.now);
      const isoDate = now.toISOString().slice(0, 10).replaceAll("-", "/");
      const date =
        widget.props.dateFormat === "weekday-date"
          ? now.toUTCString().slice(0, 16).replace(",", "")
          : widget.props.dateFormat === "day-month"
            ? now.toISOString().slice(5, 10).replace("-", "/")
            : isoDate;
      const time =
        widget.props.timeFormat === "12h"
          ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(now)
          : now.toISOString().slice(11, 16);
      buffer.drawText(date, frame.x + 2, frame.y + 2, titleStyle, titleColor);
      buffer.drawText(
        time,
        frame.x + 2,
        frame.y + 16,
        mergeTextStyle(valueStyle, { family: "px-mono-special", tabularNumbers: true }),
        valueColor
      );
      break;
    }
    case "status_strip": {
      const statuses =
        (widget.props.items as Array<{ label: string; color?: "fg" | "accent"; icon?: string }> | undefined) ?? [];
      let cursor = frame.x + 2;
      for (const item of statuses.slice(0, 5)) {
        const color = item.color === "accent" ? accentColor : bodyColor;
        if (item.icon) {
          buffer.drawIcon(item.icon, cursor, frame.y + 1, 1, color);
          cursor += 14;
        }
        buffer.drawText(item.label, cursor, frame.y + 2, bodyStyle, color);
        cursor += buffer.measureText(item.label, bodyStyle).width + 10;
      }
      break;
    }
    case "history_bars": {
      const graphColor = widget.props.colorRole ? colorForRole(widget.props.colorRole) : accentColor;
      if (title) {
        buffer.drawText(title, frame.x + 2, frame.y + 2, titleStyle, titleColor);
      }
      drawHistoryBars(buffer, frame, data.queries[widget.bindings.query], graphColor, bodyColor);
      break;
    }
    case "placeholder":
    default: {
      buffer.drawText(title, frame.x + 4, frame.y + 4, titleStyle, titleColor);
      break;
    }
  }
}

function drawMergedBorders(buffer: PixelBuffer, widgets: ResolvedWidgetRender[]): void {
  const edges = new Map<string, { top: boolean; right: boolean; bottom: boolean; left: boolean }>();
  for (const resolved of widgets) {
    edges.set(resolved.widget.id, {
      top: resolved.borderVisible,
      right: resolved.borderVisible,
      bottom: resolved.borderVisible,
      left: resolved.borderVisible
    });
  }

  for (let index = 0; index < widgets.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < widgets.length; otherIndex += 1) {
      const left = widgets[index];
      const right = widgets[otherIndex];
      if (
        !left.borderVisible ||
        !right.borderVisible ||
        !left.borderMergeEnabled ||
        !right.borderMergeEnabled ||
        left.borderColor !== right.borderColor
      ) {
        continue;
      }

      if (left.frame.x + left.frame.w === right.frame.x && left.frame.y === right.frame.y && left.frame.h === right.frame.h) {
        edges.get(right.widget.id)!.left = false;
      } else if (right.frame.x + right.frame.w === left.frame.x && left.frame.y === right.frame.y && left.frame.h === right.frame.h) {
        edges.get(left.widget.id)!.left = false;
      } else if (left.frame.y + left.frame.h === right.frame.y && left.frame.x === right.frame.x && left.frame.w === right.frame.w) {
        edges.get(right.widget.id)!.top = false;
      } else if (right.frame.y + right.frame.h === left.frame.y && left.frame.x === right.frame.x && left.frame.w === right.frame.w) {
        edges.get(left.widget.id)!.top = false;
      }
    }
  }

  for (const resolved of widgets) {
    if (!resolved.borderVisible) {
      continue;
    }
    const edge = edges.get(resolved.widget.id);
    if (!edge) {
      continue;
    }
    if (edge.top) {
      drawHorizontalLine(buffer, resolved.frame.x, resolved.frame.y, resolved.frame.w, resolved.borderColor);
    }
    if (edge.bottom) {
      drawHorizontalLine(
        buffer,
        resolved.frame.x,
        resolved.frame.y + resolved.frame.h - 1,
        resolved.frame.w,
        resolved.borderColor
      );
    }
    if (edge.left) {
      drawVerticalLine(buffer, resolved.frame.x, resolved.frame.y, resolved.frame.h, resolved.borderColor);
    }
    if (edge.right) {
      drawVerticalLine(
        buffer,
        resolved.frame.x + resolved.frame.w - 1,
        resolved.frame.y,
        resolved.frame.h,
        resolved.borderColor
      );
    }
  }
}

function drawWidgetLayer(
  buffer: PixelBuffer,
  project: Project,
  screen: Screen,
  widgets: WidgetInstance[],
  profile: DisplayProfile,
  data: RenderData,
  overlay?: Overlay
): void {
  const resolved = widgets.map((widget) => resolveWidgetRender(project, screen, widget, profile, data, overlay));
  for (const widget of resolved) {
    drawWidgetContent(buffer, widget, data);
  }
  drawMergedBorders(buffer, resolved);
}

export function renderProject(
  project: Project,
  displayProfileId: string,
  data: RenderData,
  scenarioId?: string
): RenderedImage {
  const resolved = resolveProjectState(project, displayProfileId, data, scenarioId);
  const buffer = new PixelBuffer(
    resolved.displayProfile.width,
    resolved.displayProfile.height,
    COLOR_BG,
    project.fontPresets
  );
  buffer.fill(COLOR_BG);

  drawWidgetLayer(
    buffer,
    project,
    resolved.activeScreen,
    resolved.widgets.filter((entry) => entry.screenId === resolved.activeScreen.id),
    resolved.displayProfile,
    resolved.data
  );

  if (resolved.activeOverlay) {
    const overlayFrame = toPixelFrame(resolved.activeOverlay.frame as WidgetInstance["frame"], resolved.displayProfile);
    buffer.drawRect(overlayFrame.x, overlayFrame.y, overlayFrame.w, overlayFrame.h, COLOR_BG, true);
    buffer.drawRect(overlayFrame.x, overlayFrame.y, overlayFrame.w, overlayFrame.h, COLOR_FG, false);
    drawWidgetLayer(
      buffer,
      project,
      resolved.activeScreen,
      resolved.widgets.filter((entry) => entry.overlayId === resolved.activeOverlay?.id),
      resolved.displayProfile,
      resolved.data,
      resolved.activeOverlay
    );
  }

  const rgba = rgbaFromPixels(buffer, resolved.displayProfile);
  const hash = createStableHash([
    resolved.displayProfile.id,
    resolved.activeScreen.id,
    resolved.activeOverlay?.id ?? "",
    buffer.pixels
  ]);

  return {
    width: buffer.width,
    height: buffer.height,
    pixels: buffer.pixels,
    rgba,
    hash,
    activeScreenId: resolved.activeScreen.id,
    activeOverlayId: resolved.activeOverlay?.id
  };
}
