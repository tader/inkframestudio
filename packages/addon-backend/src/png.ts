import { PNG } from "pngjs";

export function rgbaToPngBuffer(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}
