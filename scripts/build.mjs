import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
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
  const indexHtml = await readFile(path.join(rootDir, "packages/editor-ui/index.html"), "utf8");
  const htmlWithCss = indexHtml.includes("./app.css")
    ? indexHtml
    : indexHtml.replace("</head>", '    <link rel="stylesheet" href="./app.css" />\n  </head>');
  await writeFile(path.join(outdir, "index.html"), htmlWithCss, "utf8");
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
