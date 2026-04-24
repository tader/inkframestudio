import {
  DISPLAY_PROFILES,
  registerUserFonts,
  renderAssignedDisplay,
  inspectLayoutDefinition,
  renderLayoutDefinition,
} from "../../render-core/src/index.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import type { Project, RenderData } from "../../render-core/src/types.js";
import { installRustTextLayoutAdapter } from "./rust-text-engine.js";
import { installProjectScriptingRuntime } from "./script-runtime.js";

type BridgeRequest =
  | { op: "layout-preview"; projectId: string; body?: unknown };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildProjectOverride(projectId: string, body: unknown): Project | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const candidate = (body as { project?: Project }).project;
  if (!candidate || candidate.id !== projectId) {
    return undefined;
  }
  return normalizeProject(candidate);
}

function projectFromRequest(projectId: string, body: unknown): Project {
  const project = buildProjectOverride(projectId, body);
  if (project) {
    return project;
  }
  throw new Error("Render bridge requires project payload from Rust backend");
}

function providedRenderData(body: unknown): { data: RenderData; message?: string } | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const candidate = (body as { data?: RenderData; dataSourceMessage?: string }).data;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  return {
    data: candidate,
    message:
      typeof (body as { dataSourceMessage?: unknown }).dataSourceMessage === "string"
        ? String((body as { dataSourceMessage?: unknown }).dataSourceMessage)
        : undefined
  };
}

function requiredRenderData(body: unknown): { data: RenderData; message?: string } {
  const provided = providedRenderData(body);
  if (provided) {
    return provided;
  }
  throw new Error("Render bridge requires resolved render data from Rust backend");
}

function providedUserFonts(
  body: unknown
): Record<string, { regular?: string; italic?: string; bold?: string; boldItalic?: string; label?: string; allowedPixelSizes?: number[] }> {
  if (!body || typeof body !== "object") {
    return {};
  }
  const candidate = (body as { userFonts?: unknown }).userFonts;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }
  return candidate as Record<
    string,
    { regular?: string; italic?: string; bold?: string; boldItalic?: string; label?: string; allowedPixelSizes?: number[] }
  >;
}

function renderedResponse(rendered: {
  width: number;
  height: number;
  hash: string;
  activeScreenId: string;
  activeOverlayId?: string;
  scriptWarnings?: string[];
  rgba: Uint8ClampedArray;
}, dataSourceMessage?: string) {
  return {
    width: rendered.width,
    height: rendered.height,
    hash: rendered.hash,
    activeScreenId: rendered.activeScreenId,
    activeOverlayId: rendered.activeOverlayId,
    scriptWarnings: rendered.scriptWarnings,
    dataSourceMessage,
    rgba: Array.from(rendered.rgba)
  };
}

function combinedRenderedResponse(
  preview: {
    width: number;
    height: number;
    hash: string;
    activeScreenId: string;
    activeOverlayId?: string;
    scriptWarnings?: string[];
    rgba: Uint8ClampedArray;
  },
  inspection: unknown,
  dataSourceMessage?: string
) {
  return {
    preview: renderedResponse(preview, dataSourceMessage),
    inspection
  };
}

async function main(): Promise<void> {
  installRustTextLayoutAdapter();
  installProjectScriptingRuntime();

  const payloadText = await readStdin();
  const request = JSON.parse(payloadText || "{}") as BridgeRequest;
  registerUserFonts(providedUserFonts("body" in request ? request.body : undefined));

  switch (request.op) {
    case "layout-preview": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const layoutId = String(body?.layoutId ?? "");
      const displayId = typeof body?.displayId === "string" ? String(body.displayId) : undefined;
      const popupLayoutId = typeof body?.popupLayoutId === "string" ? String(body.popupLayoutId) : undefined;
      const previewData = requiredRenderData(body);
      if (displayId) {
        process.stdout.write(
          `${JSON.stringify(renderedResponse(renderAssignedDisplay(project, displayId, previewData.data), previewData.message))}\n`
        );
        return;
      }
      const layout = project.layoutDefinitions?.find((entry) => entry.id === layoutId);
      const popup = popupLayoutId ? project.layoutDefinitions?.find((entry) => entry.id === popupLayoutId) : undefined;
      if (!layout) {
        throw new Error(`Unknown layout ${layoutId}`);
      }
      const preview = renderLayoutDefinition(project, layout, previewData.data, popup);
      if (body?.includeInspection) {
        const inspection = inspectLayoutDefinition(
          project,
          layout,
          previewData.data,
          popup,
          undefined,
          Boolean(body?.expandCompoundRefs)
        );
        process.stdout.write(`${JSON.stringify(combinedRenderedResponse(preview, inspection, previewData.message))}\n`);
        return;
      }
      process.stdout.write(`${JSON.stringify(renderedResponse(preview, previewData.message))}\n`);
      return;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
