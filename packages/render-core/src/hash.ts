function toBytes(part: string | ArrayBufferView): Uint8Array {
  if (typeof part === "string") {
    return new TextEncoder().encode(part);
  }
  return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
}

export function createStableHash(parts: Array<string | ArrayBufferView>): string {
  const seeds = new Uint32Array([
    0x811c9dc5,
    0x811c9dc5 ^ 0x9e3779b9,
    0x811c9dc5 ^ 0x85ebca6b,
    0x811c9dc5 ^ 0xc2b2ae35,
    0x811c9dc5 ^ 0x27d4eb2f,
    0x811c9dc5 ^ 0x165667b1,
    0x811c9dc5 ^ 0xd3a2646c,
    0x811c9dc5 ^ 0xfd7046c5
  ]);
  for (const part of parts) {
    const bytes = toBytes(part);
    for (let index = 0; index < bytes.length; index += 1) {
      const value = bytes[index] ?? 0;
      for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
        let hash = seeds[seedIndex] ^ (value + seedIndex * 17);
        hash = Math.imul(hash, 0x01000193);
        hash ^= hash >>> 13;
        hash = Math.imul(hash, 0x85ebca6b);
        seeds[seedIndex] = hash >>> 0;
      }
    }
  }
  return Array.from(seeds)
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}
