import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FONT_BINARY_BASE64 } from "../../render-core/src/generated-font-data.js";
import { fetchDaFontPage, importDaFontFont, parseDaFontBitmapPage } from "./dafont.js";
import { ProjectStorage } from "./storage.js";

const SAMPLE_HTML = `
<div class="titlebar"><div class="noindex"><span class="select">&nbsp;1&nbsp;</span><a href="bitmap.php?page=2&af=on"> 2&nbsp;</a><a href="bitmap.php?page=3&af=on"> 3&nbsp;</a></div></div>
<a name="1"></a><div class="lv1left dfbg"><a href="minecraft.font?af=on"><strong>Minecraft</strong></a> by <a href="craftron-gaming.d6128?af=on">Craftron Gaming</a></div><div class="lv1right dfbg">&nbsp;<span style="cursor:help" title="Use at 16 px (or multiple of 16), anti-alias off"> (16 px)</span></div><div class="lv2right">&nbsp;<span class="light">4 downloads</span> &nbsp; <a class="tdn help black" style="cursor:help" target="_blank" href="./faq.php#copyright">100% Free</a></div><div class="dlbox" style="height:88px" ><a class="dl" title="5 K" href="//dl.dafont.com/dl/?f=minecraft"  rel="nofollow">&nbsp;Download&nbsp;</a></div><div style="background-image:url(/img/preview/m/i/minecraft0.png)" class="preview"><a href="minecraft.font?af=on"></a></div>
`;

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value, 0);
  return bytes;
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
}

function buildStoredZip(filename: string, bytes: Buffer): Buffer {
  const name = Buffer.from(filename, "utf8");
  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(bytes.length),
    u32(bytes.length),
    u16(name.length),
    u16(0),
    name
  ]);
  const localOffset = 0;
  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(bytes.length),
    u32(bytes.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(localOffset),
    name
  ]);
  const centralOffset = localHeader.length + bytes.length;
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralHeader.length),
    u32(centralOffset),
    u16(0)
  ]);
  return Buffer.concat([localHeader, bytes, centralHeader, end]);
}

describe("dafont", () => {
  const originalFetch = globalThis.fetch;
  let tempDir = "";

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("parses bitmap listing entries", () => {
    const page = parseDaFontBitmapPage(SAMPLE_HTML, 1);
    expect(page.page).toBe(1);
    expect(page.totalPages).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.entries[0]).toMatchObject({
      name: "Minecraft",
      author: "Craftron Gaming",
      pixelSize: 16,
      licenseCategory: "100% Free",
      detailUrl: "https://www.dafont.com/minecraft.font?af=on",
      downloadUrl: "https://dl.dafont.com/dl/?f=minecraft",
      previewUrl: "https://www.dafont.com/img/preview/m/i/minecraft0.png"
    });
  });

  it("fetches parsed bitmap pages through live helper", async () => {
    globalThis.fetch = vi.fn(async () => new Response(SAMPLE_HTML, { status: 200 })) as typeof fetch;
    const page = await fetchDaFontPage(1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.name).toBe("Minecraft");
  });

  it("imports zip downloads and whitelists declared multiples", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "dafont-test-"));
    const storage = new ProjectStorage(tempDir);
    const fontBytes = Buffer.from(FONT_BINARY_BASE64["px-sans"].regular, "base64");
    const zipBytes = buildStoredZip("Minecraft.ttf", fontBytes);
    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(zipBytes), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": "attachment; filename=minecraft.zip"
      }
    })) as typeof fetch;
    const imported = await importDaFontFont(storage, {
      name: "Minecraft",
      detailUrl: "https://www.dafont.com/minecraft.font?af=on",
      downloadUrl: "https://dl.dafont.com/dl/?f=minecraft",
      previewUrl: "https://www.dafont.com/img/preview/m/i/minecraft0.png",
      pixelSize: 16,
      licenseCategory: "100% Free"
    });
    expect(imported?.importSource).toBe("dafont");
    expect(imported?.allowedPixelSizes?.slice(0, 4)).toEqual([16, 32, 48, 64]);
    expect(imported?.declaredPixelSize).toBe(16);
    expect(imported?.licenseCategory).toBe("100% Free");
  });
});
