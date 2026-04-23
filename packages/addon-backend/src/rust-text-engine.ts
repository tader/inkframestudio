import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { FontPresetValues, TextStyle } from "../../render-core/src/types.js";
import { setTextLayoutAdapter, type FontFamilyData, type TextLayoutRun } from "../../render-core/src/bitmap-font.js";

const rootDir = process.cwd();

type RenderMode = "mono_native" | "gray_threshold" | "gray_oversample";

interface RustLayoutRequest {
  op: "layout";
  text: string;
  style: TextStyle;
  fontPresets: FontPresetValues;
  fontFamilyData: FontFamilyData;
  renderMode: RenderMode;
  threshold: number;
  oversampleFactor: number;
}

function rustBinaryCandidates(): string[] {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return [
    path.join(rootDir, "dist", "addon-backend", "bin", `epd-text-engine${suffix}`),
    path.join(rootDir, "rust", "text-engine", "target", "debug", `epd-text-engine${suffix}`),
    path.join(rootDir, "rust", "text-engine", "target", "release", `epd-text-engine${suffix}`)
  ];
}

function resolveRustBinary(): string | undefined {
  return rustBinaryCandidates().find((candidate) => existsSync(candidate));
}

function detectBinaryPath(): string | undefined {
  for (const candidate of rustBinaryCandidates()) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function ensureBinaryPath(): string | undefined {
  const existing = detectBinaryPath() ?? resolveRustBinary();
  if (existing) {
    return existing;
  }
  try {
    execFileSync("cargo", ["build", "--manifest-path", path.join(rootDir, "rust", "text-engine", "Cargo.toml")], {
      cwd: rootDir,
      stdio: "inherit"
    });
  } catch (error) {
    console.warn("failed to build rust text engine", error);
    return undefined;
  }
  return detectBinaryPath() ?? resolveRustBinary();
}

function envRenderMode(): RenderMode {
  const value = String(process.env.OPENEPAPER_TEXT_RENDER_MODE ?? "mono_native").trim();
  if (value === "gray_threshold" || value === "gray_oversample") {
    return value;
  }
  return "mono_native";
}

export function installRustTextLayoutAdapter(): void {
  const binaryPath = ensureBinaryPath();
  if (!binaryPath) {
    return;
  }
  setTextLayoutAdapter(({ text, style, fontPresets, fontFamilyData }): TextLayoutRun | undefined => {
    const request: RustLayoutRequest = {
      op: "layout",
      text,
      style,
      fontPresets,
      fontFamilyData,
      renderMode: envRenderMode(),
      threshold: Number(process.env.OPENEPAPER_TEXT_THRESHOLD ?? 128),
      oversampleFactor: Math.max(1, Number(process.env.OPENEPAPER_TEXT_OVERSAMPLE ?? 3))
    };
    try {
      const raw = execFileSync(binaryPath, [], {
        input: JSON.stringify(request),
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024
      });
      return JSON.parse(raw) as TextLayoutRun;
    } catch (error) {
      console.warn("rust text engine failed, falling back to JS rasterizer", error);
      return undefined;
    }
  });
}
