import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenEpaperLinkAccessPointClient } from "./openepaperlink.js";

describe("openepaperlink access point integration", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://192.168.1.170/get_db?pos=0") {
        return new Response(
          JSON.stringify({
            tags: [
              {
                mac: "00000219BC483B18",
                alias: "Garage",
                hwType: 1,
                contentMode: 12
              }
            ]
          }),
          { status: 200 }
        );
      }
      if (url === "http://192.168.1.170/tagtypes/01.json") {
        return new Response(
          JSON.stringify({
            name: "M2 2.9\"",
            width: 296,
            height: 128,
            colortable: {
              white: [255, 255, 255],
              black: [0, 0, 0],
              red: [255, 0, 0]
            }
          }),
          { status: 200 }
        );
      }
      if (url === "http://192.168.1.170/imgupload") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeInstanceOf(FormData);
        const form = init?.body as FormData;
        expect(form.get("contentmode")).toBe("25");
        expect(form.get("dither")).toBe("2");
        expect(form.get("ttl")).toBe("1");
        expect(form.get("lut")).toBe("0");
        return new Response("ok", { status: 200 });
      }
      throw new Error(`Unhandled fetch ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("discovers access point tags and derives display types", async () => {
    const client = new OpenEpaperLinkAccessPointClient();
    const candidates = await client.discoverDisplays({ url: "http://192.168.1.170" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      providerKind: "openepaperlink-ap",
      providerRef: "00000219BC483B18",
      discoverySource: "access-point"
    });
    expect(candidates[0]?.suggestedDisplayType).toMatchObject({
      width: 296,
      height: 128,
      palette: { bg: "#ffffff", fg: "#000000", accent: "#ff0000" }
    });
  });

  it("uploads rendered images directly to imgupload", async () => {
    const client = new OpenEpaperLinkAccessPointClient();
    await expect(
      client.uploadImage(
        { url: "http://192.168.1.170" },
        "00000219BC483B18",
        new Uint8Array([1, 2, 3, 4]),
        "preview.png"
      )
    ).resolves.toBeUndefined();
  });

  it("serializes uploads and waits for cooldown before next upload", async () => {
    vi.useFakeTimers();
    let firstUploadResolved = false;
    let secondUploadStarted = false;
    let resolveFirstUpload: (() => void) | undefined;

    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url !== "http://192.168.1.170/imgupload") {
        throw new Error(`Unhandled fetch ${url}`);
      }
      const form = init?.body as FormData;
      const mac = form.get("mac");
      if (mac === "first") {
        return new Promise<Response>((resolve) => {
          resolveFirstUpload = () => {
            firstUploadResolved = true;
            resolve(new Response("ok", { status: 200 }));
          };
        });
      }
      secondUploadStarted = true;
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as typeof fetch;

    const client = new OpenEpaperLinkAccessPointClient();
    const first = client.uploadImage({ url: "http://192.168.1.170" }, "first", new Uint8Array([1]), "a.png");
    const second = client.uploadImage({ url: "http://192.168.1.170" }, "second", new Uint8Array([2]), "b.png");

    await vi.advanceTimersByTimeAsync(10);
    expect(secondUploadStarted).toBe(false);

    resolveFirstUpload?.();
    await first;
    expect(firstUploadResolved).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(secondUploadStarted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(secondUploadStarted).toBe(true);
  });
});
