import { mkdir, copyFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

const target = process.argv[2] ?? "all";

function generateFontAwesomeAssets() {
  execFileSync("node", [path.join(rootDir, "scripts", "generate-font-awesome.mjs")], {
    stdio: "inherit",
    cwd: rootDir
  });
}

async function buildEditor() {
  generateFontAwesomeAssets();
  const outdir = path.join(distDir, "editor-ui");
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(rootDir, "packages/editor-ui/src/index.ts")],
    bundle: true,
    format: "esm",
    sourcemap: true,
    outfile: path.join(outdir, "app.js"),
    target: "es2022",
    loader: {
      ".ttf": "file",
      ".woff": "file",
      ".woff2": "file",
      ".eot": "file"
    }
  });
  const appJsPath = path.join(outdir, "app.js");
  const appCssPath = path.join(outdir, "app.css");
  const appHash = createHash("sha256").update(await readFile(appJsPath)).digest("hex").slice(0, 12);
  const appJsName = `app.${appHash}.js`;
  const appJsMapName = `app.${appHash}.js.map`;
  let appJs = await readFile(appJsPath, "utf8");
  appJs = appJs.replace(/\/\/# sourceMappingURL=app\.js\.map\s*$/, `//# sourceMappingURL=${appJsMapName}`);
  await writeFile(appJsPath, appJs, "utf8");
  await rename(appJsPath, path.join(outdir, appJsName));
  await rename(path.join(outdir, "app.js.map"), path.join(outdir, appJsMapName));

  let cssLink = "";
  if (await readFile(appCssPath, "utf8").then(() => true).catch(() => false)) {
    const cssHash = createHash("sha256").update(await readFile(appCssPath)).digest("hex").slice(0, 12);
    const appCssName = `app.${cssHash}.css`;
    const appCssMapName = `app.${cssHash}.css.map`;
    let appCss = await readFile(appCssPath, "utf8");
    appCss = appCss.replace(/\/\*# sourceMappingURL=app\.css\.map \*\/\s*$/, `/*# sourceMappingURL=${appCssMapName} */`);
    await writeFile(appCssPath, appCss, "utf8");
    await rename(appCssPath, path.join(outdir, appCssName));
    await rename(path.join(outdir, "app.css.map"), path.join(outdir, appCssMapName)).catch(() => undefined);
    cssLink = `    <link rel="stylesheet" href="./${appCssName}" />\n`;
  }

  const indexHtml = await readFile(path.join(rootDir, "packages/editor-ui/index.html"), "utf8");
  const html = indexHtml
    .replace(/\s*<link rel="stylesheet" href="\.\/app\.css" \/>\n?/g, "")
    .replace(/<script type="module" src="\.\/app\.js"><\/script>/, `<script type="module" src="./${appJsName}"></script>`)
    .replace("</head>", `${cssLink}  </head>`);
  await writeFile(path.join(outdir, "index.html"), html, "utf8");
}

async function buildBackend() {
  generateFontAwesomeAssets();
  const rustOutDir = path.join(distDir, "rust-backend");
  await mkdir(rustOutDir, { recursive: true });
  execFileSync("cargo", ["build", "--manifest-path", path.join(rootDir, "rust", "backend-api", "Cargo.toml"), "--release"], {
    stdio: "inherit",
    cwd: rootDir
  });
  const suffix = process.platform === "win32" ? ".exe" : "";
  await copyFile(
    path.join(rootDir, "rust", "target", "release", `epd-backend-api${suffix}`),
    path.join(rustOutDir, `epd-backend-api${suffix}`)
  );
}

if (target === "editor") {
  await buildEditor();
} else if (target === "backend") {
  await buildBackend();
} else {
  await buildEditor();
  await buildBackend();
}
