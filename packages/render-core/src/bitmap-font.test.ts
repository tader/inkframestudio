import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGlyph, layoutText, registerUserFonts, resolveTextStyle, scaleForFontSize, setTextLayoutAdapter } from "./bitmap-font.js";
import { FIXTURE_FONTS, registerFixtureFonts } from "./test-font-fixture.js";

beforeEach(() => {
  registerFixtureFonts();
});

afterEach(() => {
  registerFixtureFonts();
  setTextLayoutAdapter(undefined);
});

describe("bitmap font system", () => {
  it("treats letters as proportional", () => {
    const wide = getGlyph("W", { size: "normal", weight: "regular" });
    const narrow = getGlyph("I", { size: "normal", weight: "regular" });
    expect(wide.advance).toBeGreaterThan(narrow.advance);
  });

  it("keeps digits tabular when requested", () => {
    const one = getGlyph("1", { size: "normal", weight: "regular", tabularNumbers: true });
    const eight = getGlyph("8", { size: "normal", weight: "regular", tabularNumbers: true });
    expect(one.advance).toBe(eight.advance);
  });

  it("keeps decimal punctuation proportional when tabular numbers enabled", () => {
    const digit = getGlyph("8", { size: "header", weight: "regular", pixelSize: 16, tabularNumbers: true });
    const decimal = getGlyph(".", { size: "header", weight: "regular", pixelSize: 16, tabularNumbers: true });
    expect(decimal.advance).toBeLessThan(digit.advance);
    expect(decimal.advance).toBe(4);
  });

  it("distinguishes regular and bold weights", () => {
    const regular = getGlyph("A", { size: "normal", weight: "regular" });
    const bold = getGlyph("A", { size: "normal", weight: "bold" });
    expect(bold.advance).toBeGreaterThan(regular.advance);
  });

  it("supports tiny, normal and header scale presets", () => {
    expect(scaleForFontSize("tiny")).toBe(1);
    expect(scaleForFontSize("normal")).toBe(2);
    expect(scaleForFontSize("header")).toBe(3);
  });

  it("defaults body text and numeric text to first registered user font", () => {
    expect(resolveTextStyle({}).family).toBe("arial");
    expect(resolveTextStyle({ tabularNumbers: true }).family).toBe("arial");
  });

  it("loads registered TrueType font families deterministically", () => {
    const sans = getGlyph("A", { family: "arial", size: "normal", weight: "regular" });
    const mono = getGlyph("8", { family: "arial", size: "normal", weight: "regular" });
    expect(sans.height).toBeGreaterThan(0);
    expect(mono.width).toBeGreaterThan(0);
  });

  it("keeps asymmetric imported glyphs in correct left-right orientation", () => {
    const b = getGlyph("b", { family: "arial", size: "normal", weight: "regular" });
    const d = getGlyph("d", { family: "arial", size: "normal", weight: "regular" });
    expect(b.pixels.map((row) => row.join("")).join("|")).not.toBe(d.pixels.map((row) => row.join("")).join("|"));
  });

  it("anchors mixed text on one baseline while descenders extend below", () => {
    const run = layoutText("Abpq19", { family: "arial", size: "normal", weight: "regular" });
    const b = run.glyphs.find((glyph) => glyph.char === "b");
    const p = run.glyphs.find((glyph) => glyph.char === "p");
    const one = run.glyphs.find((glyph) => glyph.char === "1");
    expect(b).toBeDefined();
    expect(p).toBeDefined();
    expect(one).toBeDefined();
    expect((b?.y ?? 0) + (b?.top ?? 0)).toBe(run.baseline);
    expect((p?.y ?? 0) + (p?.top ?? 0)).toBe(run.baseline);
    expect((one?.y ?? 0) + (one?.top ?? 0)).toBe(run.baseline);
    expect((p?.height ?? 0)).toBeGreaterThanOrEqual(b?.height ?? 0);
    expect(run.descent).toBeGreaterThan(0);
  });

  it("keeps whitespace glyph metrics finite", () => {
    const run = layoutText("Header 21.5", { family: "arial", size: "header", weight: "regular" });
    expect(Number.isFinite(run.width)).toBe(true);
    const space = run.glyphs.find((glyph) => glyph.char === " ");
    expect(space).toBeDefined();
    expect(Number.isFinite(space?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.y ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.bearingX ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.top ?? NaN)).toBe(true);
  });

  it("supports custom preset pixels and explicit specimen sizes", () => {
    const defaultTiny = layoutText("Ag", { family: "arial", size: "tiny", weight: "regular" });
    const customTiny = layoutText(
      "Ag",
      { family: "arial", size: "tiny", weight: "regular" },
      { tiny: 5, normal: 12, header: 16 }
    );
    const explicit = layoutText("Ag", { family: "arial", size: "normal", weight: "regular", pixelSize: 20 });
    expect(customTiny.height).toBeLessThan(defaultTiny.height);
    expect(explicit.height).toBeGreaterThan(defaultTiny.height);
  });

  it("preserves explicit pixelSize through style resolution", () => {
    expect(resolveTextStyle({ family: "arial", size: "normal", pixelSize: 23 }).pixelSize).toBe(23);
    const small = layoutText("Ag", { family: "arial", size: "normal", pixelSize: 8 });
    const large = layoutText("Ag", { family: "arial", size: "normal", pixelSize: 24 });
    expect(large.height).toBeGreaterThan(small.height);
  });

  it("loads user-imported font families through registry", () => {
    registerUserFonts({
      "custom-sans": {
        regular: FIXTURE_FONTS.arial.regular,
        label: "Custom Sans"
      }
    });
    const glyph = getGlyph("A", { family: "custom-sans", size: "normal", weight: "regular" });
    expect(glyph.width).toBeGreaterThan(0);
    expect(glyph.height).toBeGreaterThan(0);
  });

  it("falls back to first registered user font when a configured family is missing", () => {
    const run = layoutText("Agenda", { family: "missing-font", size: "normal", weight: "regular" });
    expect(run.width).toBeGreaterThan(0);
    expect(run.height).toBeGreaterThan(0);
  });

  it("passes fallback font data to an installed text engine adapter", () => {
    let regularFontData = "";
    setTextLayoutAdapter(({ fontFamilyData, text }) => {
      regularFontData = fontFamilyData.regular ?? "";
      return {
        width: text.length,
        height: 1,
        ascent: 1,
        descent: 0,
        lineHeight: 1,
        baseline: 1,
        glyphs: []
      };
    });
    layoutText("A", { family: "missing-font", size: "normal", weight: "regular" });
    expect(regularFontData).toBe(FIXTURE_FONTS.arial.regular);
  });

  it("snaps uploaded font sizes to allowed pixel sizes", () => {
    registerUserFonts({
      "custom-sans": {
        regular: FIXTURE_FONTS.arial.regular,
        label: "Custom Sans",
        allowedPixelSizes: [8, 12, 16]
      }
    });
    const requested15 = layoutText("Ag", { family: "custom-sans", size: "normal", weight: "regular", pixelSize: 15 });
    const requested16 = layoutText("Ag", { family: "custom-sans", size: "normal", weight: "regular", pixelSize: 16 });
    expect(requested15.width).toBe(requested16.width);
    expect(requested15.height).toBe(requested16.height);
  });

  it("can bypass allowed pixel size snapping for preview rendering", () => {
    registerUserFonts({
      "custom-sans": {
        regular: FIXTURE_FONTS.arial.regular,
        label: "Custom Sans",
        allowedPixelSizes: [8, 12, 16]
      }
    });
    const snapped = layoutText("Ag 09:45", { family: "custom-sans", size: "normal", weight: "regular", pixelSize: 13 });
    const bypassed = layoutText("Ag 09:45", {
      family: "custom-sans",
      size: "normal",
      weight: "regular",
      pixelSize: 13,
      bypassAllowedPixelSizes: true
    });
    expect(snapped.width).not.toBe(bypassed.width);
    expect(snapped.height).not.toBe(bypassed.height);
  });

  it("maps legacy built-in family ids onto registered user fonts", () => {
    const legacy = getGlyph("A", { family: "px-sans", size: "normal", weight: "regular" });
    const current = getGlyph("A", { family: "arial", size: "normal", weight: "regular" });
    expect(legacy.width).toBe(current.width);
    expect(legacy.height).toBe(current.height);
  });

  it("loads fonts without Node Buffer in browser-like env", () => {
    const originalBuffer = globalThis.Buffer;
    // @ts-expect-error test browser-like env
    globalThis.Buffer = undefined;
    try {
      const glyph = getGlyph("A", { family: "arial", size: "normal", weight: "regular" });
      expect(glyph.width).toBeGreaterThan(0);
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });

  it("can delegate layout to an installed text engine adapter", () => {
    setTextLayoutAdapter(({ text }) => ({
      width: text.length * 10,
      height: 11,
      ascent: 8,
      descent: 3,
      lineHeight: 11,
      baseline: 8,
      glyphs: Array.from(text).map((char, index) => ({
        width: 1,
        height: 1,
        pixels: [[1]],
        advance: 10,
        bearingX: 0,
        top: 1,
        char,
        x: index * 10,
        y: 7
      }))
    }));
    const run = layoutText("ABC", { family: "arial", size: "normal", weight: "regular" });
    expect(run.width).toBe(30);
    expect(run.glyphs).toHaveLength(3);
    expect(run.glyphs[1]?.x).toBe(10);
  });
});
