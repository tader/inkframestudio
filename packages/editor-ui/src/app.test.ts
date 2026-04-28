// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PROJECT } from "../../render-core/src/sample-project.js";
import { normalizeProject } from "../../render-core/src/themes.js";
import "./app.js";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickButton(root: ShadowRoot, label: string): void {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.textContent?.trim() === label);
  expect(button, `button ${label}`).toBeTruthy();
  button?.click();
}

function inputInLabel<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
  root: ShadowRoot,
  labelText: string,
  selector: string
): T {
  const label = Array.from(root.querySelectorAll("label")).find((entry) => entry.textContent?.includes(labelText));
  const input = label?.querySelector<T>(selector);
  expect(input, `${labelText} ${selector}`).toBeTruthy();
  return input as T;
}

function inspectorLabelTexts(root: ShadowRoot): string[] {
  const panel = root.querySelector(".inspector-panel");
  return Array.from(panel?.querySelectorAll("label") ?? []).map((label) => label.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

function setInputValue(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

type TestLayoutNode = {
  id: string;
  type: string;
  queryKind?: string;
  variableName?: string;
  sourceProviderInstanceId?: string;
  entityIds?: string[];
  forecastDays?: number;
  primitiveType?: string;
  source?: string;
  outputMode?: string;
  children?: TestLayoutNode[];
  child?: TestLayoutNode;
  thenChild?: TestLayoutNode;
  elseChild?: TestLayoutNode;
  width?: Record<string, unknown>;
  height?: Record<string, unknown>;
  style?: Record<string, unknown>;
  bindings?: Record<string, unknown>;
  props?: Record<string, unknown>;
};

type TestWidgetDefinition = {
  id: string;
  name: string;
  rootNode?: TestLayoutNode;
};

type TestEditorElement = HTMLElement & {
  project: { widgetDefinitions?: TestWidgetDefinition[] };
  selectedWidgetDefinitionId: string;
  selectedNodeId: string;
  selectNode: (nodeId: string) => void;
  setRootNode: (owner: TestWidgetDefinition, rootNode: TestLayoutNode) => void;
  createChildNode: (owner: TestWidgetDefinition, parentId: string, kind: string) => void;
  requestUpdate: () => void;
};

describe("epaper editor app", () => {
  const originalFetch = globalThis.fetch;
  const TINY_PNG =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9BUNFygAAAABJRU5ErkJggg==";

  beforeEach(() => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/display-profiles")) {
        return new Response(JSON.stringify([{
          id: "tri296x128-red",
          width: 296,
          height: 128,
          rotation: 0,
          contentPadding: { top: 4, right: 4, bottom: 4, left: 4 },
          gridUnitPx: 8,
          recommendedFontScale: 2,
          palette: { bg: "#ffffff", fg: "#111111", accent: "#d7261b" }
        }]), { status: 200 });
      }
      if (url.endsWith("/api/v2/icons")) {
        return new Response(JSON.stringify([{ id: "fa-solid:triangle-exclamation", label: "Triangle Exclamation", pack: "solid", keywords: ["warning"] }]), { status: 200 });
      }
      if (url.endsWith("/api/v2/provider-kinds")) {
        return new Response(JSON.stringify({
          providerKinds: [
            {
              id: "home-assistant",
              label: "Home Assistant",
              domain: "source",
              capabilities: ["test_connection", "entity_catalog", "entity_states", "calendar_events", "meta_calendar_events"],
              configFields: [
                { key: "mode", label: "Mode", kind: "select", options: [{ value: "custom", label: "Custom host" }, { value: "supervisor", label: "Use local HA" }], defaultValue: "custom" },
                { key: "host", label: "Host", kind: "text", defaultValue: "" },
                { key: "useSupervisorProxy", label: "Use Supervisor proxy", kind: "checkbox", defaultValue: false },
                { key: "allowInsecureTls", label: "Allow insecure TLS", kind: "checkbox", defaultValue: false },
                { key: "token", label: "Token", kind: "password", defaultValue: "" }
              ]
            },
            {
              id: "open-meteo",
              label: "Open-Meteo",
              domain: "source",
              capabilities: ["test_connection", "entity_catalog", "place_search", "resolve_render_data", "generic_data_queries", "weather_forecast"],
              configFields: [
                { key: "defaultLatitude", label: "Default latitude", kind: "text", defaultValue: "" },
                { key: "defaultLongitude", label: "Default longitude", kind: "text", defaultValue: "" },
                { key: "timezone", label: "Timezone", kind: "text", defaultValue: "auto" },
                { key: "currentVariables", label: "Current variables", kind: "text", defaultValue: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,rain" },
                { key: "hourlyVariables", label: "Hourly variables", kind: "text", defaultValue: "temperature_2m,weather_code,precipitation_probability,precipitation,rain,wind_speed_10m,wind_direction_10m" },
                { key: "dailyVariables", label: "Daily variables", kind: "text", defaultValue: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max" },
                { key: "placesJson", label: "Places JSON", kind: "textarea", defaultValue: "[]" }
              ]
            },
            {
              id: "openepaperlink-ap",
              label: "OpenEPaperLink Access Point",
              domain: "display",
              capabilities: ["test_connection", "discover_displays", "upload_preview"],
              configFields: [
                { key: "url", label: "URL", kind: "text", defaultValue: "" },
                { key: "defaultTestDisplayMac", label: "Default test display", kind: "text", defaultValue: "" }
              ]
            },
            {
              id: "virtual",
              label: "Virtual Display",
              domain: "display",
              capabilities: ["virtual"]
            }
          ]
        }), { status: 200 });
      }
      if (url.endsWith("/api/v2/provider-instances")) {
        return new Response(JSON.stringify([
          {
            id: "home-assistant-default",
            providerId: "home-assistant",
            name: "Home Assistant",
            enabled: true,
            config: {
              host: "",
              token: "",
              mode: "custom",
              useSupervisorProxy: false,
              allowInsecureTls: false
            }
          },
          {
            id: "openepaperlink-ap-default",
            providerId: "openepaperlink-ap",
            name: "OpenEPaperLink Access Point",
            enabled: true,
            config: {
              url: "http://192.168.1.170",
              defaultTestDisplayMac: "00000219BC483B18"
            }
          },
          {
            id: "open-meteo-default",
            providerId: "open-meteo",
            name: "Open-Meteo",
            enabled: true,
            config: {
              defaultLatitude: "",
              defaultLongitude: "",
              timezone: "auto",
              currentVariables: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,rain",
              hourlyVariables: "temperature_2m,weather_code,precipitation_probability,precipitation,rain,wind_speed_10m,wind_direction_10m",
              dailyVariables: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,precipitation_probability_max",
              placesJson: "[]"
            }
          },
          {
            id: "virtual-default",
            providerId: "virtual",
            name: "Virtual Display",
            enabled: true,
            config: {
              virtualDisplays: [
                { id: "desk-preview", name: "Desk Preview", displayTypeId: "tri296x128-red" }
              ]
            }
          }
        ]), { status: 200 });
      }
      if (url.includes("/api/v2/provider-instances/") && url.includes("/places")) {
        return new Response(JSON.stringify([{
          id: "den-hoorn",
          name: "Den Hoorn",
          displayName: "Den Hoorn, Zuid-Holland, Netherlands",
          latitude: 52.002,
          longitude: 4.331,
          timezone: "Europe/Amsterdam",
          country: "Netherlands",
          admin1: "Zuid-Holland"
        }]), { status: 200 });
      }
      if (url.endsWith("/api/v2/fonts")) {
        return new Response(JSON.stringify([{ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }]), { status: 200 });
      }
      if (url.endsWith("/api/v2/fonts/rescan")) {
        return new Response(JSON.stringify([{ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }]), { status: 200 });
      }
      if (url.includes("/api/v2/fonts/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/font-specimens`)) {
        return new Response(JSON.stringify({
          families: [{
            family: "user-sans",
            label: "User Sans",
            source: "user",
            importSource: "upload",
            allowedPixelSizes: [8, 10, 12],
            variants: [{
              weight: "regular",
              slope: "roman",
              variantKey: "regular",
              tiles: [
                { size: 8, width: 120, height: 18, pngBase64: "ZmFrZQ==" },
                { size: 10, width: 140, height: 22, pngBase64: "ZmFrZQ==" }
              ]
            }]
          }]
        }), { status: 200 });
      }
      if (url.endsWith("/api/v2/provider-instances/home-assistant-default/entities")) {
        return new Response(
          JSON.stringify([
            { entityId: "calendar.family", friendlyName: "Family Calendar", domain: "calendar" },
            { entityId: "sensor.temp", friendlyName: "Temp", domain: "sensor", unit: "C" }
          ]),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v2/schedule-update-log-settings")) {
        return new Response(JSON.stringify({ retentionDays: 7 }), { status: 200 });
      }
      if (url.endsWith("/api/v2/backup") && !init?.method) {
        return new Response(JSON.stringify({
          version: 1,
          exportedAt: new Date().toISOString(),
          settings: {},
          fontIndex: { fonts: [] },
          fonts: [],
          projects: [{ id: SAMPLE_PROJECT.id, value: SAMPLE_PROJECT }]
        }), { status: 200 });
      }
      if (url.endsWith("/api/v2/backup/restore") && init?.method === "POST") {
        return new Response(String(init.body), { status: 200 });
      }
      if (url.endsWith("/api/v2/projects")) {
        return new Response(JSON.stringify([{ id: SAMPLE_PROJECT.id, name: SAMPLE_PROJECT.name, version: SAMPLE_PROJECT.version }]), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}`) && !init?.method) {
        return new Response(JSON.stringify(SAMPLE_PROJECT), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/live-data`)) {
        return new Response(JSON.stringify({
          now: "2026-04-27T12:00:00+02:00",
          entities: {},
          queries: {},
          metaQueries: {
            "weather-query-under-test": {
              kind: "weather_forecast",
              items: [{ temperature: "16.6", condition: "cloudy" }]
            }
          }
        }), { status: 200 });
      }
      if (url.includes(`/api/v2/projects/${SAMPLE_PROJECT.id}/displays/discover`)) {
        return new Response(JSON.stringify([
          {
            id: "ap:00000219BC483B18",
            name: "Hall Tag",
            providerId: "openepaperlink-ap",
            providerInstanceId: "openepaperlink-ap-default",
            providerDeviceRef: "00000219BC483B18",
            providerKind: "openepaperlink-ap",
            providerRef: "00000219BC483B18",
            discoverySource: "access-point",
              suggestedDisplayType: {
                id: "oel-ap-hw-01-296x128",
                name: "M2 2.9\"",
                width: 296,
                height: 128,
                rotation: 0,
                contentPadding: { top: 4, right: 4, bottom: 4, left: 4 },
                gridUnitPx: 8,
                palette: { bg: "#ffffff", fg: "#000000", accent: "#ff0000" }
              },
            metadata: { mac: "00000219BC483B18" }
          },
          {
            id: "virtual-default:desk-preview",
            name: "Desk Preview",
            providerId: "virtual",
            providerInstanceId: "virtual-default",
            providerDeviceRef: "desk-preview",
            providerKind: "virtual",
            providerRef: "desk-preview",
            suggestedDisplayTypeId: "tri296x128-red",
            discoverySource: "virtual",
            metadata: { virtual: true }
          },
          {
            id: "oel-1",
            name: "HA Hall Tag",
            providerId: "openepaperlink",
            providerInstanceId: "home-assistant-default",
            providerDeviceRef: "device-1",
            providerKind: "openepaperlink",
            providerRef: "device-1",
            discoverySource: "home-assistant",
            metadata: {}
          }
        ]), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/assignment-schedules`)) {
        return new Response(JSON.stringify([{
          assignmentId: "assignment-virtual-tri296x128-red",
          displayId: "virtual-tri296x128-red",
          enabled: false,
          intervalMinutes: 15,
          schedulable: false,
          running: false,
          lastResult: "disabled"
        }]), { status: 200 });
      }
      if (url.includes(`/api/v2/projects/${SAMPLE_PROJECT.id}/displays/`) && url.includes("/update-log")) {
        const now = Date.now();
        return new Response(JSON.stringify([
          {
            timestampMs: now,
            timestamp: new Date(now).toISOString(),
            projectId: SAMPLE_PROJECT.id,
            assignmentId: "assignment-virtual-tri296x128-red",
            displayId: "virtual-tri296x128-red",
            desired: true,
            succeeded: true,
            hash: "log-hash-new",
            width: 296,
            height: 128,
            imagePngBase64: TINY_PNG,
            message: "Scheduled update uploaded."
          },
          {
            timestampMs: now - 60_000,
            timestamp: new Date(now - 60_000).toISOString(),
            projectId: SAMPLE_PROJECT.id,
            assignmentId: "assignment-virtual-tri296x128-red",
            displayId: "virtual-tri296x128-red",
            desired: true,
            succeeded: true,
            hash: "log-hash-old",
            width: 296,
            height: 128,
            imagePngBase64: TINY_PNG,
            message: "Scheduled update uploaded."
          }
        ]), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/assignments/assignment-virtual-tri296x128-red/force-update`)) {
        return new Response(JSON.stringify({
          assignmentId: "assignment-virtual-tri296x128-red",
          displayId: "virtual-tri296x128-red",
          updated: true,
          skipped: false,
          hash: "force-hash",
          message: "Forced update uploaded."
        }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/device-preview`)) {
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          hash: "device-preview",
          activeScreenId: "layout-calendar",
          pngBase64: TINY_PNG
        }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`)) {
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          hash: "layout-preview",
          activeScreenId: "layout-widget",
          pngBase64: TINY_PNG
        }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}`) && init?.method === "PUT") {
        return new Response(JSON.stringify({ ...SAMPLE_PROJECT, version: SAMPLE_PROJECT.version + 1 }), { status: 200 });
      }
      if (url.includes(`/api/v2/projects/${SAMPLE_PROJECT.id}/devices/`) && url.endsWith("/upload")) {
        return new Response(JSON.stringify({
          uploaded: true,
          hash: "uploaded-hash",
          width: 296,
          height: 128
        }), { status: 200 });
      }
      if (url.endsWith("/api/v2/provider-instances/openepaperlink-ap-default/upload-preview")) {
        return new Response(JSON.stringify({
          uploaded: true,
          mac: "00000219BC483B18",
          width: 296,
          height: 128
        }), { status: 200 });
      }
      if (url.endsWith("/api/v2/fonts/import")) {
        return new Response(JSON.stringify({ id: "user-sans", label: "User Sans", variant: "regular" }), { status: 201 });
      }
      if (url.includes("/api/v2/fonts/") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unhandled fetch ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    window.location.hash = "#/displays";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not inject virtual displays into empty projects", () => {
    const project = normalizeProject({
      ...SAMPLE_PROJECT,
      devices: [],
      deviceAssignments: []
    });

    expect(project.devices).toEqual([]);
    expect(project.deviceAssignments).toEqual([]);
  });

  it("keeps fullscreen layout assignments display independent", () => {
    const layoutId = SAMPLE_PROJECT.layoutDefinitions?.find((layout) => layout.kind === "fullscreen")?.id;
    const project = normalizeProject({
      ...SAMPLE_PROJECT,
      devices: [{
        id: "display-large",
        name: "Large",
        providerKind: "virtual",
        providerRef: "large",
        displayTypeId: "large",
        managed: true,
        virtual: true
      }],
      displayTypes: [
        ...(SAMPLE_PROJECT.displayTypes ?? []),
        {
          id: "large",
          name: "Large",
          width: 400,
          height: 300,
          rotation: 0,
          contentPadding: { top: 0, right: 0, bottom: 0, left: 0 },
          gridUnitPx: 8,
          palette: { bg: "#ffffff", fg: "#000000", accent: "#ff0000" }
        }
      ],
      deviceAssignments: [{
        id: "assignment-large",
        displayId: "display-large",
        defaultFullscreenLayoutId: SAMPLE_PROJECT.layoutDefinitions?.find((layout) => layout.kind === "fullscreen")?.id,
        defaultThemeId: SAMPLE_PROJECT.themes[0]?.id,
        schedule: { enabled: true, intervalMinutes: 15 },
        fullscreenRules: [],
        popupRules: []
      }]
    });

    expect(project.deviceAssignments?.[0]?.defaultFullscreenLayoutId).toBe(layoutId);
    expect(project.layoutDefinitions?.some((layout) => "displayTypeId" in layout)).toBe(false);
  });

  it("normalizes invalid display theme assignments to an available theme", () => {
    const project = normalizeProject({
      ...SAMPLE_PROJECT,
      deviceAssignments: (SAMPLE_PROJECT.deviceAssignments ?? []).map((assignment, index) => ({
        ...assignment,
        defaultThemeId: index === 0 ? "missing-theme" : assignment.defaultThemeId
      }))
    });

    expect(project.deviceAssignments?.[0]?.defaultThemeId).toBe(project.themes[0]?.id);
  });

  it("keeps display theme assignment when edited", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const app = element as unknown as {
      project: typeof SAMPLE_PROJECT;
      selectedDisplayId: string;
      requestUpdate: () => void;
    };
    const displayId = app.project.devices?.[0]?.id ?? "";
    app.selectedDisplayId = displayId;
    app.requestUpdate();
    await flush();
    await element.updateComplete;

    const themeSelect = inputInLabel<HTMLSelectElement>(element.shadowRoot, "Theme", "select");
    setSelectValue(themeSelect, "soft-fill");
    await flush();
    await element.updateComplete;

    expect(app.project.deviceAssignments?.find((entry) => entry.displayId === displayId)?.defaultThemeId).toBe("soft-fill");
  });

  it("changes theme font variants atomically", async () => {
    window.location.hash = "#/themes";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const app = element as unknown as {
      fonts: Array<{ id: string; label: string; source: string; variants: string[]; allowedPixelSizes: number[] }>;
      project: typeof SAMPLE_PROJECT;
      selectedThemeId: string;
      requestUpdate: () => void;
    };
    const themeId = app.project.themes[0]?.id ?? "";
    app.fonts = [{ id: "arial", label: "Arial", source: "user", variants: ["regular", "bold"], allowedPixelSizes: [] }];
    app.selectedThemeId = themeId;
    app.project = normalizeProject({
      ...app.project,
      themes: app.project.themes.map((theme) => theme.id === themeId
        ? {
            ...theme,
            fontRoles: {
              ...theme.fontRoles,
              normalEmphasis: { family: "arial", weight: "bold", slope: "roman" }
            }
          }
        : theme)
    });
    app.requestUpdate();
    await flush();
    await element.updateComplete;

    const roleDetails = Array.from(element.shadowRoot.querySelectorAll("details")).find((entry) =>
      entry.querySelector("summary")?.textContent?.includes("normal emphasis font")
    );
    expect(roleDetails).toBeTruthy();
    const variantSelect = Array.from(roleDetails!.querySelectorAll("label")).find((entry) => entry.textContent?.includes("Variant"))?.querySelector("select");
    expect(variantSelect).toBeTruthy();
    setSelectValue(variantSelect as HTMLSelectElement, "regular");
    await flush();
    await element.updateComplete;

    const role = app.project.themes.find((theme) => theme.id === themeId)?.fontRoles?.normalEmphasis;
    expect(role?.weight).toBe("regular");
    expect(role?.slope).toBe("roman");
  });

  it("renders multi-page navigation and defaults to displays", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("InkFrame Studio");
    expect(element.shadowRoot.textContent).toContain("Displays");
    expect(Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).some((button) => button.textContent?.trim() === "Display Types")).toBe(false);
    expect(element.shadowRoot.textContent).not.toContain("Assignments");
    expect(element.shadowRoot.textContent).toContain("Config");
    expect(element.shadowRoot.textContent).toContain("Refresh preview");
  });

  it("switches page using nav and updates hash", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const layoutsButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Layouts");
    layoutsButton?.click();
    await flush();
    await element.updateComplete;

    expect(window.location.hash).toBe("#/layouts");
  });

  it("uses bundled layout preview endpoint on layouts page", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    fetchMock.mockClear();

    const layoutsButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Layouts");
    layoutsButton?.click();
    await flush();
    await element.updateComplete;

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`))).toBe(true);
    expect(urls.some((url) => url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-inspection-preview`))).toBe(false);
  });

  it("discovers and manages openepaperlink displays", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const discoverButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Refresh");
    discoverButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Hall Tag");

    const manageButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Manage device"));
    manageButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Provider-backed device");
    expect(element.shadowRoot.textContent).toContain("Force update now");
  });

  it("marks discovered displays as already managed after import", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const discoverButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Refresh");
    discoverButton?.click();
    await flush();
    await element.updateComplete;

    const manageButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Manage device"));
    manageButton?.click();
    await flush();
    await element.updateComplete;

    discoverButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Already managed");
    expect(element.shadowRoot.textContent).toContain("Hall Tag");
  });

  it("manages virtual displays discovered from display systems", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const manageButtons = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("Manage device"));
    manageButtons[1]?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Desk Preview");
    expect(element.shadowRoot.textContent).toContain("Virtual device");
  });

  it("adds compound widget on widgets page", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("New Compound Widget");
  });

  it("configures compound widget inputs and creates text nodes through the UI", async () => {
    window.location.hash = "#/widgets";
    const fetchMock = vi.mocked(globalThis.fetch);
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const appState = element as unknown as HTMLElement & {
      project: { widgetDefinitions?: Array<{ id: string; name: string; rootNode?: { id: string } }> };
      selectedWidgetDefinitionId: string;
      selectedNodeId: string;
      requestUpdate: () => void;
    };
    const selectedWidget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    appState.selectedNodeId = selectedWidget?.rootNode?.id ?? "";
    appState.requestUpdate();
    await flush();
    await element.updateComplete;
    clickButton(element.shadowRoot, "Create child");
    await flush();
    await element.updateComplete;
    clickButton(element.shadowRoot, "Text");
    await flush();
    await element.updateComplete;
    const widgetWithText = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    const textNodeId = (widgetWithText?.rootNode as { children?: Array<{ id: string }> } | undefined)?.children?.[0]?.id ?? "";
    appState.selectedNodeId = textNodeId;
    appState.requestUpdate();
    await flush();
    await element.updateComplete;
    setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Name", "input"), "Weather Snapshot");
    await flush();
    await element.updateComplete;

    clickButton(element.shadowRoot, "Add input");
    await flush();
    await element.updateComplete;

    const inputDetails = Array.from(element.shadowRoot.querySelectorAll("details")).find((entry) => entry.textContent?.includes("input"));
    inputDetails?.setAttribute("open", "");
    setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Preview value", "input"), "Den Hoorn");
    await flush();
    await element.updateComplete;

    fetchMock.mockClear();
    clickButton(element.shadowRoot, "Save project");
    await flush();
    await element.updateComplete;

    const saveCall = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}`) && init?.method === "PUT");
    expect(saveCall).toBeTruthy();
    const savedProject = JSON.parse(String(saveCall?.[1]?.body ?? "{}"));
    const savedWidget = savedProject.widgetDefinitions.find((entry: { name: string }) => entry.name === "Weather Snapshot");
    expect(savedWidget).toBeTruthy();
    expect(JSON.stringify(savedWidget)).toContain("Den Hoorn");
    expect(savedWidget.rootNode.children[0].type).toBe("primitive_instance");
    expect(savedWidget.rootNode.children[0].primitiveType).toBe("text");
  });

  it("keeps distinct placeholders in if/else text branches", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement;
    const selectedWidget = () => appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    const selectNode = async (nodeId: string) => {
      appState.selectNode(nodeId);
      appState.requestUpdate();
      await flush();
      await element.updateComplete;
    };
    const setPlaceholder = async (value: string) => {
      const input = inputInLabel<HTMLInputElement>(element.shadowRoot, "Placeholder", "input");
      setInputValue(input, value);
      await flush();
      await element.updateComplete;
    };

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const widget = selectedWidget();
    expect(widget?.rootNode?.type).toBe("stack");
    const textNode = (id: string): TestLayoutNode => ({
      id,
      type: "primitive_instance",
      primitiveType: "text",
      width: { mode: "fill" },
      height: { mode: "fill" },
      style: { paddingPx: 4, borderToken: "none" },
      bindings: { entity: "" },
      props: {
        text: "Text",
        autoFit: true,
        placeholderText: "Placeholder",
        horizontalAlign: "left",
        verticalAlign: "top",
        overflow: "wrap",
        renderEntityState: false,
        paddingPx: 4
      }
    });
    if (widget?.rootNode) {
      appState.setRootNode(widget, {
        ...widget.rootNode,
        children: [{
          id: "if-else-under-test",
          type: "if_else",
          thenChild: textNode("then-text-under-test"),
          elseChild: {
            id: "else-stack-under-test",
            type: "stack",
            children: [textNode("else-text-one-under-test"), textNode("else-text-two-under-test")]
          }
        }]
      });
    }
    await flush();
    await element.updateComplete;

    const ifElse = () => selectedWidget()?.rootNode?.children?.[0];
    await selectNode(ifElse()?.thenChild?.id ?? "");
    await setPlaceholder("then branch placeholder");

    const elseStack = () => ifElse()?.elseChild;
    await selectNode(elseStack()?.children?.[0]?.id ?? "");
    await setPlaceholder("else first placeholder");

    await selectNode(elseStack()?.children?.[1]?.id ?? "");
    await setPlaceholder("else second placeholder");

    const finalIfElse = ifElse();
    const thenPlaceholder = finalIfElse?.thenChild?.props?.placeholderText;
    const elsePlaceholders = finalIfElse?.elseChild?.children?.map((node) => node.props?.placeholderText);
    expect(thenPlaceholder).toBe("then branch placeholder");
    expect(elsePlaceholders).toEqual(["else first placeholder", "else second placeholder"]);
    expect(new Set([thenPlaceholder, ...(elsePlaceholders ?? [])]).size).toBe(3);
  });

  it("stores variable bindings for value-backed primitive widgets", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement;
    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const widget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    expect(widget?.rootNode?.type).toBe("stack");
    appState.setRootNode(widget as TestWidgetDefinition, {
      id: "variable-bindings-root",
      type: "stack",
      children: [
        {
          id: "number-variable-node",
          type: "primitive_instance",
          primitiveType: "number",
          bindings: { entity: "", value: "" },
          props: { digits: 1 }
        },
        {
          id: "icon-variable-node",
          type: "primitive_instance",
          primitiveType: "icon",
          bindings: { value: "" },
          props: { icon: "fa-solid:triangle-exclamation" }
        }
      ]
    });
    await flush();
    await element.updateComplete;

    appState.selectNode("number-variable-node");
    appState.requestUpdate();
    await flush();
    await element.updateComplete;
    expect(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Primitive", "select").value).toBe("number");
    setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Value variable", "input"), "weather.current.temperature_2m");
    await flush();
    await element.updateComplete;

    appState.selectNode("icon-variable-node");
    appState.requestUpdate();
    await flush();
    await element.updateComplete;
    expect(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Primitive", "select").value).toBe("icon");
    setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Icon variable", "input"), "weather.current.icon");
    await flush();
    await element.updateComplete;

    const root = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId)?.rootNode;
    expect(root?.children?.[0]?.bindings?.value).toBe("weather.current.temperature_2m");
    expect(root?.children?.[1]?.bindings?.value).toBe("weather.current.icon");
  });

  it("adapts data query controls for calendar, entity, and weather sources", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement;
    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const widget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    expect(widget?.rootNode?.type).toBe("stack");
    appState.createChildNode(widget as TestWidgetDefinition, widget?.rootNode?.id ?? "", "data_query");
    await flush();
    await element.updateComplete;

    const dataQuery = () => appState.project.widgetDefinitions
      ?.find((entry) => entry.id === appState.selectedWidgetDefinitionId)
      ?.rootNode?.children?.find((node) => node.type === "data_query");

    expect(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Query type", "select").value).toBe("calendar_events");
    expect(inspectorLabelTexts(element.shadowRoot).some((text) => text.startsWith("Width "))).toBe(false);
    expect(inspectorLabelTexts(element.shadowRoot).some((text) => text.startsWith("Height "))).toBe(false);
    expect(inspectorLabelTexts(element.shadowRoot).some((text) => text.startsWith("Theme override"))).toBe(false);
    expect(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Source", "select").textContent).toContain("Home Assistant");
    expect(element.shadowRoot.textContent).toContain("Calendar entities");
    expect(element.shadowRoot.textContent).toContain("Family Calendar");
    expect(element.shadowRoot.textContent).not.toContain("Forecast days");

    setSelectValue(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Query type", "select"), "entity_states");
    await flush();
    await element.updateComplete;

    expect(dataQuery()?.queryKind).toBe("entity_states");
    expect(dataQuery()?.sourceProviderInstanceId).toBe("home-assistant-default");
    expect(element.shadowRoot.textContent).toContain("Entities");
    expect(element.shadowRoot.textContent).toContain("Temp");
    expect(element.shadowRoot.textContent).not.toContain("Calendar entities");
    expect(element.shadowRoot.textContent).not.toContain("Forecast days");

    const entitySelect = inputInLabel<HTMLSelectElement>(element.shadowRoot, "Entities", "select");
    Array.from(entitySelect.options).forEach((option) => {
      option.selected = option.value === "sensor.temp";
    });
    entitySelect.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await flush();
    await element.updateComplete;
    expect(dataQuery()?.entityIds).toEqual(["sensor.temp"]);

    setSelectValue(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Query type", "select"), "weather_forecast");
    await flush();
    await element.updateComplete;

    expect(dataQuery()?.queryKind).toBe("weather_forecast");
    expect(dataQuery()?.sourceProviderInstanceId).toBe("open-meteo-default");
    expect(inputInLabel<HTMLSelectElement>(element.shadowRoot, "Source", "select").textContent).toContain("Open-Meteo");
    expect(element.shadowRoot.textContent).toContain("Location id");
    expect(element.shadowRoot.textContent).toContain("Current variables");
    expect(element.shadowRoot.textContent).toContain("Forecast days");
    expect(element.shadowRoot.textContent).not.toContain("Calendar entities");
    expect(element.shadowRoot.textContent).not.toContain("Entities");

    setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Forecast days", "input"), "3");
    await flush();
    await element.updateComplete;
    expect(dataQuery()?.forecastDays).toBe(3);
  });

  it("shows widget preview variables with resolved values", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement & {
      widgetPreviewRenderData: unknown;
      widgetPreviewDefinitionId: string;
    };
    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const widget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    if (widget?.rootNode) {
      appState.setRootNode(widget, {
        ...widget.rootNode,
        children: [{
          id: "weather-query-under-test",
          type: "data_query",
          queryKind: "weather_forecast",
          variableName: "weather",
          sourceProviderInstanceId: "open-meteo-default",
          width: { mode: "fill" },
          height: { mode: "fill" },
          style: { borderToken: "none" },
          child: {
            id: "weather-text-under-test",
            type: "primitive_instance",
            primitiveType: "text",
            width: { mode: "fill" },
            height: { mode: "fill" },
            style: { borderToken: "none" },
            bindings: { entity: "" },
            props: { text: "{{weather |to_json}}", autoFit: true, renderEntityState: false }
          }
        }]
      });
    }
    appState.widgetPreviewRenderData = {
      now: "2026-04-27T12:00:00+02:00",
      entities: {},
      queries: {},
      metaQueries: {
        "weather-query-under-test": {
          kind: "weather_forecast",
          items: [{ temperature: "16.6", condition: "cloudy" }]
        }
      }
    };
    appState.widgetPreviewDefinitionId = widget?.id ?? "";
    appState.requestUpdate();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Preview Variables");
    expect(element.shadowRoot.textContent).toContain("weather");
    expect(element.shadowRoot.textContent).toContain("16.6");
    expect(element.shadowRoot.textContent).toContain("cloudy");
  });

  it("shows script output variables in scope for selected child widgets", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement & {
      widgetPreviewRenderData: unknown;
      widgetPreviewDefinitionId: string;
    };
    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    const widget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    if (widget?.rootNode) {
      appState.setRootNode(widget, {
        ...widget.rootNode,
        children: [{
          id: "script-under-test",
          type: "script",
          source: "return { chart: [1, 2, 3], headline: 'Done' };",
          outputMode: "merge_object",
          bindings: {},
          child: {
            id: "bar-child-under-test",
            type: "primitive_instance",
            primitiveType: "bar_chart",
            bindings: { value: "chart" },
            props: { valueKey: "value" }
          }
        }]
      });
    }
    appState.selectNode("bar-child-under-test");
    appState.widgetPreviewRenderData = { now: "", entities: {}, queries: {}, metaQueries: {} };
    appState.widgetPreviewDefinitionId = widget?.id ?? "";
    appState.requestUpdate();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("chart");
    expect(element.shadowRoot.textContent).toContain("1");
    expect(element.shadowRoot.textContent).toContain("2");
    expect(element.shadowRoot.textContent).toContain("3");
    expect(element.shadowRoot.textContent).toContain("headline");
    expect(element.shadowRoot.textContent).toContain("Done");
  });

  it("keeps widget preview variables scoped to selected widget", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const appState = element as unknown as TestEditorElement & {
      widgetPreviewRenderData: unknown;
      widgetPreviewDefinitionId: string;
    };

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;
    const firstWidget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    if (firstWidget?.rootNode) {
      appState.setRootNode(firstWidget, {
        ...firstWidget.rootNode,
        children: [{
          id: "weather-query-under-test",
          type: "data_query",
          queryKind: "weather_forecast",
          variableName: "weather",
          sourceProviderInstanceId: "open-meteo-default",
          child: { id: "first-text", type: "primitive_instance", primitiveType: "text", props: { text: "first" } }
        }]
      });
    }
    appState.widgetPreviewRenderData = {
      now: "",
      entities: {},
      queries: {},
      metaQueries: {
        "weather-query-under-test": {
          kind: "weather_forecast",
          items: [{ temperature: "16.6" }]
        }
      }
    };
    appState.widgetPreviewDefinitionId = firstWidget?.id ?? "";
    expect(appState.widgetPreviewDefinitionId).toBe(firstWidget?.id);
    appState.requestUpdate();
    await flush();
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain("16.6");

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;
    const secondWidget = appState.project.widgetDefinitions?.find((entry) => entry.id === appState.selectedWidgetDefinitionId);
    expect(secondWidget?.id).not.toBe(firstWidget?.id);
    expect(element.shadowRoot.textContent).toContain("Preview Variables");
    expect(element.shadowRoot.textContent).not.toContain("16.6");
  });

  it("debounces widget preview refresh after property edits", async () => {
    window.location.hash = "#/widgets";
    const fetchMock = vi.mocked(globalThis.fetch);
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"))?.click();
    await flush();
    await element.updateComplete;

    vi.useFakeTimers();
    try {
      fetchMock.mockClear();
      setInputValue(inputInLabel<HTMLInputElement>(element.shadowRoot, "Name", "input"), "Debounced Widget");
      await element.updateComplete;
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`))).toBe(false);

      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`))).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows preview theme selector on widget page", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Preview theme");
  });

  it("adds layout on layouts page", async () => {
    window.location.hash = "#/layouts";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add layout"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("New Layout");
  });

  it("adds theme on themes page", async () => {
    window.location.hash = "#/themes";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add theme"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("New Theme");
    expect(element.shadowRoot.textContent).toContain("Border color");
  });

  it("refreshes preview when choosing a theme", async () => {
    window.location.hash = "#/themes";
    const fetchMock = vi.mocked(globalThis.fetch);
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    fetchMock.mockClear();
    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Soft Fill")
      ?.click();
    await flush();
    await element.updateComplete;

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/theme-preview`))).toBe(true);
  });

  it("adds provider draft on config page", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Sources")
      ?.click();
    await flush();
    await element.updateComplete;

    const initialHeadings = Array.from(element.shadowRoot.querySelectorAll("h2")).filter((heading) =>
      heading.textContent?.trim() === "Home Assistant"
    );
    expect(initialHeadings.length).toBe(1);

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.trim() === "Add Home Assistant"
    );
    addButton?.click();
    await flush();
    await element.updateComplete;

    const updatedHeadings = Array.from(element.shadowRoot.querySelectorAll("h2")).filter((heading) =>
      heading.textContent?.trim() === "Home Assistant"
    );
    expect(updatedHeadings.length).toBe(2);
  });

  it("searches and adds an Open-Meteo place to source provider config", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    clickButton(element.shadowRoot, "Sources");
    await flush();
    await element.updateComplete;

    clickButton(element.shadowRoot, "Add Open-Meteo");
    await flush();
    await element.updateComplete;

    const placeSearch = element.shadowRoot.querySelector<HTMLInputElement>('input[placeholder="Search city or postal code"]');
    expect(placeSearch).toBeTruthy();
    setInputValue(placeSearch as HTMLInputElement, "Den Hoorn");
    clickButton(element.shadowRoot, "Search");
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Den Hoorn, Zuid-Holland, Netherlands");
    clickButton(element.shadowRoot, "Add");
    await flush();
    await element.updateComplete;

    const placesJson = inputInLabel<HTMLTextAreaElement>(element.shadowRoot, "Places JSON", "textarea").value;
    expect(placesJson).toContain('"id": "den-hoorn"');
    expect(placesJson).toContain('"name": "Den Hoorn"');
    expect(placesJson).toContain('"latitude": 52.002');
    expect(placesJson).toContain('"longitude": 4.331');
    expect(placesJson).toContain('"timezone": "Europe/Amsterdam"');
  });

  it("shows display types in config display systems", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Display Systems")
      ?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Display Types");
    expect(element.shadowRoot.textContent).toContain("Add display type");
  });

  it("shows theme preview display type selector", async () => {
    window.location.hash = "#/themes";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Preview display type");
  });

  it("shows assignment editor on displays page and redirects old assignments route", async () => {
    window.location.hash = "#/assignments";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;
    await flush();
    await element.updateComplete;

    expect(window.location.hash).toBe("#/displays");
    expect(element.shadowRoot.textContent).toContain("Assignment");
    expect(element.shadowRoot.textContent).toContain("Fullscreen Rules");
  });

  it("navigates update log images from the modal", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    element.shadowRoot.querySelector<HTMLImageElement>(".update-log-image")?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("log-hash-new");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("log-hash-old");

    const previousButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Previous");
    previousButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("log-hash-new");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.querySelector(".modal")).toBeNull();
  });

  it("shows home assistant and font management on config page", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Sources")
      ?.click();
    await flush();
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain("Home Assistant");

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Display Systems")
      ?.click();
    await flush();
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain("OpenEPaperLink Access Point");
    expect(element.shadowRoot.textContent).toContain("Default test display");

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Fonts")
      ?.click();
    await flush();
    await element.updateComplete;
    expect(element.shadowRoot.textContent).toContain("Fonts");
    expect(element.shadowRoot.textContent).toContain("Rescan font dir");
    expect(element.shadowRoot.textContent).toContain("Delete font");
    expect(element.shadowRoot.textContent).toContain("8px");
  });

  it("adds virtual display definitions in display system config", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Display Systems")
      ?.click();
    await flush();
    await element.updateComplete;

    const addProviderButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Add Virtual Display");
    addProviderButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Virtual Display 1");

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Add virtual display");
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Virtual Display 2");
  });

  it("keeps app usable when home assistant entities fetch fails", async () => {
    const baseFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v2/home-assistant/entities")) {
        return new Response("ha down", { status: 500 });
      }
      return await baseFetch(input, init);
    }) as typeof fetch;

    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Config");
    expect(element.shadowRoot.textContent).toContain("Fonts");
    expect(element.shadowRoot.textContent).toContain("Backup / Restore");
    expect(element.shadowRoot.textContent).toContain("Home Assistant");
  });

  it("shows preview upload selector for matching ap tags", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Send Preview");
    expect(element.shadowRoot.textContent).toContain("Hall Tag");
  });

  it("shows structure editor without node tree for compound widgets", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Structure");
    expect(element.shadowRoot.textContent).not.toContain("Node Tree");
  });

  it("offers meta-node creation controls in the node editor", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    const treeNodeButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "stack");
    treeNodeButton?.click();
    await flush();
    await element.updateComplete;

    const createChildButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Create child");
    createChildButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Data Query");
    expect(element.shadowRoot.textContent).toContain("Foreach");
    expect(element.shadowRoot.textContent).toContain("If/Else");
  });

  it("removes virtual display from displays page", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const countDeleteButtons = () =>
      Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("Delete virtual display")).length;

    const beforeCount = countDeleteButtons();
    const manageButtons = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.textContent?.includes("Manage device"));
    manageButtons[1]?.click();
    await flush();
    await element.updateComplete;

    const deleteButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Delete virtual display"));
    deleteButton?.click();
    await flush();
    await element.updateComplete;

    expect(countDeleteButtons()).toBe(beforeCount);
  });
});
