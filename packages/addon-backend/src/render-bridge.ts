import {
  DISPLAY_PROFILES,
  registerUserFonts,
  renderAssignedDisplay,
  inspectLayoutDefinition,
  renderLegacyProject,
  renderLayoutDefinition,
} from "../../render-core/src/index.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import type { Project, RenderData, Scenario } from "../../render-core/src/types.js";
import { installRustTextLayoutAdapter } from "./rust-text-engine.js";
import { installProjectScriptingRuntime } from "./script-runtime.js";

type BridgeRequest =
  | { op: "preview"; projectId: string; body?: unknown }
  | { op: "layout-preview"; projectId: string; body?: unknown }
  | { op: "render-project-live"; projectId: string; body?: unknown }
  | { op: "render-assigned-live"; projectId: string; body?: unknown };

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function buildScenario(project: Project, body: unknown): Scenario | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const candidate = body as Partial<Scenario>;
  if (!candidate.id) {
    return undefined;
  }
  return {
    id: candidate.id,
    name: candidate.name ?? "Ad hoc scenario",
    frozenNow: candidate.frozenNow,
    entityOverrides: candidate.entityOverrides,
    queryOverrides: candidate.queryOverrides,
    forcedScreenId: candidate.forcedScreenId,
    forcedOverlayId: candidate.forcedOverlayId
  };
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
    case "preview": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const scenarioId = typeof body?.scenarioId === "string" ? String(body.scenarioId) : undefined;
      const displayProfileId = String(
        body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const adHocScenario = buildScenario(project, body?.scenario);
      const augmentedProject = adHocScenario
        ? { ...project, scenarios: [...project.scenarios.filter((entry) => entry.id !== adHocScenario.id), adHocScenario] }
        : project;
      const previewData = requiredRenderData(body);
      const rendered = renderLegacyProject(
        augmentedProject,
        displayProfileId,
        previewData.data,
        scenarioId ?? adHocScenario?.id
      );
      process.stdout.write(`${JSON.stringify(renderedResponse(rendered, previewData.message))}\n`);
      return;
    }
    case "layout-preview": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const layoutId = String(body?.layoutId ?? "");
      const popupLayoutId = typeof body?.popupLayoutId === "string" ? String(body.popupLayoutId) : undefined;
      const previewData = requiredRenderData(body);
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
    case "render-project-live": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const displayProfileId = String(
        body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const scenarioId = typeof body?.scenarioId === "string" ? String(body.scenarioId) : undefined;
      const previewData = requiredRenderData(body);
      process.stdout.write(`${JSON.stringify(renderedResponse(renderLegacyProject(project, displayProfileId, previewData.data, scenarioId), previewData.message))}\n`);
      return;
    }
    case "render-assigned-live": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const displayId = String(body?.displayId ?? "");
      const previewData = requiredRenderData(body);
      process.stdout.write(`${JSON.stringify(renderedResponse(renderAssignedDisplay(project, displayId, previewData.data), previewData.message))}\n`);
      return;
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
