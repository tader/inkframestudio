# Widget Set V1

This document defines the first reusable widget set for the e-paper editor and renderer.

Grid sizes below use display-profile grid units, not pixels.

## Shared Widget Rules

- Each widget should expose a `title`, optional `entity_id` or data binding, and display-specific formatting options.
- Widgets should render well on both red-accent and yellow-accent displays.
- Accent color is reserved for the most important state, current bucket, or alert condition.
- Widgets should avoid showing more precision than a human can use at a glance.

## Layout Meta Nodes

These are editor/layout helpers, not visible widgets.

### `data_query`

Purpose:
- fetch and normalize calendar events into a named scoped variable

Current query kinds:
- `calendar_events`

Rules:
- supports multiple calendar entities
- resolves a `24h` window from local midnight plus `offsetDays`
- can advance the effective day after an optional local `rolloverTime`
- exposes normalized event fields, raw payload, and a query date variable such as `date`

### `foreach`

Purpose:
- repeat one template child for items in an array variable

Rules:
- works in horizontal or vertical mode
- can limit processing with `maxItems`
- binds item alias and zero-based index alias
- skips drawing once the next item starts outside the container bounds

### `if_else`

Purpose:
- choose one branch from a small expression

Supported expression features:
- dotted paths such as `event.summary` and `event.allday`
- literals: string, number, boolean
- operators: `==`, `!=`, `>`, `>=`, `<`, `<=`, `&&`, `||`, `!`
- parentheses

## 1. `state_tile`

Purpose:
- show binary or enumerated state such as `open/closed`, `locked/unlocked`, `on/off`, `home/away`

Minimum size:
- `12x8` on `tri296x128`
- `12x10` on `tri400x300`

Contents:
- bold icon
- short label
- large state word
- optional subline such as `since 14:32` or `open 25 min`

Accent behavior:
- accent only for non-normal or user-selected priority states

Best for:
- garage door
- front door
- lock state
- alarm state
- washer done/running

## 2. `big_value`

Purpose:
- show one primary metric

Minimum size:
- `10x6`

Contents:
- small label
- very large numeric value
- small unit
- optional tiny trend arrow or status word

Formatting defaults:
- temperature: `0.5 C`
- humidity: whole percent
- battery: whole percent

Best for:
- temperature
- humidity
- current power
- outdoor air quality headline

## 3. `sensor_pair`

Purpose:
- show two tightly related values in one tile

Minimum size:
- `12x6`

Contents:
- label
- left value
- right value

Typical pairs:
- temperature and humidity
- import and export power
- current price and next-hour price

## 4. `room_list`

Purpose:
- compare multiple rooms at once

Minimum size:
- `18x10` on `tri296x128`
- `18x12` on `tri400x300`

Contents per row:
- room name
- primary value
- optional secondary value
- optional tiny state marker

Formatting rules:
- keep room names short
- align numeric columns rigidly
- prefer no icons unless they replace text cleanly

Best for:
- temp and humidity by room
- battery by device
- window or occupancy status by room

## 5. `agenda_list`

Purpose:
- show upcoming calendar events

Minimum size:
- `18x10`

Contents:
- date/day header
- 3 to 6 upcoming entries
- time column
- event title column

Accent behavior:
- current event, next event, or today's most important entry may use accent

Rules:
- truncate aggressively
- prefer start time over full ranges on small screens
- allow optional icons only on larger screens

## 6. `price_now`

Purpose:
- make the current electricity price highly glanceable

Minimum size:
- `12x8`

Contents:
- large current price
- unit
- status word such as `CHEAP`, `OK`, `HIGH`
- optional comparison to daily average

Accent behavior:
- accent for very cheap or very expensive buckets depending on user preference

## 7. `price_bars_24h`

Purpose:
- show the price shape of the day

Minimum size:
- `20x4` on `tri296x128`
- `20x6` on `tri400x300`

Contents:
- 24 fixed bars or fewer aggregated bars
- current bucket highlight
- optional marker for cheapest future block

Rules:
- use bars, not thin lines
- annotate sparingly
- pair with `price_now` for best results

## 8. `history_bars`

Purpose:
- show recent trend for any scalar metric

Minimum size:
- `12x4`

Contents:
- bar or step chart
- optional min/max labels
- optional current value callout

Best for:
- temperature trend
- humidity trend
- power use
- solar production

## 9. `word_clock`

Purpose:
- show fuzzy time in a decorative but still practical way

Minimum size:
- full screen on `tri296x128`
- at least `24x16` on `tri400x300`

Contents:
- word matrix
- active words highlighted with accent
- optional small footer with date or next event

Update rule:
- update every `5 min` by default, not every minute

## 10. `status_strip`

Purpose:
- show several tiny status indicators across the top or bottom edge

Minimum size:
- full-width `37x2` or `40x2`

Contents:
- up to five compact status chips
- icon or glyph plus 1 short word each

Best for:
- Wi-Fi
- battery
- last sync age
- alarm
- connectivity issues

## 11. `alert_banner`

Purpose:
- communicate an exceptional state with maximum clarity

Minimum size:
- full-width `37x3`

Contents:
- loud state word
- optional short detail text

Accent behavior:
- accent background blocks are not available, so use accent headline text or accent icon only

Best for:
- garage open too long
- freezer too warm
- rain warning

## 12. `date_time_compact`

Purpose:
- provide a simple date/time anchor when a full word clock is too expensive

Minimum size:
- `10x4`

Contents:
- day/date
- current time
- optional week number

Rules:
- keep this plain
- never let it visually outrank the main widget on the screen

## Recommended V1 Screen Combinations

For `tri296x128`:

- `state_tile + date_time_compact + status_strip`
- `price_now + price_bars_24h + status_strip`
- `agenda_list + status_strip`
- `room_list`
- `word_clock + small footer`

For `tri400x300`:

- `agenda_list + state_tile + status_strip`
- `price_now + price_bars_24h + history_bars + date_time_compact`
- `room_list + history_bars`
- `word_clock + agenda_list footer`

## V1 Data Model Direction

Each widget instance should be serializable roughly like this:

```json
{
  "id": "garage-main",
  "type": "state_tile",
  "x": 0,
  "y": 0,
  "w": 18,
  "h": 10,
  "bindings": {
    "entity": "cover.garage_door"
  },
  "props": {
    "title": "Garage",
    "normal_state": "closed",
    "alert_states": ["open"],
    "show_duration": true
  }
}
```

The final schema can evolve, but the editor should be built around widget instances like this rather than hard-coded screen templates.
