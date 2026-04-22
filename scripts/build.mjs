import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const target = process.argv[2] ?? "all";

async function buildEditor() {
  const outdir = path.join(distDir, "editor-ui");
  await mkdir(outdir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(rootDir, "packages/editor-ui/src/index.ts")],
    bundle: true,
    format: "esm",
    sourcemap: true,
    outfile: path.join(outdir, "app.js"),
    target: "es2022"
  });
  await copyFile(
    path.join(rootDir, "packages/editor-ui/index.html"),
    path.join(outdir, "index.html")
  );
}

async function buildBackend() {
  const outdir = path.join(distDir, "addon-backend");
  await mkdir(outdir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(rootDir, "packages/addon-backend/src/server.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: true,
    outfile: path.join(outdir, "server.js"),
    target: "node22"
  });
}

if (target === "editor") {
  await buildEditor();
} else if (target === "backend") {
  await buildBackend();
} else {
  await buildEditor();
  await buildBackend();
}
