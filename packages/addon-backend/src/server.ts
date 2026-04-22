import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkit from "fontkit";
import {
  BUILT_IN_FONT_OPTIONS,
  DISPLAY_PROFILES,
  ICON_DEFINITIONS,
  SAMPLE_PROJECT,
  registerUserFonts,
  renderAssignedDisplay,
  renderFontSpecimenSheets,
  inspectLayoutDefinition,
  renderLayoutDefinition,
  renderProject
} from "../../render-core/src/index.js";
import { renderThemePreviewImage } from "../../render-core/src/theme-preview.js";
import { emptyQueryResult } from "../../render-core/src/resolve.js";
import { SAMPLE_DATA } from "../../render-core/src/sample-project.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import type {
  FontVariantKey,
  HomeAssistantConnectionSettings,
  OpenEpaperLinkAccessPointSettings,
  PreviewDataSource,
  Project,
  RenderData,
  Scenario
} from "../../render-core/src/types.js";
import { fetchDaFontPage, importDaFontFont } from "./dafont.js";
import { HomeAssistantClient } from "./home-assistant.js";
import { rgbaToJpegBuffer } from "./jpeg.js";
import { OpenEpaperLinkAccessPointClient } from "./openepaperlink.js";
import { NoopPublisher } from "./publisher.js";
import { rgbaToPngBuffer } from "./png.js";
import { RenderRuntime } from "./runtime.js";
import { ProjectStorage } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../../..");
const storage = new ProjectStorage(path.join(rootDir, "data"));
const homeAssistantClient = new HomeAssistantClient();
const openEpaperLinkClient = new OpenEpaperLinkAccessPointClient();
const runtime = new RenderRuntime(new NoopPublisher());

function slugifyFontId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function detectFontVariant(subfamilyName: string | undefined): FontVariantKey {
  const value = subfamilyName ?? "";
  const bold = /bold/i.test(value);
  const italic = /(italic|oblique)/i.test(value);
  if (bold && italic) {
    return "boldItalic";
  }
  if (bold) {
    return "bold";
  }
  if (italic) {
    return "italic";
  }
  return "regular";
}

async function refreshRegisteredFonts(): Promise<void> {
  registerUserFonts(await storage.loadUserFontData());
}

function editorDistPath(): string {
  return path.join(rootDir, "dist", "editor-ui");
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

async function resolvePreviewData(
  project: Project,
  settings: HomeAssistantConnectionSettings,
  requestedSource: PreviewDataSource | undefined
): Promise<{ data: RenderData; source: PreviewDataSource; message?: string }> {
  const unavailableData: RenderData = {
    now: new Date().toISOString(),
    entities: {},
    queries: Object.fromEntries(project.queries.map((query) => [query.id, emptyQueryResult(query.kind)]))
  };
  if (requestedSource === "sample") {
    return {
      data: SAMPLE_DATA,
      source: "sample",
      message: "Sample preview selected"
    };
  }

  if (!homeAssistantClient.hasConfiguredConnection(settings)) {
    return {
      data: unavailableData,
      source: "live",
      message: "Live HA unavailable. Configure and save Home Assistant settings."
    };
  }

  try {
    return {
      data: await homeAssistantClient.resolveProjectData(project, settings),
      source: "live"
    };
  } catch (error) {
    return {
      data: unavailableData,
      source: "live",
      message: error instanceof Error ? `Live HA failed. ${error.message}` : "Live HA failed. Using unknown state."
    };
  }
}

async function createApp() {
  await storage.ensureSeeded();

  const app = express();
  app.use(express.json({ limit: "16mb" }));

  app.get("/api/display-profiles", (_request, response) => {
    response.json(DISPLAY_PROFILES);
  });

  app.get("/api/icons", (_request, response) => {
    response.json(ICON_DEFINITIONS);
  });

  app.get("/api/fonts", async (_request, response, next) => {
    try {
      const userFonts = await storage.listFontOptions();
      response.json(userFonts.length ? userFonts : BUILT_IN_FONT_OPTIONS);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fonts/import", async (request, response, next) => {
    try {
      const filename = String(request.body?.filename ?? "font.ttf");
      const base64 = String(request.body?.base64 ?? "");
      const buffer = Buffer.from(base64, "base64");
      const font = fontkit.create(buffer) as unknown as {
        familyName?: string;
        subfamilyName?: string;
      };
      const label = font.familyName ?? filename.replace(/\.(ttf|otf|woff2?)$/i, "");
      const fontId = slugifyFontId(label);
      const variant = detectFontVariant(font.subfamilyName);
      const storedFilename = `${fontId}-${variant}${path.extname(filename) || ".ttf"}`;
      await storage.saveStoredFont(fontId, label, variant, storedFilename, buffer);
      await refreshRegisteredFonts();
      response.status(201).json({
        id: fontId,
        label,
        variant
      });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/fonts/:id", async (request, response, next) => {
    try {
      await storage.deleteStoredFont(String(request.params.id));
      await refreshRegisteredFonts();
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/fonts/rescan", async (_request, response, next) => {
    try {
      await storage.rebuildStoredFontIndex();
      await refreshRegisteredFonts();
      const userFonts = await storage.listFontOptions();
      response.json(userFonts.length ? userFonts : BUILT_IN_FONT_OPTIONS);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/fonts/:id", async (request, response, next) => {
    try {
      const allowedPixelSizes = Array.isArray(request.body?.allowedPixelSizes)
        ? request.body.allowedPixelSizes
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isInteger(value) && value >= 4 && value <= 200)
            .sort((left: number, right: number) => left - right)
        : undefined;
      await storage.updateStoredFontMetadata(String(request.params.id), { allowedPixelSizes });
      await refreshRegisteredFonts();
      const userFonts = await storage.listFontOptions();
      response.json(userFonts.find((font) => font.id === request.params.id) ?? null);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dafont", async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.query.page ?? 1) || 1);
      response.json(await fetchDaFontPage(page));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/dafont/import", async (request, response, next) => {
    try {
      const imported = await importDaFontFont(storage, {
        name: String(request.body?.name ?? ""),
        detailUrl: String(request.body?.detailUrl ?? ""),
        downloadUrl: String(request.body?.downloadUrl ?? ""),
        previewUrl: String(request.body?.previewUrl ?? ""),
        pixelSize:
          typeof request.body?.pixelSize === "number" && Number.isFinite(request.body.pixelSize)
            ? request.body.pixelSize
            : undefined,
        licenseCategory:
          typeof request.body?.licenseCategory === "string" ? request.body.licenseCategory : undefined
      });
      await refreshRegisteredFonts();
      response.status(201).json(imported);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/home-assistant/entities", async (_request, response, next) => {
    try {
      const settings = await storage.getHomeAssistantSettings();
      response.json(await homeAssistantClient.listEntities(settings).catch(() => []));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings/home-assistant", async (_request, response, next) => {
    try {
      const settings = await storage.getHomeAssistantSettings();
      response.json({
        ...settings,
        token: settings.token ? "********" : "",
        hasToken: Boolean(settings.token)
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings/home-assistant", async (request, response, next) => {
    try {
      const current = await storage.getHomeAssistantSettings();
      const incoming = request.body as Partial<HomeAssistantConnectionSettings> & { token?: string; replaceToken?: boolean };
      const nextSettings: HomeAssistantConnectionSettings = {
        host: String(incoming.host ?? current.host ?? ""),
        token:
          incoming.replaceToken || !current.token
            ? String(incoming.token ?? "")
            : current.token,
        mode: incoming.mode === "supervisor" ? "supervisor" : "custom",
        useSupervisorProxy: Boolean(incoming.useSupervisorProxy),
        allowInsecureTls: Boolean(incoming.allowInsecureTls)
      };
      const saved = await storage.saveHomeAssistantSettings(nextSettings);
      response.json({
        ...saved,
        token: saved.token ? "********" : "",
        hasToken: Boolean(saved.token)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/home-assistant/test", async (request, response, next) => {
    try {
      const current = await storage.getHomeAssistantSettings();
      const incoming = request.body as Partial<HomeAssistantConnectionSettings> & { token?: string; replaceToken?: boolean };
      const settings: HomeAssistantConnectionSettings = {
        host: String(incoming.host ?? current.host ?? ""),
        token:
          incoming.replaceToken || !current.token
            ? String(incoming.token ?? "")
            : current.token,
        mode: incoming.mode === "supervisor" ? "supervisor" : "custom",
        useSupervisorProxy: Boolean(incoming.useSupervisorProxy),
        allowInsecureTls: Boolean(incoming.allowInsecureTls)
      };
      response.json(await homeAssistantClient.testConnection(settings));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings/openepaperlink-access-point", async (_request, response, next) => {
    try {
      response.json(await storage.getOpenEpaperLinkAccessPointSettings());
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings/openepaperlink-access-point", async (request, response, next) => {
    try {
      const current = await storage.getOpenEpaperLinkAccessPointSettings();
      const incoming = request.body as Partial<OpenEpaperLinkAccessPointSettings>;
      response.json(
        await storage.saveOpenEpaperLinkAccessPointSettings({
          url: String(incoming.url ?? current.url ?? ""),
          defaultTestDisplayMac: String(incoming.defaultTestDisplayMac ?? current.defaultTestDisplayMac ?? "")
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settings/openepaperlink-access-point/test", async (request, response, next) => {
    try {
      const current = await storage.getOpenEpaperLinkAccessPointSettings();
      const incoming = request.body as Partial<OpenEpaperLinkAccessPointSettings>;
      response.json(
        await openEpaperLinkClient.testConnection({
          url: String(incoming.url ?? current.url ?? "")
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects", async (_request, response, next) => {
    try {
      response.json(await storage.listProjects());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id", async (request, response, next) => {
    try {
      response.json(await storage.getProject(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/displays/discover", async (request, response, next) => {
    try {
      const [haSettings, apSettings] = await Promise.all([
        storage.getHomeAssistantSettings(),
        storage.getOpenEpaperLinkAccessPointSettings()
      ]);
      const [haDisplays, apDisplays] = await Promise.all([
        homeAssistantClient.discoverOpenEpaperDisplays(haSettings).catch(() => []),
        openEpaperLinkClient.discoverDisplays(apSettings).catch(() => [])
      ]);
      response.json([...apDisplays, ...haDisplays]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects", async (request, response, next) => {
    try {
      const project = (request.body as Project | undefined) ?? SAMPLE_PROJECT;
      response.status(201).json(await storage.saveProject(project));
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/projects/:id", async (request, response, next) => {
    try {
      const project = request.body as Project;
      if (project.id !== request.params.id) {
        response.status(400).json({ error: "Project id mismatch" });
        return;
      }
      response.json(await storage.saveProject(project));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/projects/:id/live-data", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = await storage.getProject(request.params.id);
      const settings = await storage.getHomeAssistantSettings();
      const baseData = await homeAssistantClient.resolveProjectData(project, settings);
      response.json(baseData);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/preview", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const scenarioId =
        typeof request.body?.scenarioId === "string" ? String(request.body.scenarioId) : undefined;
      const displayProfileId = String(
        request.body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const adHocScenario = buildScenario(project, request.body?.scenario);
      const augmentedProject = adHocScenario
        ? { ...project, scenarios: [...project.scenarios.filter((entry) => entry.id !== adHocScenario.id), adHocScenario] }
        : project;
      const settings = await storage.getHomeAssistantSettings();
      const requestedSource =
        request.body?.previewDataSource === "sample" ? "sample" : "live";
      const previewData = await resolvePreviewData(augmentedProject, settings, requestedSource);
      const rendered = renderProject(
        augmentedProject,
        displayProfileId,
        previewData.data,
        scenarioId ?? adHocScenario?.id
      );
      response.json({
        width: rendered.width,
        height: rendered.height,
        hash: rendered.hash,
        activeScreenId: rendered.activeScreenId,
        activeOverlayId: rendered.activeOverlayId,
        dataSource: previewData.source,
        dataSourceMessage: previewData.message,
        rgba: Array.from(rendered.rgba)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/layout-preview", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const layoutId = String(request.body?.layoutId ?? "");
      const popupLayoutId = typeof request.body?.popupLayoutId === "string" ? String(request.body.popupLayoutId) : undefined;
      const settings = await storage.getHomeAssistantSettings();
      const requestedSource = request.body?.previewDataSource === "sample" ? "sample" : "live";
      const previewData = await resolvePreviewData(project, settings, requestedSource);
      const layout = project.layoutDefinitions?.find((entry) => entry.id === layoutId);
      const popup = popupLayoutId ? project.layoutDefinitions?.find((entry) => entry.id === popupLayoutId) : undefined;
      if (!layout) {
        response.status(404).json({ error: `Unknown layout ${layoutId}` });
        return;
      }
      const rendered = renderLayoutDefinition(project, layout, previewData.data, popup);
      response.json({
        width: rendered.width,
        height: rendered.height,
        hash: rendered.hash,
        activeScreenId: rendered.activeScreenId,
        activeOverlayId: rendered.activeOverlayId,
        dataSource: previewData.source,
        dataSourceMessage: previewData.message,
        rgba: Array.from(rendered.rgba)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/layout-inspection-preview", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const layoutId = String(request.body?.layoutId ?? "");
      const popupLayoutId = typeof request.body?.popupLayoutId === "string" ? String(request.body.popupLayoutId) : undefined;
      const settings = await storage.getHomeAssistantSettings();
      const requestedSource = request.body?.previewDataSource === "sample" ? "sample" : "live";
      const previewData = await resolvePreviewData(project, settings, requestedSource);
      const layout = project.layoutDefinitions?.find((entry) => entry.id === layoutId);
      const popup = popupLayoutId ? project.layoutDefinitions?.find((entry) => entry.id === popupLayoutId) : undefined;
      if (!layout) {
        response.status(404).json({ error: `Unknown layout ${layoutId}` });
        return;
      }
      response.json(
        inspectLayoutDefinition(
          project,
          layout,
          previewData.data,
          popup,
          undefined,
          Boolean(request.body?.expandCompoundRefs)
        )
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/device-preview", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const displayId = String(request.body?.displayId ?? "");
      const settings = await storage.getHomeAssistantSettings();
      const requestedSource = request.body?.previewDataSource === "sample" ? "sample" : "live";
      const previewData = await resolvePreviewData(project, settings, requestedSource);
      const rendered = renderAssignedDisplay(project, displayId, previewData.data);
      response.json({
        width: rendered.width,
        height: rendered.height,
        hash: rendered.hash,
        activeScreenId: rendered.activeScreenId,
        activeOverlayId: rendered.activeOverlayId,
        dataSource: previewData.source,
        dataSourceMessage: previewData.message,
        rgba: Array.from(rendered.rgba)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/font-specimens", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const displayProfileId = String(
        request.body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const profile =
        DISPLAY_PROFILES.find((candidate) => candidate.id === displayProfileId) ?? DISPLAY_PROFILES[0];
      const sampleText = String(request.body?.sampleText ?? "Ag 09:45 bdpq RH 21.5C");
      const minSize = Math.max(4, Number(request.body?.minSize ?? 4));
      const maxSize = Math.min(36, Number(request.body?.maxSize ?? 36));
      const familyId = typeof request.body?.familyId === "string" ? String(request.body.familyId) : "";
      const userFonts = await storage.listFontOptions();
      const fonts = (userFonts.length ? userFonts : BUILT_IN_FONT_OPTIONS)
        .filter((entry) => !familyId || entry.id === familyId);
      const families = renderFontSpecimenSheets(
        profile,
        project,
        sampleText,
        minSize,
        maxSize,
        fonts,
        Boolean(request.body?.includeAllSizes)
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
      response.json({ families });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/theme-preview", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const themeId = String(request.body?.themeId ?? "");
      const displayTypeId = String(request.body?.displayTypeId ?? project.displayTypes?.[0]?.id ?? "");
      const theme = project.themes.find((entry) => entry.id === themeId);
      const displayType = project.displayTypes?.find((entry) => entry.id === displayTypeId);
      if (!theme || !displayType) {
        response.status(404).json({ error: "Unknown theme preview target" });
        return;
      }
      const rendered = renderThemePreviewImage(theme, displayType, project.fontPresets);
      response.json({
        width: rendered.width,
        height: rendered.height,
        hash: `theme:${theme.id}:${displayType.id}`,
        activeScreenId: `theme-preview:${theme.id}`,
        dataSource: "sample",
        dataSourceMessage: "Theme preview",
        rgba: Array.from(rendered.rgba)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/publish", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = await storage.getProject(request.params.id);
      const displayProfileId = String(
        request.body?.displayProfileId ?? project.screens.find((screen) => screen.default)?.displayProfileId ?? "tri296x128-red"
      );
      const scenarioId =
        typeof request.body?.scenarioId === "string" ? String(request.body.scenarioId) : undefined;
      const settings = await storage.getHomeAssistantSettings();
      const baseData = await homeAssistantClient.resolveProjectData(project, settings);
      const result = await runtime.publishIfChanged(project, displayProfileId, baseData, scenarioId);
      response.json({
        published: result.published,
        hash: result.hash,
        activeScreenId: result.activeScreenId,
        activeOverlayId: result.activeOverlayId,
        pngBase64: result.png.toString("base64")
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/projects/:id/devices/:displayId/upload", async (request, response, next) => {
    try {
      await refreshRegisteredFonts();
      const project = buildProjectOverride(request.params.id, request.body) ?? (await storage.getProject(request.params.id));
      const displayId = String(request.params.displayId);
      const display = project.devices?.find((entry) => entry.id === displayId);
      if (!display) {
        response.status(404).json({ error: `Unknown display ${displayId}` });
        return;
      }
      if (display.providerKind !== "openepaperlink-ap") {
        response.status(400).json({ error: "Display is not managed by an OpenEPaperLink access point" });
        return;
      }
      const [haSettings, apSettings] = await Promise.all([
        storage.getHomeAssistantSettings(),
        storage.getOpenEpaperLinkAccessPointSettings()
      ]);
      if (!openEpaperLinkClient.hasConfiguredConnection(apSettings)) {
        response.status(400).json({ error: "OpenEPaperLink access point URL is not configured" });
        return;
      }
      const requestedSource =
        request.body?.previewDataSource === "sample" ? "sample" : "live";
      const previewData = await resolvePreviewData(project, haSettings, requestedSource);
      const rendered = renderAssignedDisplay(project, displayId, previewData.data);
      const jpeg = await rgbaToJpegBuffer(rendered.width, rendered.height, rendered.rgba);
      await openEpaperLinkClient.uploadImage(
        apSettings,
        String(display.metadata?.mac ?? display.providerRef),
        jpeg,
        `${display.providerRef}.jpg`
      );
      response.json({
        uploaded: true,
        hash: rendered.hash,
        width: rendered.width,
        height: rendered.height,
        dataSource: previewData.source,
        dataSourceMessage: previewData.message
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/openepaperlink-access-point/upload-preview", async (request, response, next) => {
    try {
      const apSettings = await storage.getOpenEpaperLinkAccessPointSettings();
      if (!openEpaperLinkClient.hasConfiguredConnection(apSettings)) {
        response.status(400).json({ error: "OpenEPaperLink access point URL is not configured" });
        return;
      }
      const mac = String(request.body?.mac ?? "");
      const width = Number(request.body?.width ?? 0);
      const height = Number(request.body?.height ?? 0);
      const rgba = Array.isArray(request.body?.rgba) ? request.body.rgba : [];
      const dither = Number(request.body?.dither ?? 0);
      if (!mac || !width || !height || rgba.length !== width * height * 4) {
        response.status(400).json({ error: "Invalid preview payload" });
        return;
      }
      const jpeg = await rgbaToJpegBuffer(width, height, new Uint8ClampedArray(rgba));
      void dither;
      await openEpaperLinkClient.uploadImage(apSettings, mac, jpeg, `${mac}.jpg`);
      response.json({
        uploaded: true,
        mac,
        width,
        height
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/assets", express.static(editorDistPath()));
  app.use(express.static(editorDistPath()));

  app.get("*", (_request, response) => {
    response.sendFile(path.join(editorDistPath(), "index.html"));
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error"
    });
  });

  return app;
}

const port = Number(process.env.PORT ?? process.env.INGRESS_PORT ?? 8099);

createApp()
  .then((app) => {
    app.listen(port, () => {
      console.log(`OpenEPaperLink editor listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
