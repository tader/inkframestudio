import { describe, expect, it } from "vitest";
import { applyScopeTemplate, evaluateArrayExpression } from "./layout-meta.js";

describe("layout meta templates", () => {
  it("formats ISO event times with template filters", () => {
    expect(
      applyScopeTemplate('{{ event.start | format("dddd HH:MM") }} {{ event.summary }}', {
        event: {
          start: "2026-04-17T09:05:00+02:00",
          summary: "Standup"
        }
      })
    ).toBe("Friday 09:05 Standup");
  });

  it("formats object-backed date values with template filters", () => {
    expect(
      applyScopeTemplate('{{ event.start | format("HH:MM") }}', {
        event: {
          start: { dateTime: "2026-04-17T09:05:00+02:00" }
        }
      })
    ).toBe("09:05");
  });

  it("formats plain date strings with weekday tokens", () => {
    expect(
      applyScopeTemplate('{{ date | format("dddd") }}', {
        date: "2026-04-23"
      })
    ).toBe("Thursday");
  });

  it("formats month names and year with dateformat-style tokens", () => {
    expect(
      applyScopeTemplate('{{ date | format("d mmmm yyyy") }}', {
        date: "2026-04-23"
      })
    ).toBe("23 April 2026");
  });

  it("formats localized names with template locale", () => {
    expect(
      applyScopeTemplate('{{ date | format("dddd d mmmm yyyy") }}', {
        date: "2026-04-23"
      }, { locale: "nl-NL" })
    ).toBe("donderdag 23 april 2026");
  });

  it("returns object keys from the keys filter", () => {
    expect(
      applyScopeTemplate("{{ event | keys | to_json }}", {
        event: {
          start: "2026-04-17T09:05:00+02:00",
          summary: "Standup"
        }
      })
    ).toBe('["start","summary"]');
  });

  it("serializes values with the to_json filter", () => {
    expect(
      applyScopeTemplate("{{ event | to_json }}", {
        event: {
          start: "2026-04-17T09:05:00+02:00",
          summary: "Standup"
        }
      })
    ).toBe('{"start":"2026-04-17T09:05:00+02:00","summary":"Standup"}');
  });

  it("counts arrays, objects, and nulls", () => {
    expect(
      applyScopeTemplate("{{ events | count }} {{ event | count }} {{ missing | count }}", {
        events: [{ summary: "A" }, { summary: "B" }],
        event: { summary: "A", start: "2026-04-17T09:05:00+02:00" }
      })
    ).toBe("2 2 0");
  });

  it("applies string case filters to scope values", () => {
    expect(
      applyScopeTemplate('{{ label | title }} {{ label | upcase }} {{ label | downcase }}', {
        label: "donderdag middag"
      }, { locale: "nl-NL" })
    ).toBe("Donderdag Middag DONDERDAG MIDDAG donderdag middag");
  });

  it("applies string case filters to literal expressions", () => {
    expect(
      applyScopeTemplate('{{ "donderdag middag" | title }}', {}, { locale: "nl-NL" })
    ).toBe("Donderdag Middag");
  });

  it("keeps dotted lookups working without filters", () => {
    expect(
      applyScopeTemplate("{{events.0.summary}}", {
        events: [{ summary: "Scoped Event" }]
      })
    ).toBe("Scoped Event");
  });

  it("evaluates static array literals with unquoted object keys", () => {
    expect(
      evaluateArrayExpression('[{summary: "Foobar"}]', {})
    ).toEqual([{ summary: "Foobar" }]);
  });

  it("filters arrays with pipeline item expressions", () => {
    expect(
      evaluateArrayExpression('events | filter($.summary != "Blocked")', {
        events: [{ summary: "Blocked" }, { summary: "Standup" }]
      })
    ).toEqual([{ summary: "Standup" }]);
  });

  it("deduplicates arrays by multiple field expressions", () => {
    expect(
      evaluateArrayExpression("events | unique($.start, $.summary)", {
        events: [
          { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
          { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
          { start: "2026-04-17T10:00:00.000Z", summary: "Standup" }
        ]
      })
    ).toEqual([
      { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
      { start: "2026-04-17T10:00:00.000Z", summary: "Standup" }
    ]);
  });

  it("deduplicates arrays by template keys", () => {
    expect(
      evaluateArrayExpression(
        `events | unique_by('{{ $.start | format("HH:MM") }}--{{ $.summary }}')`,
        {
          events: [
            { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
            { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
            { start: "2026-04-17T10:00:00.000Z", summary: "Standup" }
          ]
        }
      )
    ).toEqual([
      { start: "2026-04-17T09:00:00.000Z", summary: "Standup" },
      { start: "2026-04-17T10:00:00.000Z", summary: "Standup" }
    ]);
  });
});
