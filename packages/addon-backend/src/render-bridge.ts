import {
  BUILT_IN_FONT_OPTIONS,
  DISPLAY_PROFILES,
  registerUserFonts,
  renderAssignedDisplay,
  renderFontSpecimenSheets,
  inspectLayoutDefinition,
  renderLegacyProject,
  renderLayoutDefinition,
} from "../../render-core/src/index.js";
import { renderThemePreviewImage } from "../../render-core/src/theme-preview.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import type { FontOption, Project, RenderData, Scenario } from "../../render-core/src/types.js";
import { rgbaToPngBuffer } from "./png.js";
import { installRustTextLayoutAdapter } from "./rust-text-engine.js";
import { installProjectScriptingRuntime } from "./script-runtime.js";

type BridgeRequest =
  | { op: "preview"; projectId: string; body?: unknown }
  | { op: "layout-preview"; projectId: string; body?: unknown }
  | { op: "layout-inspection-preview"; projectId: string; body?: unknown }
  | { op: "device-preview"; projectId: string; body?: unknown }
  | { op: "font-specimens"; projectId: string; body?: unknown }
  | { op: "theme-preview"; projectId: string; body?: unknown }
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

function providedFontOptions(body: unknown): FontOption[] | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const candidate = (body as { fonts?: unknown }).fonts;
  if (!Array.isArray(candidate)) {
    return undefined;
  }
  return candidate as FontOption[];
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
    case "layout-inspection-preview": {
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
      process.stdout.write(
        `${JSON.stringify(
          inspectLayoutDefinition(
            project,
            layout,
            previewData.data,
            popup,
            undefined,
            Boolean(body?.expandCompoundRefs)
          )
        )}\n`
      );
      return;
    }
    case "device-preview": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const displayId = String(body?.displayId ?? "");
      const previewData = requiredRenderData(body);
      process.stdout.write(`${JSON.stringify(renderedResponse(renderAssignedDisplay(project, displayId, previewData.data), previewData.message))}\n`);
      return;
    }
    case "font-specimens": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const displayProfileId = String(
        body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const profile = DISPLAY_PROFILES.find((candidate) => candidate.id === displayProfileId) ?? DISPLAY_PROFILES[0];
      const sampleText = String(body?.sampleText ?? "Ag 09:45 bdpq RH 21.5C");
      const minSize = Math.max(4, Number(body?.minSize ?? 4));
      const maxSize = Math.min(36, Number(body?.maxSize ?? 36));
      const familyId = typeof body?.familyId === "string" ? String(body.familyId) : "";
      const fonts = (providedFontOptions(body) ?? BUILT_IN_FONT_OPTIONS)
        .filter((entry) => !familyId || entry.id === familyId);
      const families = renderFontSpecimenSheets(
        profile,
        project,
        sampleText,
        minSize,
        maxSize,
        fonts,
        Boolean(body?.includeAllSizes)
      ).map((family) => ({
        family: family.family,
        label: family.label,
        source: family.source,
        allowedPixelSizes: family.allowedPixelSizes,
        importSource: fonts.find((entry) => entry.id === family.family)?.importSource,
        sourceUrl: fonts.find((entry) => entry.id === family.family)?.sourceUrl,
        previewUrl: fonts.find((entry) => entry.id === family.family)?.previewUrl,
        declaredPixelSize: fonts.find((entry) => entry.id === family.family)?.declaredPixelSize,
        licenseCategory: fonts.find((entry) => entry.id === family.family)?.licenseCategory,
        variants: family.variants.map((variant) => ({
          weight: variant.weight,
          slope: variant.slope,
          variantKey: variant.variantKey,
          tiles: variant.tiles.map((tile) => ({
            size: tile.size,
            width: tile.width,
            height: tile.height,
            pngBase64: rgbaToPngBuffer(tile.width, tile.height, tile.rgba).toString("base64")
          }))
        }))
      }));
      process.stdout.write(`${JSON.stringify({ families })}\n`);
      return;
    }
    case "theme-preview": {
      const project = projectFromRequest(request.projectId, request.body);
      const body = request.body as Record<string, unknown> | undefined;
      const themeId = String(body?.themeId ?? "");
      const displayTypeId = String(body?.displayTypeId ?? project.displayTypes?.[0]?.id ?? "");
      const theme = project.themes.find((entry) => entry.id === themeId);
      const displayType = project.displayTypes?.find((entry) => entry.id === displayTypeId);
      if (!theme || !displayType) {
        throw new Error("Unknown theme preview target");
      }
      const rendered = renderThemePreviewImage(theme, displayType, project.fontPresets);
      process.stdout.write(
        `${JSON.stringify({
          width: rendered.width,
          height: rendered.height,
          hash: `theme:${theme.id}:${displayType.id}`,
          activeScreenId: `theme-preview:${theme.id}`,
          dataSourceMessage: "Theme preview",
          rgba: Array.from(rendered.rgba)
        })}\n`
      );
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
