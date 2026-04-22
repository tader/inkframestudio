import { spawn } from "node:child_process";

const JPEG_ENCODER = `
from PIL import Image
import io
import sys

width = int(sys.argv[1])
height = int(sys.argv[2])
rgba = sys.stdin.buffer.read()
image = Image.frombytes("RGBA", (width, height), rgba)
rgb = image.convert("RGB")
rgb.save(
    sys.stdout.buffer,
    format="JPEG",
    quality=100,
    subsampling=0,
    progressive=False,
    optimize=False
)
`.trim();

export async function rgbaToJpegBuffer(
  width: number,
  height: number,
  rgba: Uint8ClampedArray
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const process = spawn("python3", ["-c", JPEG_ENCODER, String(width), String(height)], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    process.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    process.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    process.on("error", (error) => {
      reject(error);
    });

    process.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `JPEG encoding failed with code ${code}${stderrChunks.length ? `: ${Buffer.concat(stderrChunks).toString("utf8").trim()}` : ""}`
          )
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });

    process.stdin.end(Buffer.from(rgba));
  });
}
