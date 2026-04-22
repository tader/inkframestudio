# E-Paper Dashboard Requirements

## Product Goal

Build a Home Assistant addon that:

- reads Home Assistant entity state and history
- renders screen images for supported e-paper displays
- pushes those images to the target display through Home Assistant or OpenEPaperLink flows
- includes a WYSIWYG drag/drop editor for designing screens without hand-editing JSON

The system should optimize for glanceable information, long battery life, and pixel-crisp rendering on low-refresh tri-color panels.

## Core Display Constraints

- Displays refresh slowly and each refresh is expensive in battery power.
- Many target displays are tri-color panels with `white`, `black`, and one accent color such as `red` or `yellow`.
- Pixels are binary per channel. Do not anti-alias, soften edges, or rely on semi-transparent layers.
- Fonts, icons, and graphs must look intentional at `1-bit` rendering.
- Layouts must remain readable from a distance, not just at arm's length.

## Supported Display Families

The renderer and editor must be profile-driven.

Each display profile should define:

- `width`
- `height`
- `rotation`
- `palette`
- `safe_margin_px`
- `grid_unit_px`
- `recommended_font_scale`
- optional hardware-specific refresh behavior

Initial profiles:

1. `tri296x128`
   - Size: `296x128`
   - Typical use: compact room/door/price/calendar screens
   - Recommended grid: `8 px`
   - Effective design grid: `37x16`

2. `tri400x300`
   - Size: `400x300`
   - Typical use: denser dashboards, larger graphs, richer agenda views
   - Recommended grid: `10 px`
   - Effective design grid: `40x30`

The palette model must not hard-code `red`. Use semantic tokens:

- `bg`
- `fg`
- `accent`

For red/black/white displays, `accent = red`.
For yellow/black/white displays, `accent = yellow`.

Layouts and widgets should render identically across accent palettes unless a widget explicitly depends on semantic color meaning.

## Rendering Rules

- No anti-aliasing.
- No grayscale simulation or error-diffusion dithering in the default renderer.
- Prefer bitmap or bitmap-style fonts that remain clean at small sizes.
- Prefer bundled monochrome/tri-color icons over general emoji fonts.
- Use filled silhouettes and chunky strokes for icons.
- Use at most one accent-colored concept per widget.
- Prefer bars, blocks, steps, and banded areas over thin line charts.
- Clamp decimal precision to reduce needless updates.

## Update and Quantization Rules

The runtime should render on a schedule, but only publish when the final bitmap changed.

Widget values should be quantized before rendering:

- room temperature: `0.5 C` on detail screens, `1.0 C` on overview screens
- humidity: `2%` or `5%`
- power and energy prices: rounded to meaningful display increments
- durations: rounded more aggressively as they grow
- history graphs: bucketed into fixed intervals such as `15 min`, `30 min`, or `1 h`

The editor should expose quantization settings, but widgets should ship with good defaults.

## Information Design Rules

- Favor glanceability over raw density.
- Use size first, then color, to signal importance.
- Red or yellow should be rare and deliberate.
- Short labels beat long labels.
- Truncate or abbreviate calendar titles when needed.
- One hero metric per small screen is better than six competing metrics.
- State words such as `OPEN`, `CLOSED`, `CHEAP`, `ALERT` should be preferred over verbose prose.

## Widget System Requirements

The addon should ship with a reusable widget library instead of one-off templates.

Each widget definition should include:

- unique widget type name
- supported entity domains or data shapes
- minimum size in grid units
- configurable bindings
- formatting and quantization options
- accent-color behavior
- rendering rules

Widgets should be composable into screens through the editor.

## Editor Requirements

The WYSIWYG editor is mandatory.

Required editor capabilities:

- select a display profile before designing
- drag/drop widget placement
- resize widgets with snap-to-grid behavior
- inspect and edit widget properties in a side panel
- bind widgets to Home Assistant entities
- preview real or mocked states
- duplicate, align, distribute, and layer widgets
- save reusable templates and screen presets
- switch palette profile from red to yellow without redesigning the screen

Critical requirement:

- the editor preview and production renderer must use the same layout and rendering engine so WYSIWYG stays trustworthy

## Runtime Requirements

- poll or receive Home Assistant state updates
- fetch history when widgets need trend/graph data
- render screen images deterministically
- hash or compare output bitmaps and skip unchanged pushes
- support per-screen refresh intervals and event-triggered refreshes
- provide safe fallbacks for unavailable entities

## Accessibility and Readability Targets

- primary values should remain readable from a few meters away on `296x128`
- overview screens must avoid text smaller than the chosen display profile comfortably supports
- critical state changes must be recognizable by shape and wording, not color alone
- widgets should still function if a user is color-insensitive or the accent color is visually weak

## Initial Product Scope

First-class use cases:

- door and garage state
- room temperature and humidity
- calendar agenda
- electricity price now and upcoming
- fuzzy word clock
- simple time-series graphs
- compact household status strips

Out of scope for the first version:

- animation
- arbitrary custom drawing tools
- per-pixel hand editing
- anti-aliased font rendering
