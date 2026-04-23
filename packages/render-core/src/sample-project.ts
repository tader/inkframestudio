import { DEFAULT_WIDGET_THEMES } from "./themes.js";
import { DEFAULT_FONT_PRESETS } from "./font-presets.js";
import type { Project, RenderData } from "./types.js";

export const SAMPLE_CALENDAR_EVENTS_BY_ENTITY: Record<string, Array<Record<string, unknown>>> = {
  "calendar.family": [
    {
      summary: "Dentist",
      start: "2026-04-17T15:00:00.000Z",
      end: "2026-04-17T16:00:00.000Z"
    },
    {
      summary: "Hockey Training",
      start: "2026-04-17T17:15:00.000Z",
      end: "2026-04-17T18:30:00.000Z"
    },
    {
      summary: "Take Bins Out",
      start: "2026-04-17T20:00:00.000Z",
      end: "2026-04-17T20:10:00.000Z"
    }
  ],
  "calendar.work": [
    {
      summary: "Architecture Review",
      start: "2026-04-17T09:30:00.000Z",
      end: "2026-04-17T10:00:00.000Z",
      location: "Studio"
    },
    {
      summary: "Ship Calendar Meta Nodes",
      start: "2026-04-17T00:00:00.000Z",
      end: "2026-04-18T00:00:00.000Z",
      description: "All-day sample event"
    }
  ]
};

export const SAMPLE_PROJECT: Project = {
  id: "demo-home",
  name: "Home Demo",
  version: 1,
  locale: "en-US",
  fontPresets: DEFAULT_FONT_PRESETS,
  themes: DEFAULT_WIDGET_THEMES,
  queries: [
    {
      id: "agenda-today",
      kind: "calendar_range",
      params: { entityId: "calendar.family", range: "today" },
      refreshPolicy: { mode: "poll", intervalSeconds: 120 }
    },
    {
      id: "garage-temp-history",
      kind: "history_range",
      params: { entityId: "sensor.garage_temperature", hours: 12 },
      refreshPolicy: { mode: "poll", intervalSeconds: 300 }
    }
  ],
  screens: [
    {
      id: "calendar-main-296",
      name: "Calendar Main 296",
      displayProfileId: "tri296x128-red",
      default: true,
      widgetThemeId: "classic-outline",
      baseWidgetIds: ["agenda-main", "datetime-main", "status-main"],
      overlayIds: ["garage-warning-overlay"],
      rules: [
        {
          id: "overlay-garage-warning",
          scope: "overlay_activation",
          priority: 100,
          condition: {
            kind: "entity_duration_ge",
            entityId: "cover.garage_door",
            state: "open",
            minutes: 15
          },
          action: { type: "activate_overlay", overlayId: "garage-warning-overlay" }
        }
      ]
    },
    {
      id: "calendar-empty-296",
      name: "Calendar Empty 296",
      displayProfileId: "tri296x128-red",
      default: false,
      widgetThemeId: "accent-header",
      baseWidgetIds: ["empty-banner", "datetime-main"],
      overlayIds: [],
      rules: [
        {
          id: "show-empty-calendar",
          scope: "screen_activation",
          priority: 50,
          condition: { kind: "query_empty", queryId: "agenda-today" },
          action: { type: "activate_screen", screenId: "calendar-empty-296" }
        }
      ]
    },
    {
      id: "overview-400",
      name: "Overview 400",
      displayProfileId: "tri400x300-red",
      default: true,
      widgetThemeId: "classic-outline",
      baseWidgetIds: ["agenda-large", "garage-state-large", "history-large"],
      overlayIds: [],
      rules: []
    }
  ],
  overlays: [
    {
      id: "garage-warning-overlay",
      name: "Garage Warning",
      screenId: "calendar-main-296",
      frame: { x: 4, y: 4, w: 28, h: 8 },
      widgetIds: ["garage-warning-widget"],
      priority: 100
    }
  ],
  widgets: [
    {
      id: "agenda-main",
      type: "agenda_list",
      screenId: "calendar-main-296",
      frame: { x: 0, y: 0, w: 25, h: 12 },
      bindings: { query: "agenda-today" },
      props: { title: "TODAY", maxItems: 4, emptyText: "NO EVENTS" }
    },
    {
      id: "datetime-main",
      type: "date_time_compact",
      screenId: "calendar-main-296",
      frame: { x: 25, y: 0, w: 12, h: 6 },
      bindings: {},
      props: {}
    },
    {
      id: "status-main",
      type: "status_strip",
      screenId: "calendar-main-296",
      frame: { x: 0, y: 14, w: 37, h: 2 },
      bindings: {},
      props: {
        items: [
          { label: "GARAGE", color: "accent" },
          { label: "TEMP 21C" },
          { label: "RH 49%" }
        ]
      }
    },
    {
      id: "empty-banner",
      type: "alert_banner",
      screenId: "calendar-empty-296",
      frame: { x: 3, y: 4, w: 30, h: 7 },
      bindings: {},
      props: { headline: "NO EVENTS", detail: "SHOW PRICE OR CLOCK HERE" }
    },
    {
      id: "garage-warning-widget",
      type: "alert_banner",
      overlayId: "garage-warning-overlay",
      frame: { x: 1, y: 1, w: 26, h: 6 },
      bindings: {},
      props: { headline: "GARAGE OPEN", detail: "OPEN FOR 15+ MIN" }
    },
    {
      id: "agenda-large",
      type: "agenda_list",
      screenId: "overview-400",
      frame: { x: 0, y: 0, w: 20, h: 14 },
      bindings: { query: "agenda-today" },
      props: { title: "AGENDA", maxItems: 6, emptyText: "FREE DAY" }
    },
    {
      id: "garage-state-large",
      type: "state_tile",
      screenId: "overview-400",
      frame: { x: 21, y: 0, w: 18, h: 12 },
      bindings: { entity: "cover.garage_door" },
      props: { label: "GARAGE", icon: "garage", showDuration: true }
    },
    {
      id: "history-large",
      type: "history_bars",
      screenId: "overview-400",
      frame: { x: 0, y: 16, w: 39, h: 10 },
      bindings: { query: "garage-temp-history" },
      props: { title: "GARAGE TREND" }
    }
  ],
  scenarios: [
    {
      id: "garage-warning-demo",
      name: "Garage Warning",
      frozenNow: "2026-04-17T14:32:00.000Z",
      entityOverrides: {
        "cover.garage_door": {
          entityId: "cover.garage_door",
          state: "open",
          attributes: {},
          lastChanged: "2026-04-17T14:10:00.000Z"
        }
      }
    },
    {
      id: "empty-calendar-demo",
      name: "Empty Calendar",
      frozenNow: "2026-04-17T08:00:00.000Z",
      queryOverrides: {
        "agenda-today": {
          kind: "calendar_range",
          items: []
        }
      }
    }
  ]
};

export const SAMPLE_DATA: RenderData = {
  now: "2026-04-17T14:32:00.000Z",
  entities: {
    "cover.garage_door": {
      entityId: "cover.garage_door",
      state: "closed",
      attributes: {},
      lastChanged: "2026-04-17T14:20:00.000Z"
    },
    "sensor.office_temperature": {
      entityId: "sensor.office_temperature",
      state: "21.2",
      attributes: { unit_of_measurement: "C", value: 21.2 },
      lastChanged: "2026-04-17T14:30:00.000Z"
    }
  },
  queries: {
    "agenda-today": {
      kind: "calendar_range",
      items: [
        { start: "2026-04-17T15:00:00.000Z", summary: "Dentist" },
        { start: "2026-04-17T17:15:00.000Z", summary: "Hockey Training" },
        { start: "2026-04-17T20:00:00.000Z", summary: "Take Bins Out" }
      ]
    },
    "garage-temp-history": {
      kind: "history_range",
      points: [
        { timestamp: "2026-04-17T02:00:00.000Z", value: 13.5 },
        { timestamp: "2026-04-17T04:00:00.000Z", value: 13.7 },
        { timestamp: "2026-04-17T06:00:00.000Z", value: 14.0 },
        { timestamp: "2026-04-17T08:00:00.000Z", value: 14.2 },
        { timestamp: "2026-04-17T10:00:00.000Z", value: 14.1 },
        { timestamp: "2026-04-17T12:00:00.000Z", value: 14.4 },
        { timestamp: "2026-04-17T14:00:00.000Z", value: 14.6 }
      ]
    }
  }
};
