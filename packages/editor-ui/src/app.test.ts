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
      if (url.endsWith("/api/icons")) {
        return new Response(JSON.stringify([{ id: "warning", label: "Warning" }]), { status: 200 });
      }
      if (url.endsWith("/api/fonts")) {
        return new Response(JSON.stringify([{ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }]), { status: 200 });
      }
      if (url.endsWith("/api/fonts/rescan")) {
        return new Response(JSON.stringify([{ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }]), { status: 200 });
      }
      if (url.includes("/api/fonts/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: "user-sans", label: "User Sans", source: "user", importSource: "upload", variants: ["regular", "bold"], allowedPixelSizes: [8, 10, 12] }), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/font-specimens`)) {
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
      if (url.includes("/api/dafont?page=")) {
        return new Response(JSON.stringify({
          page: 1,
          totalPages: 3,
          hasPreviousPage: false,
          hasNextPage: true,
          entries: [{
            id: "minecraft",
            name: "Minecraft",
            author: "Craftron Gaming",
            detailUrl: "https://www.dafont.com/minecraft.font?af=on",
            downloadUrl: "https://dl.dafont.com/dl/?f=minecraft",
            previewUrl: "https://www.dafont.com/img/preview/m/i/minecraft0.png",
            pixelSize: 16,
            licenseCategory: "100% Free",
            downloadSizeLabel: "5 K"
          }]
        }), { status: 200 });
      }
      if (url.endsWith("/api/dafont/import")) {
        return new Response(JSON.stringify({
          id: "minecraft",
          label: "Minecraft",
          source: "user",
          importSource: "dafont",
          variants: ["regular"],
          allowedPixelSizes: [16, 32, 48, 64],
          declaredPixelSize: 16,
          licenseCategory: "100% Free",
          sourceUrl: "https://www.dafont.com/minecraft.font?af=on",
          previewUrl: "https://www.dafont.com/img/preview/m/i/minecraft0.png"
        }), { status: 201 });
      }
      if (url.endsWith("/api/home-assistant/entities")) {
        return new Response(
          JSON.stringify([{ entityId: "sensor.temp", friendlyName: "Temp", domain: "sensor", unit: "C" }]),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/settings/home-assistant")) {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({
            host: "https://ha.local",
            token: "********",
            hasToken: true,
            mode: "custom",
            useSupervisorProxy: false,
            allowInsecureTls: false
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          host: "",
          token: "",
          hasToken: false,
          mode: "custom",
          useSupervisorProxy: false,
          allowInsecureTls: false
        }), { status: 200 });
      }
      if (url.endsWith("/api/settings/home-assistant/test")) {
        return new Response(JSON.stringify({
          ok: true,
          mode: "custom",
          message: "Connected to Home Assistant"
        }), { status: 200 });
      }
      if (url.endsWith("/api/settings/openepaperlink-access-point")) {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({
            url: "http://192.168.1.170",
            defaultTestDisplayMac: "00000219BC483B18"
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          url: "",
          defaultTestDisplayMac: ""
        }), { status: 200 });
      }
      if (url.endsWith("/api/settings/openepaperlink-access-point/test")) {
        return new Response(JSON.stringify({
          ok: true,
          message: "Connected to OpenEPaperLink access point",
          tagCount: 8
        }), { status: 200 });
      }
      if (url.endsWith("/api/projects")) {
        return new Response(JSON.stringify([{ id: SAMPLE_PROJECT.id, name: SAMPLE_PROJECT.name, version: SAMPLE_PROJECT.version }]), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}`)) {
        return new Response(JSON.stringify(SAMPLE_PROJECT), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/displays/discover`)) {
        return new Response(JSON.stringify([
          {
            id: "ap:00000219BC483B18",
            name: "Hall Tag",
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
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/assignment-schedules`)) {
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
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/assignments/assignment-virtual-tri296x128-red/force-update`)) {
        return new Response(JSON.stringify({
          assignmentId: "assignment-virtual-tri296x128-red",
          displayId: "virtual-tri296x128-red",
          updated: true,
          skipped: false,
          hash: "force-hash",
          message: "Forced update uploaded."
        }), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/device-preview`)) {
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          hash: "device-preview",
          activeScreenId: "layout-calendar",
          rgba: new Array(296 * 128 * 4).fill(255)
        }), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/layout-preview`)) {
        return new Response(JSON.stringify({
          width: 296,
          height: 128,
          hash: "layout-preview",
          activeScreenId: "layout-widget",
          rgba: new Array(296 * 128 * 4).fill(255)
        }), { status: 200 });
      }
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}/layout-inspection-preview`)) {
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
      if (url.endsWith(`/api/projects/${SAMPLE_PROJECT.id}`) && init?.method === "PUT") {
        return new Response(JSON.stringify({ ...SAMPLE_PROJECT, version: SAMPLE_PROJECT.version + 1 }), { status: 200 });
      }
      if (url.includes(`/api/projects/${SAMPLE_PROJECT.id}/devices/`) && url.endsWith("/upload")) {
        return new Response(JSON.stringify({
          uploaded: true,
          hash: "uploaded-hash",
          width: 296,
          height: 128
        }), { status: 200 });
      }
      if (url.endsWith("/api/openepaperlink-access-point/upload-preview")) {
        return new Response(JSON.stringify({
          uploaded: true,
          mac: "00000219BC483B18",
          width: 296,
          height: 128
        }), { status: 200 });
      }
      if (url.endsWith("/api/fonts/import")) {
        return new Response(JSON.stringify({ id: "user-sans", label: "User Sans", variant: "regular" }), { status: 201 });
      }
      if (url.includes("/api/fonts/") && init?.method === "DELETE") {
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
    expect(element.shadowRoot.textContent).toContain("DaFont");
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
      if (url.endsWith("/api/home-assistant/entities")) {
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

  it("shows DaFont page and imports selected font", async () => {
    window.location.hash = "#/dafont";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("DaFont Browser");
    expect(element.shadowRoot.textContent).toContain("Minecraft");
    expect(element.shadowRoot.textContent).toContain("100% Free");

    const importButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Import");
    importButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Imported Minecraft");
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

  it("shows node tree for compound widgets", async () => {
    window.location.hash = "#/widgets";
    const element = document.createElement("epaper-editor-app") as HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot };
    document.body.append(element);
    await flush();
    await element.updateComplete;

    const addButton = Array.from(element.shadowRoot.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("Add compound"));
    addButton?.click();
    await flush();
    await element.updateComplete;

    expect(element.shadowRoot.textContent).toContain("Node Tree");
    expect(element.shadowRoot.textContent).toContain("Structure");
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
