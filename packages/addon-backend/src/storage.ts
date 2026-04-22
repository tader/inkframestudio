import * as fontkit from "fontkit";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  FontOption,
  FontVariantKey,
  HomeAssistantConnectionSettings,
  OpenEpaperLinkAccessPointSettings,
  Project
} from "../../render-core/src/types.js";
import { SAMPLE_PROJECT } from "../../render-core/src/sample-project.js";
import { normalizeProject } from "../../render-core/src/themes.js";

interface StoredFontFamily {
  id: string;
  label: string;
  files: Partial<Record<FontVariantKey, string>>;
  allowedPixelSizes?: number[];
  importSource?: "upload" | "dafont";
  sourceUrl?: string;
  previewUrl?: string;
  declaredPixelSize?: number;
  licenseCategory?: string;
}

interface StoredSettings {
  homeAssistant?: HomeAssistantConnectionSettings;
  openEpaperLinkAccessPoint?: OpenEpaperLinkAccessPointSettings;
}

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

export class ProjectStorage {
  private fontWriteChain: Promise<void> = Promise.resolve();

  constructor(private readonly rootDir: string) {}

  private get projectDir(): string {
    return path.join(this.rootDir, "projects");
  }

  private get settingsFile(): string {
    return path.join(this.rootDir, "settings.json");
  }

  private get fontDir(): string {
    return path.join(this.rootDir, "fonts");
  }

  private get fontIndexFile(): string {
    return path.join(this.rootDir, "fonts.json");
  }

  async ensureSeeded(): Promise<void> {
    await mkdir(this.projectDir, { recursive: true });
    const existing = await readdir(this.projectDir).catch(() => []);
    if (!existing.some((entry) => entry.endsWith(".json"))) {
      await this.saveProject(SAMPLE_PROJECT);
    }
  }

  async listProjects(): Promise<Array<Pick<Project, "id" | "name" | "version">>> {
    await this.ensureSeeded();
    const entries = await readdir(this.projectDir);
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(path.join(this.projectDir, entry), "utf8");
          const project = JSON.parse(content) as Project;
          return { id: project.id, name: project.name, version: project.version };
        })
    );
    return projects.sort((left, right) => left.name.localeCompare(right.name));
  }

  async getProject(id: string): Promise<Project> {
    await this.ensureSeeded();
    const filePath = path.join(this.projectDir, `${id}.json`);
    const content = await readFile(filePath, "utf8");
    return normalizeProject(JSON.parse(content) as Project);
  }

  async saveProject(project: Project): Promise<Project> {
    await mkdir(this.projectDir, { recursive: true });
    const nextProject = normalizeProject({
      ...project,
      version: project.version + 1
    });
    await writeFile(
      path.join(this.projectDir, `${project.id}.json`),
      `${JSON.stringify(nextProject, null, 2)}\n`,
      "utf8"
    );
    return nextProject;
  }

  async getHomeAssistantSettings(): Promise<HomeAssistantConnectionSettings> {
    await mkdir(this.rootDir, { recursive: true });
    try {
      const content = await readFile(this.settingsFile, "utf8");
      const parsed = JSON.parse(content) as StoredSettings;
      return (
        parsed.homeAssistant ?? {
          host: "",
          token: "",
          mode: "custom",
          useSupervisorProxy: false,
          allowInsecureTls: false
        }
      );
    } catch {
      return {
        host: "",
        token: "",
        mode: "custom",
        useSupervisorProxy: false,
        allowInsecureTls: false
      };
    }
  }

  async saveHomeAssistantSettings(settings: HomeAssistantConnectionSettings): Promise<HomeAssistantConnectionSettings> {
    await mkdir(this.rootDir, { recursive: true });
    const current = await this.readSettings();
    await writeFile(
      this.settingsFile,
      `${JSON.stringify({ ...current, homeAssistant: settings }, null, 2)}\n`,
      "utf8"
    );
    return settings;
  }

  async getOpenEpaperLinkAccessPointSettings(): Promise<OpenEpaperLinkAccessPointSettings> {
    const settings = await this.readSettings();
    return settings.openEpaperLinkAccessPoint ?? { url: "", defaultTestDisplayMac: "" };
  }

  async saveOpenEpaperLinkAccessPointSettings(
    settings: OpenEpaperLinkAccessPointSettings
  ): Promise<OpenEpaperLinkAccessPointSettings> {
    await mkdir(this.rootDir, { recursive: true });
    const current = await this.readSettings();
    await writeFile(
      this.settingsFile,
      `${JSON.stringify({ ...current, openEpaperLinkAccessPoint: settings }, null, 2)}\n`,
      "utf8"
    );
    return settings;
  }

  async listStoredFonts(): Promise<StoredFontFamily[]> {
    await mkdir(this.fontDir, { recursive: true });
    try {
      const content = await readFile(this.fontIndexFile, "utf8");
      const parsed = JSON.parse(content) as { fonts?: StoredFontFamily[] };
      return parsed.fonts ?? [];
    } catch {
      return [];
    }
  }

  async saveStoredFont(
    familyId: string,
    label: string,
    variant: FontVariantKey,
    filename: string,
    bytes: Buffer
  ): Promise<void> {
    await this.runFontWrite(async () => {
      await mkdir(this.fontDir, { recursive: true });
      await writeFile(path.join(this.fontDir, filename), bytes);
      const fonts = await this.listStoredFonts();
      const existing = fonts.find((entry) => entry.id === familyId);
      if (existing) {
        existing.label = label;
        existing.files[variant] = filename;
        existing.importSource ??= "upload";
      } else {
        fonts.push({
          id: familyId,
          label,
          files: { [variant]: filename },
          importSource: "upload"
        });
      }
      await writeFile(this.fontIndexFile, `${JSON.stringify({ fonts }, null, 2)}\n`, "utf8");
    });
  }

  async deleteStoredFont(familyId: string): Promise<void> {
    await this.runFontWrite(async () => {
      const fonts = await this.listStoredFonts();
      const remaining = fonts.filter((entry) => entry.id !== familyId);
      const removed = fonts.find((entry) => entry.id === familyId);
      if (removed) {
        for (const filename of Object.values(removed.files)) {
          if (!filename) {
            continue;
          }
          await rm(path.join(this.fontDir, filename), { force: true });
        }
      }
      await writeFile(this.fontIndexFile, `${JSON.stringify({ fonts: remaining }, null, 2)}\n`, "utf8");
    });
  }

  async rebuildStoredFontIndex(): Promise<StoredFontFamily[]> {
    return await this.runFontWrite(async () => {
      await mkdir(this.fontDir, { recursive: true });
      const existingFonts = await this.listStoredFonts();
      const existingById = new Map(existingFonts.map((entry) => [entry.id, entry] as const));
      const existingByFilename = new Map<string, StoredFontFamily>();
      for (const entry of existingFonts) {
        for (const filename of Object.values(entry.files)) {
          if (filename) {
            existingByFilename.set(filename, entry);
          }
        }
      }
      const entries = (await readdir(this.fontDir))
        .filter((entry) => /\.(ttf|otf|woff2?)$/i.test(entry))
        .sort((left, right) => left.localeCompare(right));
      const families = new Map<string, StoredFontFamily>();

      for (const entry of entries) {
        const filePath = path.join(this.fontDir, entry);
        const bytes = await readFile(filePath);
        let label = entry.replace(/\.(ttf|otf|woff2?)$/i, "");
        let variant: FontVariantKey = "regular";
        try {
          const font = fontkit.create(bytes) as unknown as {
            familyName?: string;
            subfamilyName?: string;
          };
          label = font.familyName ?? label;
          variant = detectFontVariant(font.subfamilyName);
        } catch {
          // keep filename-derived fallback
        }
        const familyId = slugifyFontId(label);
        const previous = existingById.get(familyId) ?? existingByFilename.get(entry);
        const existing = families.get(familyId) ?? {
          id: familyId,
          label,
          files: {},
          allowedPixelSizes: previous?.allowedPixelSizes,
          importSource: previous?.importSource ?? "upload",
          sourceUrl: previous?.sourceUrl,
          previewUrl: previous?.previewUrl,
          declaredPixelSize: previous?.declaredPixelSize,
          licenseCategory: previous?.licenseCategory
        };
        existing.label = label;
        existing.files[variant] = entry;
        families.set(familyId, existing);
      }

      const fonts = Array.from(families.values()).sort((left, right) => left.label.localeCompare(right.label));
      await writeFile(this.fontIndexFile, `${JSON.stringify({ fonts }, null, 2)}\n`, "utf8");
      return fonts;
    });
  }

  async listFontOptions(): Promise<FontOption[]> {
    const fonts = await this.listStoredFonts();
    return fonts.map((entry) => ({
      id: entry.id,
      label: entry.label,
      source: "user",
      variants: (Object.keys(entry.files) as FontVariantKey[]).filter((variant) => Boolean(entry.files[variant])),
      allowedPixelSizes: entry.allowedPixelSizes,
      importSource: entry.importSource ?? "upload",
      sourceUrl: entry.sourceUrl,
      previewUrl: entry.previewUrl,
      declaredPixelSize: entry.declaredPixelSize,
      licenseCategory: entry.licenseCategory
    }));
  }

  async updateStoredFontMetadata(
    familyId: string,
    patch: {
      allowedPixelSizes?: number[];
      importSource?: "upload" | "dafont";
      sourceUrl?: string;
      previewUrl?: string;
      declaredPixelSize?: number;
      licenseCategory?: string;
    }
  ): Promise<void> {
    await this.runFontWrite(async () => {
      const fonts = await this.listStoredFonts();
      const existing = fonts.find((entry) => entry.id === familyId);
      if (!existing) {
        return;
      }
      if ("allowedPixelSizes" in patch) {
        existing.allowedPixelSizes = patch.allowedPixelSizes;
      }
      if ("importSource" in patch) {
        existing.importSource = patch.importSource;
      }
      if ("sourceUrl" in patch) {
        existing.sourceUrl = patch.sourceUrl;
      }
      if ("previewUrl" in patch) {
        existing.previewUrl = patch.previewUrl;
      }
      if ("declaredPixelSize" in patch) {
        existing.declaredPixelSize = patch.declaredPixelSize;
      }
      if ("licenseCategory" in patch) {
        existing.licenseCategory = patch.licenseCategory;
      }
      await writeFile(this.fontIndexFile, `${JSON.stringify({ fonts }, null, 2)}\n`, "utf8");
    });
  }

  async loadUserFontData(): Promise<Record<string, { regular?: string; italic?: string; bold?: string; boldItalic?: string; label?: string; allowedPixelSizes?: number[] }>> {
    const fonts = await this.listStoredFonts();
    const entries = await Promise.all(
      fonts.map(async (entry) => {
        const regular = entry.files.regular
          ? await readFile(path.join(this.fontDir, entry.files.regular), "base64")
          : undefined;
        const italic = entry.files.italic
          ? await readFile(path.join(this.fontDir, entry.files.italic), "base64")
          : undefined;
        const bold = entry.files.bold
          ? await readFile(path.join(this.fontDir, entry.files.bold), "base64")
          : undefined;
        const boldItalic = entry.files.boldItalic
          ? await readFile(path.join(this.fontDir, entry.files.boldItalic), "base64")
          : undefined;
        return [entry.id, { regular, italic, bold, boldItalic, label: entry.label, allowedPixelSizes: entry.allowedPixelSizes }] as const;
      })
    );
    return Object.fromEntries(entries);
  }

  private async readSettings(): Promise<StoredSettings> {
    await mkdir(this.rootDir, { recursive: true });
    try {
      const content = await readFile(this.settingsFile, "utf8");
      return JSON.parse(content) as StoredSettings;
    } catch {
      return {};
    }
  }

  private async runFontWrite<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.fontWriteChain.then(operation);
    this.fontWriteChain = pending.then(() => undefined, () => undefined);
    return await pending;
  }
}
