import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeAssistantConnectionSettings } from "../../render-core/src/types.js";
import { FONT_BINARY_BASE64 } from "../../render-core/src/generated-font-data.js";
import { SAMPLE_PROJECT } from "../../render-core/src/sample-project.js";
import { HomeAssistantClient } from "./home-assistant.js";
import { ProjectStorage } from "./storage.js";

describe("home assistant integration", () => {
  let tempDir = "";
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "oel-codex-"));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("round-trips saved home assistant settings", async () => {
    const storage = new ProjectStorage(tempDir);
    const settings: HomeAssistantConnectionSettings = {
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    };
    await storage.saveHomeAssistantSettings(settings);
    await expect(storage.getHomeAssistantSettings()).resolves.toEqual(settings);
  });

  it("round-trips saved access point settings without losing home assistant settings", async () => {
    const storage = new ProjectStorage(tempDir);
    await storage.saveHomeAssistantSettings({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });
    await storage.saveOpenEpaperLinkAccessPointSettings({
      url: "http://192.168.1.170"
    });

    await expect(storage.getOpenEpaperLinkAccessPointSettings()).resolves.toEqual({
      url: "http://192.168.1.170"
    });
    await expect(storage.getHomeAssistantSettings()).resolves.toEqual({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });
  });

  it("rescans font dir and preserves allowed pixel sizes metadata", async () => {
    const storage = new ProjectStorage(tempDir);
    await storage.saveStoredFont(
      "px-sans",
      "PX Sans",
      "regular",
      "px-sans-regular.ttf",
      Buffer.from(FONT_BINARY_BASE64["px-sans"].regular, "base64")
    );
    await storage.updateStoredFontMetadata("px-sans", { allowedPixelSizes: [8, 10, 12] });

    const rebuilt = await storage.rebuildStoredFontIndex();
    expect(rebuilt[0]?.allowedPixelSizes).toEqual([8, 10, 12]);

    const options = await storage.listFontOptions();
    expect(options[0]?.allowedPixelSizes).toEqual([8, 10, 12]);
  });

  it("tests a successful custom connection", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ version: "2026.4.0" }), { status: 200 })
    ) as typeof fetch;

    const result = await client.testConnection({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe("2026.4.0");
  });

  it("reports invalid token failures", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async () => new Response("forbidden", { status: 403 })) as typeof fetch;

    const result = await client.testConnection({
      host: "https://ha.local",
      token: "bad-token",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(result.ok).toBe(false);
    expect(result.authError).toBe(true);
  });

  it("reports unreachable host failures", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }) as typeof fetch;

    const result = await client.testConnection({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(result.ok).toBe(false);
    expect(result.networkError).toBe(true);
  });

  it("explains self-signed certificate failures", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async () => {
      const error = new TypeError("fetch failed") as TypeError & { cause?: { code?: string } };
      error.cause = { code: "SELF_SIGNED_CERT_IN_CHAIN" };
      throw error;
    }) as typeof fetch;

    const result = await client.testConnection({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Allow insecure TLS");
  });

  it("uses the correct base url for custom mode", async () => {
    const client = new HomeAssistantClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({ version: "2026.4.0" }), { status: 200 })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await client.testConnection({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://ha.local/api/config");
  });

  it("returns unknown-state data when no connection is configured", async () => {
    const client = new HomeAssistantClient();
    const data = await client.resolveProjectData(SAMPLE_PROJECT, {
      host: "",
      token: "",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });
    expect(data.entities["cover.garage_door"]).toBeUndefined();
    expect(data.queries["agenda-today"]?.items).toEqual([]);
  });

  it("returns no entity catalog entries when no connection is configured", async () => {
    const client = new HomeAssistantClient();
    await expect(client.listEntities({
      host: "",
      token: "",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    })).resolves.toEqual([]);
  });

  it("lists entity catalog entries from configured Home Assistant", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            entity_id: "sensor.office_temperature",
            attributes: {
              friendly_name: "Office Temperature",
              unit_of_measurement: "C"
            }
          },
          {
            entity_id: "cover.garage_door",
            attributes: {
              friendly_name: "Garage Door"
            }
          }
        ]),
        { status: 200 }
      )
    ) as typeof fetch;

    const entries = await client.listEntities({
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(entries).toEqual([
      {
        entityId: "cover.garage_door",
        friendlyName: "Garage Door",
        domain: "cover"
      },
      {
        entityId: "sensor.office_temperature",
        friendlyName: "Office Temperature",
        domain: "sensor",
        unit: "C"
      }
    ]);
  });

  it("keeps entity data when one query returns 400", async () => {
    const client = new HomeAssistantClient();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/states")) {
        return new Response(
          JSON.stringify([
            {
              entity_id: "cover.garage_door",
              state: "closed",
              attributes: { friendly_name: "Garage Door" },
              last_changed: "2026-04-17T14:20:00.000Z"
            }
          ]),
          { status: 200 }
        );
      }
      if (url.includes("/api/calendars/")) {
        return new Response("bad calendar request", { status: 400 });
      }
      if (url.includes("/api/history/period/")) {
        return new Response("bad history request", { status: 400 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }) as typeof fetch;

    const data = await client.resolveProjectData(SAMPLE_PROJECT, {
      host: "https://ha.local",
      token: "abc123",
      mode: "custom",
      useSupervisorProxy: false,
      allowInsecureTls: false
    });

    expect(data.entities["cover.garage_door"]?.state).toBe("closed");
    expect(data.queries["agenda-today"]?.items).toEqual([]);
    expect(data.queries["garage-temp-history"]?.points).toEqual([]);
  });

  it("resolves and normalizes multi-calendar meta queries while isolating one failing calendar", async () => {
    const client = new HomeAssistantClient();
    const project = {
      ...SAMPLE_PROJECT,
      queries: [],
      layoutDefinitions: [{
        id: "layout-meta-query",
        name: "Meta Query",
        kind: "fullscreen" as const,
        displayTypeId: "tri296x128-red",
        rootNode: {
          id: "meta-events",
          type: "data_query" as const,
          queryKind: "calendar_events" as const,
          variableName: "events",
          dateVariableName: "date",
          calendarEntityIds: ["calendar.family", "calendar.work", "calendar.broken"],
          offsetDays: 0,
          child: {
            id: "meta-child",
            type: "spacer" as const
          }
        }
      }]
    };

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/states")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/calendars/calendar.family")) {
        return new Response(JSON.stringify([
          {
            summary: "Family Lunch",
            start: { dateTime: "2026-04-17T12:00:00.000Z" },
            end: { dateTime: "2026-04-17T13:00:00.000Z" }
          }
        ]), { status: 200 });
      }
      if (url.includes("/api/calendars/calendar.work")) {
        return new Response(JSON.stringify([
          {
            summary: "All Day Planning",
            start: "2026-04-17",
            end: "2026-04-18"
          },
          {
            summary: "Review",
            start: "2026-04-17T09:00:00.000Z",
            end: "2026-04-17T09:30:00.000Z",
            location: "Studio"
          }
        ]), { status: 200 });
      }
      if (url.includes("/api/calendars/calendar.broken")) {
        return new Response("broken", { status: 500 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }) as typeof fetch;

    vi.useFakeTimers();
    let data;
    try {
      vi.setSystemTime(new Date("2026-04-17T12:34:00.000Z"));
      data = await client.resolveProjectData(project, {
        host: "https://ha.local",
        token: "abc123",
        mode: "custom",
        useSupervisorProxy: false,
        allowInsecureTls: false
      });
    } finally {
      vi.useRealTimers();
    }

    const events = data.metaQueries?.["meta-events"]?.items as Array<Record<string, unknown>>;
    expect(events).toHaveLength(3);
    expect(events.map((event) => `${event.start}:${event.summary}`)).toEqual([
      "2026-04-17:All Day Planning",
      "2026-04-17T09:00:00.000Z:Review",
      "2026-04-17T12:00:00.000Z:Family Lunch"
    ]);
    expect(events[0]?.allDay).toBe(true);
    expect(events[0]?.allday).toBe(true);
    expect(events[1]?.calendarEntityId).toBe("calendar.work");
    expect(events[1]?.raw).toEqual({
      summary: "Review",
      start: "2026-04-17T09:00:00.000Z",
      end: "2026-04-17T09:30:00.000Z",
      location: "Studio"
    });
    expect(events[2]?.raw).toEqual({
      summary: "Family Lunch",
      start: { dateTime: "2026-04-17T12:00:00.000Z" },
      end: { dateTime: "2026-04-17T13:00:00.000Z" }
    });
    expect(data.metaQueries?.["meta-events"]?.meta).toMatchObject({
      date: "2026-04-17",
      dateVariableName: "date",
      offsetDays: 0
    });
  });

  it("anchors meta query offsets relative to local midnight with day offsets", async () => {
    const client = new HomeAssistantClient();
    const project = {
      ...SAMPLE_PROJECT,
      queries: [],
      layoutDefinitions: [{
        id: "layout-meta-offsets",
        name: "Meta Offsets",
        kind: "fullscreen" as const,
        displayTypeId: "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack" as const,
          axis: "vertical" as const,
          children: [
            {
              id: "offset-yesterday",
              type: "data_query" as const,
              queryKind: "calendar_events" as const,
              variableName: "yesterdayEvents",
              calendarEntityIds: ["calendar.family"],
              offsetDays: -1,
              child: { id: "child-yesterday", type: "spacer" as const }
            },
            {
              id: "offset-today",
              type: "data_query" as const,
              queryKind: "calendar_events" as const,
              variableName: "todayEvents",
              calendarEntityIds: ["calendar.family"],
              offsetDays: 0,
              child: { id: "child-today", type: "spacer" as const }
            },
            {
              id: "offset-tomorrow",
              type: "data_query" as const,
              queryKind: "calendar_events" as const,
              variableName: "tomorrowEvents",
              calendarEntityIds: ["calendar.family"],
              offsetDays: 1,
              child: { id: "child-tomorrow", type: "spacer" as const }
            }
          ]
        }
      }]
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/states")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/calendars/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-17T12:34:00.000Z"));
      await client.resolveProjectData(project, {
        host: "https://ha.local",
        token: "abc123",
        mode: "custom",
        useSupervisorProxy: false,
        allowInsecureTls: false
      });
    } finally {
      vi.useRealTimers();
    }

    const starts = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/calendars/"))
      .map((url) => new URL(url).searchParams.get("start"))
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .sort((left, right) => left - right);

    expect(starts).toHaveLength(3);
    expect(starts[1] - starts[0]).toBe(24 * 60 * 60 * 1000);
    expect(starts[2] - starts[1]).toBe(24 * 60 * 60 * 1000);
  });

  it("advances the day offset after the configured rollover time", async () => {
    const client = new HomeAssistantClient();
    const project = {
      ...SAMPLE_PROJECT,
      queries: [],
      layoutDefinitions: [{
        id: "layout-meta-rollover",
        name: "Meta Rollover",
        kind: "fullscreen" as const,
        displayTypeId: "tri296x128-red",
        rootNode: {
          id: "root",
          type: "stack" as const,
          axis: "vertical" as const,
          children: [
            {
              id: "today-base",
              type: "data_query" as const,
              queryKind: "calendar_events" as const,
              variableName: "todayEvents",
              calendarEntityIds: ["calendar.family"],
              offsetDays: 0,
              child: { id: "child-today", type: "spacer" as const }
            },
            {
              id: "today-rollover",
              type: "data_query" as const,
              queryKind: "calendar_events" as const,
              variableName: "rolloverEvents",
              dateVariableName: "date",
              calendarEntityIds: ["calendar.family"],
              offsetDays: 0,
              rolloverTime: "00:00",
              child: { id: "child-rollover", type: "spacer" as const }
            }
          ]
        }
      }]
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/states")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/calendars/")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-17T12:34:00.000Z"));
      const data = await client.resolveProjectData(project, {
        host: "https://ha.local",
        token: "abc123",
        mode: "custom",
        useSupervisorProxy: false,
        allowInsecureTls: false
      });
      expect(data.metaQueries?.["today-base"]?.meta).toMatchObject({
        date: "2026-04-17",
        effectiveOffsetDays: 0
      });
      expect(data.metaQueries?.["today-rollover"]?.meta).toMatchObject({
        date: "2026-04-18",
        effectiveOffsetDays: 1,
        rolloverTime: "00:00"
      });
    } finally {
      vi.useRealTimers();
    }

    const starts = fetchMock.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/api/calendars/"))
      .map((url) => new URL(url).searchParams.get("start"))
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .sort((left, right) => left - right);

    expect(starts).toHaveLength(2);
    expect(starts[1] - starts[0]).toBe(24 * 60 * 60 * 1000);
  });
});
