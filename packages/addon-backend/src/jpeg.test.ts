import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { rgbaToJpegBuffer } from "./jpeg.js";

const INSPECT_JPEG = `
from PIL import Image, JpegImagePlugin
import json
import io
import sys

image = Image.open(io.BytesIO(sys.stdin.buffer.read()))
print(json.dumps({
    "format": image.format,
    "width": image.width,
    "height": image.height,
    "progressive": bool(image.info.get("progressive") or image.info.get("progression")),
    "sampling": JpegImagePlugin.get_sampling(image),
}))
`.trim();

describe("jpeg encoder", () => {
  it("encodes baseline jpeg with exact dimensions and 4:4:4 sampling", async () => {
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 0, 0, 255,
      255, 255, 255, 255
    ]);

    const jpeg = await rgbaToJpegBuffer(2, 2, rgba);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);

    const inspected = JSON.parse(
      execFileSync("python3", ["-c", INSPECT_JPEG], { input: jpeg, encoding: "utf8" })
    ) as {
      format: string;
      width: number;
      height: number;
      progressive: boolean;
      sampling: number;
    };

    expect(inspected).toEqual({
      format: "JPEG",
      width: 2,
      height: 2,
      progressive: false,
      sampling: 0
    });
  });
});
