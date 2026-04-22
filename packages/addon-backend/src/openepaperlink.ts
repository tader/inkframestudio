import type {
  DiscoveredDisplayCandidate,
  DisplayType,
  OpenEpaperLinkAccessPointSettings,
  OpenEpaperLinkAccessPointStatus
} from "../../render-core/src/types.js";

interface AccessPointTagRecord {
  mac: string;
  alias?: string;
  hwType?: number;
  contentMode?: number;
  capabilities?: number;
  rotate?: number;
  invert?: number;
  lut?: number;
  isexternal?: boolean;
  apip?: string;
  temperature?: number;
  batteryMv?: number;
  lastseen?: number;
  nextcheckin?: number;
  [key: string]: unknown;
}

interface AccessPointTagPage {
  tags?: AccessPointTagRecord[];
  continu?: number;
}

interface AccessPointTagType {
  version?: number;
  name?: string;
  width?: number;
  height?: number;
  rotatebuffer?: number;
  bpp?: number;
  colortable?: Record<string, [number, number, number]>;
}

function hasConfiguredAccessPoint(settings: OpenEpaperLinkAccessPointSettings): boolean {
  return Boolean(settings.url.trim());
}

function normalizeBaseUrl(settings: OpenEpaperLinkAccessPointSettings): string {
  return settings.url.trim().replace(/\/+$/, "");
}

function rgbToHex(rgb: [number, number, number] | undefined, fallback: string): string {
  if (!rgb) {
    return fallback;
  }
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hwTypeHex(hwType: number | undefined): string {
  return Math.max(0, Number(hwType ?? 0)).toString(16).padStart(2, "0").slice(-2).toUpperCase();
}

function buildDisplayTypeId(tagType: AccessPointTagType, hwType: number | undefined): string {
  const width = Number(tagType.width ?? 0);
  const height = Number(tagType.height ?? 0);
  return `oel-ap-hw-${hwTypeHex(hwType)}-${width}x${height}`;
}

function buildDisplayType(tagType: AccessPointTagType, hwType: number | undefined): DisplayType | undefined {
  const width = Number(tagType.width ?? 0);
  const height = Number(tagType.height ?? 0);
  if (!width || !height) {
    return undefined;
  }
  const colorTable = tagType.colortable ?? {};
  const accentEntry = Object.entries(colorTable).find(([name]) => !/^(white|black)$/i.test(name));
  return {
    id: buildDisplayTypeId(tagType, hwType),
    name: String(tagType.name ?? `OEL ${width}x${height}`),
    width,
    height,
    rotation: 0,
    safeMarginPx: 4,
    gridUnitPx: 8,
    palette: {
      bg: rgbToHex(colorTable.white, "#ffffff"),
      fg: rgbToHex(colorTable.black, "#000000"),
      accent: rgbToHex(accentEntry?.[1], "#ff0000")
    }
  };
}

export class OpenEpaperLinkAccessPointClient {
  private uploadChain: Promise<void> = Promise.resolve();

  hasConfiguredConnection(settings: OpenEpaperLinkAccessPointSettings): boolean {
    return hasConfiguredAccessPoint(settings);
  }

  private async sleep(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private async fetchJson<T>(settings: OpenEpaperLinkAccessPointSettings, path: string): Promise<T> {
    const response = await fetch(`${normalizeBaseUrl(settings)}${path}`);
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(
        `OpenEPaperLink request failed with ${response.status} on ${path}${details ? `: ${details.slice(0, 160)}` : ""}`
      );
    }
    return (await response.json()) as T;
  }

  async testConnection(settings: OpenEpaperLinkAccessPointSettings): Promise<OpenEpaperLinkAccessPointStatus> {
    if (!hasConfiguredAccessPoint(settings)) {
      return {
        ok: false,
        message: "Access point URL missing",
        networkError: false
      };
    }
    try {
      const page = await this.fetchJson<AccessPointTagPage>(settings, "/get_db?pos=0");
      return {
        ok: true,
        message: "Connected to OpenEPaperLink access point",
        tagCount: page.tags?.length ?? 0
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Access point request failed",
        networkError: true
      };
    }
  }

  async fetchAllTags(settings: OpenEpaperLinkAccessPointSettings): Promise<AccessPointTagRecord[]> {
    if (!hasConfiguredAccessPoint(settings)) {
      return [];
    }
    const tags: AccessPointTagRecord[] = [];
    const seenPositions = new Set<number>();
    let position = 0;
    while (!seenPositions.has(position)) {
      seenPositions.add(position);
      const page = await this.fetchJson<AccessPointTagPage>(settings, `/get_db?pos=${position}`);
      tags.push(...(page.tags ?? []));
      if (typeof page.continu !== "number") {
        break;
      }
      position = page.continu;
    }
    return tags;
  }

  async fetchTagType(
    settings: OpenEpaperLinkAccessPointSettings,
    hwType: number | undefined
  ): Promise<AccessPointTagType | undefined> {
    if (hwType === undefined || hwType === null) {
      return undefined;
    }
    return await this.fetchJson<AccessPointTagType>(settings, `/tagtypes/${hwTypeHex(hwType)}.json`);
  }

  async discoverDisplays(settings: OpenEpaperLinkAccessPointSettings): Promise<DiscoveredDisplayCandidate[]> {
    if (!hasConfiguredAccessPoint(settings)) {
      return [];
    }
    const tags = await this.fetchAllTags(settings);
    const tagTypes = new Map<number, AccessPointTagType | undefined>();
    return await Promise.all(
      tags.map(async (tag) => {
        const hwType = Number(tag.hwType ?? 0);
        if (!tagTypes.has(hwType)) {
          tagTypes.set(hwType, await this.fetchTagType(settings, hwType).catch(() => undefined));
        }
        const tagType = tagTypes.get(hwType);
        const suggestedDisplayType = buildDisplayType(tagType ?? {}, hwType);
        return {
          id: `ap:${tag.mac}`,
          name: String(tag.alias || tagType?.name || tag.mac),
          providerKind: "openepaperlink-ap",
          providerRef: tag.mac,
          suggestedDisplayTypeId: suggestedDisplayType?.id,
          suggestedDisplayType,
          discoverySource: "access-point",
          metadata: {
            mac: tag.mac,
            hwType,
            tagTypeName: tagType?.name,
            contentMode: tag.contentMode,
            capabilities: tag.capabilities,
            rotate: tag.rotate,
            invert: tag.invert,
            lut: tag.lut,
            isexternal: tag.isexternal,
            apip: tag.apip,
            batteryMv: tag.batteryMv,
            temperature: tag.temperature,
            lastseen: tag.lastseen,
            nextcheckin: tag.nextcheckin
          }
        } satisfies DiscoveredDisplayCandidate;
      })
    );
  }

  async uploadImage(
    settings: OpenEpaperLinkAccessPointSettings,
    mac: string,
    image: Uint8Array | ArrayBuffer,
    filename = "image.jpg"
  ): Promise<void> {
    const uploadTask = this.uploadChain.then(async () => {
      const form = new FormData();
      const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : Uint8Array.from(image);
      form.set("mac", mac);
      form.set("contentmode", "25");
      form.set("dither", "2");
      form.set("ttl", "1");
      form.set("lut", "0");
      form.set("file", new Blob([bytes], { type: "image/jpeg" }), filename);
      const response = await fetch(`${normalizeBaseUrl(settings)}/imgupload`, {
        method: "POST",
        body: form
      });
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(
          `OpenEPaperLink upload failed with ${response.status}${details ? `: ${details.slice(0, 160)}` : ""}`
        );
      }
    });

    this.uploadChain = uploadTask
      .catch(() => undefined)
      .then(async () => {
        await this.sleep(1000);
      });

    await uploadTask;
  }
}
