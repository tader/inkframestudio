import { afterEach, describe, expect, it } from "vitest";
import { FONT_BINARY_BASE64 } from "./generated-font-data.js";
import { getGlyph, layoutText, registerUserFonts, resolveTextStyle, scaleForFontSize } from "./bitmap-font.js";

afterEach(() => {
  registerUserFonts({});
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
    expect(decimal.advance).toBe(6);
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

  it("defaults body text to px-sans and numeric text to px-mono-special", () => {
    expect(resolveTextStyle({}).family).toBe("px-sans");
    expect(resolveTextStyle({ tabularNumbers: true }).family).toBe("px-mono-special");
  });

  it("loads imported px font families deterministically", () => {
    const sans = getGlyph("A", { family: "px-sans", size: "normal", weight: "regular" });
    const mono = getGlyph("8", { family: "px-mono-special", size: "normal", weight: "regular" });
    expect(sans.height).toBeGreaterThan(0);
    expect(mono.width).toBe(6);
  });

  it("keeps asymmetric imported glyphs in correct left-right orientation", () => {
    const b = getGlyph("b", { family: "px-sans", size: "normal", weight: "regular" });
    const d = getGlyph("d", { family: "px-sans", size: "normal", weight: "regular" });
    expect(b.pixels[1]?.join("")).toBe("00110");
    expect(d.pixels[1]?.join("")).toBe("01100");
  });

  it("anchors mixed text on one baseline while descenders extend below", () => {
    const run = layoutText("Abpq19", { family: "px-sans", size: "normal", weight: "regular" });
    const b = run.glyphs.find((glyph) => glyph.char === "b");
    const p = run.glyphs.find((glyph) => glyph.char === "p");
    const one = run.glyphs.find((glyph) => glyph.char === "1");
    expect(b).toBeDefined();
    expect(p).toBeDefined();
    expect(one).toBeDefined();
    expect((b?.y ?? 0) + (b?.top ?? 0)).toBe(run.baseline);
    expect((p?.y ?? 0) + (p?.top ?? 0)).toBe(run.baseline);
    expect((one?.y ?? 0) + (one?.top ?? 0)).toBe(run.baseline);
    expect((p?.height ?? 0)).toBeGreaterThan(b?.height ?? 0);
    expect(run.descent).toBeGreaterThan(0);
  });

  it("keeps whitespace glyph metrics finite", () => {
    const run = layoutText("Header 21.5", { family: "px-sans", size: "header", weight: "regular" });
    expect(Number.isFinite(run.width)).toBe(true);
    const space = run.glyphs.find((glyph) => glyph.char === " ");
    expect(space).toBeDefined();
    expect(Number.isFinite(space?.x ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.y ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.bearingX ?? NaN)).toBe(true);
    expect(Number.isFinite(space?.top ?? NaN)).toBe(true);
  });

  it("supports custom preset pixels and explicit specimen sizes", () => {
    const defaultTiny = layoutText("Ag", { family: "px-sans", size: "tiny", weight: "regular" });
    const customTiny = layoutText(
      "Ag",
      { family: "px-sans", size: "tiny", weight: "regular" },
      { tiny: 5, normal: 12, header: 16 }
    );
    const explicit = layoutText("Ag", { family: "px-sans", size: "normal", weight: "regular", pixelSize: 20 });
    expect(customTiny.height).toBeLessThan(defaultTiny.height);
    expect(explicit.height).toBeGreaterThan(defaultTiny.height);
  });

  it("preserves explicit pixelSize through style resolution", () => {
    expect(resolveTextStyle({ family: "px-sans", size: "normal", pixelSize: 23 }).pixelSize).toBe(23);
    const small = layoutText("Ag", { family: "px-sans", size: "normal", pixelSize: 8 });
    const large = layoutText("Ag", { family: "px-sans", size: "normal", pixelSize: 24 });
    expect(large.height).toBeGreaterThan(small.height);
  });

  it("loads user-imported font families through registry", () => {
    registerUserFonts({
      "custom-sans": {
        regular: FONT_BINARY_BASE64["px-sans"].regular,
        label: "Custom Sans"
      }
    });
    const glyph = getGlyph("A", { family: "custom-sans", size: "normal", weight: "regular" });
    expect(glyph.width).toBeGreaterThan(0);
    expect(glyph.height).toBeGreaterThan(0);
  });

  it("snaps uploaded font sizes to allowed pixel sizes", () => {
    registerUserFonts({
      "custom-sans": {
        regular: FONT_BINARY_BASE64["px-sans"].regular,
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
        regular: FONT_BINARY_BASE64["px-sans"].regular,
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

  it("loads fonts without Node Buffer in browser-like env", () => {
    const originalBuffer = globalThis.Buffer;
    // @ts-expect-error test browser-like env
    globalThis.Buffer = undefined;
    try {
      const glyph = getGlyph("A", { family: "px-sans", size: "normal", weight: "regular" });
      expect(glyph.width).toBeGreaterThan(0);
    } finally {
      globalThis.Buffer = originalBuffer;
    }
  });
});
