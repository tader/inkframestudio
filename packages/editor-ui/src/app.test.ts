// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_PROJECT } from "../../render-core/src/sample-project.js";
import "./app.js";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("epaper editor app", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      value: class {
        data: Uint8ClampedArray;
        width: number;
        height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      }
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({
        putImageData: () => {}
      })
    });

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
              capabilities: ["test_connection", "entity_catalog"],
              configFields: [
                { key: "mode", label: "Mode", kind: "select", options: [{ value: "custom", label: "Custom host" }, { value: "supervisor", label: "Use local HA" }], defaultValue: "custom" },
                { key: "host", label: "Host", kind: "text", defaultValue: "" },
                { key: "useSupervisorProxy", label: "Use Supervisor proxy", kind: "checkbox", defaultValue: false },
                { key: "allowInsecureTls", label: "Allow insecure TLS", kind: "checkbox", defaultValue: false },
                { key: "token", label: "Token", kind: "password", defaultValue: "" }
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
              capabilities: ["virtual"],
              configFields: []
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
          }
        ]), { status: 200 });
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
          JSON.stringify([{ entityId: "sensor.temp", friendlyName: "Temp", domain: "sensor", unit: "C" }]),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/v2/projects")) {
        return new Response(JSON.stringify([{ id: SAMPLE_PROJECT.id, name: SAMPLE_PROJECT.name, version: SAMPLE_PROJECT.version }]), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}`) && !init?.method) {
        return new Response(JSON.stringify(SAMPLE_PROJECT), { status: 200 });
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
            id: "oel-1",
            name: "HA Hall Tag",
            providerKind: "openepaperlink",
            providerRef: "device-1",
            discoverySource: "home-assistant"
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
          rgba: new Array(296 * 128 * 4).fill(255)
        }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-preview`)) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (body.includeInspection) {
          return new Response(JSON.stringify({
            preview: {
              width: 296,
              height: 128,
              hash: "layout-preview",
              activeScreenId: "layout-widget",
              rgba: new Array(296 * 128 * 4).fill(255)
            },
            inspection: {
              width: 296,
              height: 128,
              root: {
                nodeId: "root",
                nodeType: "stack",
                label: "stack",
                frame: { x: 0, y: 0, w: 296, h: 128 },
                contentFrame: { x: 0, y: 0, w: 296, h: 128 },
                children: [
                  {
                    nodeId: "child-text",
                    nodeType: "primitive_instance",
                    label: "text",
                    frame: { x: 0, y: 0, w: 296, h: 64 },
                    contentFrame: { x: 4, y: 4, w: 288, h: 56 },
                    children: [],
                    isContainer: false
                  }
                ],
                isContainer: true,
                stackAxis: "vertical"
              }
            }
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          hash: "layout-preview",
          activeScreenId: "layout-widget",
          rgba: new Array(296 * 128 * 4).fill(255)
        }), { status: 200 });
      }
      if (url.endsWith(`/api/v2/projects/${SAMPLE_PROJECT.id}/layout-inspection-preview`)) {
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          root: {
            nodeId: "root",
            nodeType: "stack",
            label: "stack",
            frame: { x: 0, y: 0, w: 296, h: 128 },
            contentFrame: { x: 0, y: 0, w: 296, h: 128 },
            children: [
              {
                nodeId: "child-text",
                nodeType: "primitive_instance",
                label: "text",
                frame: { x: 0, y: 0, w: 296, h: 64 },
                contentFrame: { x: 4, y: 4, w: 288, h: 56 },
                children: [],
                isContainer: false
              }
            ],
            isContainer: true,
            stackAxis: "vertical"
          }
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
    delete (globalThis as { ImageData?: unknown }).ImageData;
    delete (HTMLCanvasElement.prototype as Partial<HTMLCanvasElement>).getContext;
    vi.restoreAllMocks();
  });

  it("renders multi-page navigation and defaults to displays", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Display Designer");
    expect(element.shadowRoot.textContent).toContain("Displays");
    expect(element.shadowRoot.textContent).toContain("Display Types");
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

    const discoverButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Discover OEL"));
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

    const discoverButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Discover OEL"));
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
    expect(Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).some((button) => button.textContent?.includes("Manage device"))).toBe(false);
  });

  it("adds virtual display from displays page", async () => {
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addVirtualButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add Virtual"));
    addVirtualButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Virtual Display");
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
  });

  it("adds provider draft on config page", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
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

  it("shows home assistant and font management on config page", async () => {
    window.location.hash = "#/config";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Home Assistant");
    expect(element.shadowRoot.textContent).toContain("OpenEPaperLink Access Point");
    expect(element.shadowRoot.textContent).toContain("Default test display");
    expect(element.shadowRoot.textContent).toContain("Fonts");
    expect(element.shadowRoot.textContent).toContain("Rescan font dir");
    expect(element.shadowRoot.textContent).toContain("Delete font");
    expect(element.shadowRoot.textContent).toContain("8px");
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
    const addVirtualButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add Virtual"));
    addVirtualButton?.click();
    await flush();
    await element.updateComplete;

    const deleteButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Delete virtual display"));
    deleteButton?.click();
    await flush();
    await element.updateComplete;

    expect(countDeleteButtons()).toBe(beforeCount);
  });
});
