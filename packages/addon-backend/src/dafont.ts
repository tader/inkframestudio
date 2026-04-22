import * as fontkit from "fontkit";
import { inflateRawSync } from "node:zlib";
import type { FontOption, FontVariantKey } from "../../render-core/src/types.js";
import { ProjectStorage } from "./storage.js";

export interface DaFontListingEntry {
  id: string;
  name: string;
  author?: string;
  detailUrl: string;
  downloadUrl: string;
  previewUrl: string;
  pixelSize?: number;
  licenseCategory?: string;
  downloadSizeLabel?: string;
}

export interface DaFontPageResult {
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  entries: DaFontListingEntry[];
}

interface ZipEntry {
  filename: string;
  bytes: Buffer;
}

interface ImportableFontFile {
  filename: string;
  bytes: Buffer;
  familyLabel: string;
  variant: FontVariantKey;
  rank: number;
}

const DAFONT_BASE_URL = "https://www.dafont.com";
const DAFONT_BITMAP_URL = `${DAFONT_BASE_URL}/bitmap.php`;
const DOWNLOAD_HOSTS = new Set(["dafont.com", "www.dafont.com", "dl.dafont.com"]);
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff2", ".woff"];
const FONT_TYPE_RANK: Record<string, number> = {
  ".ttf": 0,
  ".otf": 1,
  ".woff2": 2,
  ".woff": 3
};

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&agrave;/g, "à")
    .replace(/&euro;/g, "€")
    .replace(/&ccedil;/g, "ç")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü");
}

function normalizeWhitespace(value: string): string {
  return decodeHtml(stripTags(value)).replace(/\s+/g, " ").trim();
}

function absoluteDaFontUrl(value: string): string {
  if (!value) {
    return "";
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return new URL(value, DAFONT_BASE_URL).toString();
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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

function buildAllowedSizes(baseSize: number | undefined): number[] | undefined {
  if (!baseSize || !Number.isFinite(baseSize) || baseSize < 1) {
    return undefined;
  }
  const values: number[] = [];
  for (let size = baseSize; size <= 200; size += baseSize) {
    values.push(size);
  }
  return values;
}

function parsePixelSize(html: string): number | undefined {
  const match = html.match(/\((\d+)\s*px\)/i);
  return match ? Number(match[1]) : undefined;
}

function parseDownloadSizeLabel(html: string): string | undefined {
  const match = html.match(/title="([^"]+)"/i);
  return match ? normalizeWhitespace(match[1]) : undefined;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function familyMatchScore(expected: string, actual: string, filename: string): number {
  const expectedName = normalizeName(expected);
  const actualName = normalizeName(actual);
  const filenameName = normalizeName(filename.replace(/\.[^.]+$/, ""));
  if (!expectedName) {
    return 0;
  }
  if (actualName === expectedName || filenameName === expectedName) {
    return 100;
  }
  if (actualName.includes(expectedName) || expectedName.includes(actualName)) {
    return 80;
  }
  if (filenameName.includes(expectedName) || expectedName.includes(filenameName)) {
    return 75;
  }
  const expectedTokens = expected.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
  const actualTokens = actual.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
  const shared = expectedTokens.filter((token) => actualTokens.includes(token));
  return shared.length * 10;
}

function assertDaFontUrl(value: string): void {
  const url = new URL(absoluteDaFontUrl(value));
  if (!DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error(`Unsupported DaFont host: ${url.hostname}`);
  }
}

function readUInt32LE(bytes: Buffer, offset: number): number {
  return bytes.readUInt32LE(offset);
}

function readUInt16LE(bytes: Buffer, offset: number): number {
  return bytes.readUInt16LE(offset);
}

function extractZipEntries(bytes: Buffer): ZipEntry[] {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  for (let offset = Math.max(0, bytes.length - 0x10000 - 22); offset <= bytes.length - 22; offset += 1) {
    if (readUInt32LE(bytes, offset) === eocdSignature) {
      eocdOffset = offset;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("ZIP end-of-central-directory not found");
  }

  const totalEntries = readUInt16LE(bytes, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32LE(bytes, eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32LE(bytes, offset) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }
    const compressionMethod = readUInt16LE(bytes, offset + 10);
    const compressedSize = readUInt32LE(bytes, offset + 20);
    const filenameLength = readUInt16LE(bytes, offset + 28);
    const extraLength = readUInt16LE(bytes, offset + 30);
    const commentLength = readUInt16LE(bytes, offset + 32);
    const localHeaderOffset = readUInt32LE(bytes, offset + 42);
    const filename = bytes.slice(offset + 46, offset + 46 + filenameLength).toString("utf8");
    offset += 46 + filenameLength + extraLength + commentLength;

    if (filename.endsWith("/")) {
      continue;
    }
    if (readUInt32LE(bytes, localHeaderOffset) !== 0x04034b50) {
      throw new Error("Invalid ZIP local header");
    }
    const localFilenameLength = readUInt16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUInt16LE(bytes, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const fileBytes =
      compressionMethod === 0
        ? compressed
        : compressionMethod === 8
          ? inflateRawSync(compressed)
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
            })();
    entries.push({ filename, bytes: Buffer.from(fileBytes) });
  }
  return entries;
}

function collectImportableFontFiles(entries: ZipEntry[]): ImportableFontFile[] {
  return entries
    .filter((entry) => FONT_EXTENSIONS.some((extension) => entry.filename.toLowerCase().endsWith(extension)))
    .flatMap((entry) => {
      const extension = FONT_EXTENSIONS.find((candidate) => entry.filename.toLowerCase().endsWith(candidate));
      if (!extension) {
        return [];
      }
      try {
        const font = fontkit.create(entry.bytes) as unknown as { familyName?: string; subfamilyName?: string };
        return [{
          filename: entry.filename.split("/").pop() ?? entry.filename,
          bytes: entry.bytes,
          familyLabel: font.familyName ?? entry.filename.replace(/\.[^.]+$/, ""),
          variant: detectFontVariant(font.subfamilyName),
          rank: FONT_TYPE_RANK[extension]
        }];
      } catch {
        return [];
      }
    });
}

function chooseBestFamily(files: ImportableFontFile[], expectedName: string): ImportableFontFile[] {
  const groups = new Map<string, ImportableFontFile[]>();
  for (const file of files) {
    const key = normalizeWhitespace(file.familyLabel) || file.filename;
    const list = groups.get(key) ?? [];
    list.push(file);
    groups.set(key, list);
  }
  const ranked = Array.from(groups.entries())
    .map(([label, group]) => ({
      label,
      group,
      score: Math.max(...group.map((file) => familyMatchScore(expectedName, label, file.filename))),
      rank: Math.min(...group.map((file) => file.rank))
    }))
    .sort((left, right) => right.score - left.score || left.rank - right.rank || left.label.localeCompare(right.label));
  return ranked[0]?.group ?? [];
}

function chooseBestVariants(files: ImportableFontFile[]): ImportableFontFile[] {
  const byVariant = new Map<FontVariantKey, ImportableFontFile>();
  for (const file of files) {
    const existing = byVariant.get(file.variant);
    if (!existing || file.rank < existing.rank) {
      byVariant.set(file.variant, file);
    }
  }
  return Array.from(byVariant.values());
}

async function bytesFromResponse(response: Response): Promise<Buffer> {
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function parseDaFontBitmapPage(html: string, page: number): DaFontPageResult {
  const entries: DaFontListingEntry[] = [];
  const entryPattern =
    /<a name="[^"]*"><\/a><div class="lv1left dfbg">([\s\S]*?)<\/div><div class="lv1right dfbg">([\s\S]*?)<\/div><div class="lv2right">([\s\S]*?)<\/div><div class="dlbox"[\s\S]*?>([\s\S]*?)<\/div>((?:<div style="background-image:url\([^)]+\)[\s\S]*?class="preview">[\s\S]*?<\/div>)+)/gi;
  for (const match of html.matchAll(entryPattern)) {
    const leftHtml = match[1] ?? "";
    const rightHtml = match[2] ?? "";
    const metaHtml = match[3] ?? "";
    const downloadHtml = match[4] ?? "";
    const previewHtml = match[5] ?? "";
    const detailMatch = leftHtml.match(/<a href="([^"]+?\.font(?:\?[^"]*)?)"><strong>([\s\S]*?)<\/strong><\/a>/i);
    const authorMatch = leftHtml.match(/by <a [^>]*>([\s\S]*?)<\/a>/i);
    const downloadMatch = downloadHtml.match(/<a class="dl"[^>]*href="([^"]+)"/i);
    const previewMatch = previewHtml.match(/background-image:url\(([^)]+)\)/i);
    const licenseMatch = metaHtml.match(/<a[^>]*faq\.php#copyright[^>]*>([\s\S]*?)<\/a>/i);
    if (!detailMatch || !downloadMatch || !previewMatch) {
      continue;
    }
    const detailUrl = absoluteDaFontUrl(detailMatch[1]);
    const name = normalizeWhitespace(detailMatch[2]);
    const downloadUrl = absoluteDaFontUrl(downloadMatch[1]);
    const previewUrl = absoluteDaFontUrl(previewMatch[1].replace(/^['"]|['"]$/g, ""));
    const author = authorMatch ? normalizeWhitespace(authorMatch[1]) : undefined;
    const pixelSize = parsePixelSize(rightHtml);
    entries.push({
      id: safeId(name || detailUrl),
      name,
      author,
      detailUrl,
      downloadUrl,
      previewUrl,
      pixelSize,
      licenseCategory: licenseMatch ? normalizeWhitespace(licenseMatch[1]) : undefined,
      downloadSizeLabel: parseDownloadSizeLabel(downloadHtml)
    });
  }

  const pageMatches = Array.from(html.matchAll(/bitmap\.php\?page=(\d+)&af=on/gi)).map((match) => Number(match[1]));
  const totalPages = Math.max(page, ...pageMatches, 1);
  return {
    page,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
    entries
  };
}

export async function fetchDaFontPage(page = 1): Promise<DaFontPageResult> {
  const url = `${DAFONT_BITMAP_URL}?page=${Math.max(1, page)}&fpp=200&af=on`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "OpenEPaperLink Codex/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`DaFont page request failed with ${response.status}`);
  }
  return parseDaFontBitmapPage(await response.text(), Math.max(1, page));
}

export async function importDaFontFont(
  storage: ProjectStorage,
  entry: Pick<DaFontListingEntry, "name" | "downloadUrl" | "previewUrl" | "detailUrl" | "pixelSize" | "licenseCategory">
): Promise<FontOption | null> {
  assertDaFontUrl(entry.downloadUrl);
  const response = await fetch(absoluteDaFontUrl(entry.downloadUrl), {
    headers: {
      "User-Agent": "OpenEPaperLink Codex/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`DaFont download failed with ${response.status}`);
  }

  const bytes = await bytesFromResponse(response);
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const dispositionFilename = contentDisposition.match(/filename="?([^"]+)"?/i)?.[1];
  const contentType = response.headers.get("content-type") ?? "";
  const isZip =
    /\.zip$/i.test(dispositionFilename ?? "") ||
    /application\/zip/i.test(contentType) ||
    (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04);
  const files = isZip
    ? collectImportableFontFiles(extractZipEntries(bytes))
    : collectImportableFontFiles([{ filename: dispositionFilename ?? `${entry.name}.bin`, bytes }]);
  if (!files.length) {
    throw new Error("No importable font files found in DaFont download");
  }

  const chosenFamily = chooseBestFamily(files, entry.name);
  const chosenVariants = chooseBestVariants(chosenFamily);
  const familyLabel = chosenVariants[0]?.familyLabel ?? entry.name;
  const familyId = familyLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  for (const file of chosenVariants) {
    const extension = file.filename.match(/\.[^.]+$/)?.[0] ?? ".ttf";
    await storage.saveStoredFont(familyId, familyLabel, file.variant, `${familyId}-${file.variant}${extension}`, file.bytes);
  }
  const allowedPixelSizes = buildAllowedSizes(entry.pixelSize);
  await storage.updateStoredFontMetadata(familyId, {
    allowedPixelSizes,
    importSource: "dafont",
    sourceUrl: entry.detailUrl,
    previewUrl: entry.previewUrl,
    declaredPixelSize: entry.pixelSize,
    licenseCategory: entry.licenseCategory
  });
  return (await storage.listFontOptions()).find((option) => option.id === familyId) ?? null;
}
