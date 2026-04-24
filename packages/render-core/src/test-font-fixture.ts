import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerUserFonts } from "./bitmap-font.js";

const FIXTURE_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../data/fonts");

export const FIXTURE_FONTS = {
  arial: {
    regular: readFileSync(join(FIXTURE_FONT_DIR, "arial-regular.ttf")).toString("base64"),
    italic: readFileSync(join(FIXTURE_FONT_DIR, "arial-italic.ttf")).toString("base64"),
    bold: readFileSync(join(FIXTURE_FONT_DIR, "arial-bold.ttf")).toString("base64"),
    boldItalic: readFileSync(join(FIXTURE_FONT_DIR, "arial-boldItalic.ttf")).toString("base64"),
    label: "Arial"
  }
};

export function registerFixtureFonts(): void {
  registerUserFonts(FIXTURE_FONTS);
}
