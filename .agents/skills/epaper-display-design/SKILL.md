---
name: epaper-display-design
description: Design readable, battery-aware widgets and screen layouts for low-refresh binary tri-color e-paper displays, including red/black/white and yellow/black/white panels, with support for multiple resolutions such as 296x128 and 400x300.
---

# E-Paper Display Design

Use this skill when the task is to design or review widgets, icons, screens, or rendering rules for supported e-paper displays.

## Read First

Before designing or changing layouts, read:

- `docs/requirements.md`
- `docs/widget-set-v1.md`
- `docs/example-screens.md`

## Workflow

1. Identify the target display profile.
   - Confirm `width`, `height`, `rotation`, and whether the accent color is `red` or `yellow`.
   - Treat the palette semantically as `bg`, `fg`, and `accent`.

2. Design on the profile grid.
   - `tri296x128` uses an `8 px` base grid with an effective `37x16` layout grid.
   - `tri400x300` uses a `10 px` base grid with an effective `40x30` layout grid.
   - Prefer snap-friendly rectangular regions and strong alignment.

3. Respect e-paper rendering limits.
   - No anti-aliasing.
   - No grayscale simulation.
   - Prefer bitmap or bitmap-style fonts.
   - Prefer bundled icons over emoji fonts unless the glyphs are proven crisp at `1-bit`.
   - Prefer bars, steps, blocks, and silhouettes over delicate lines.

4. Design for low-refresh operation.
   - Quantize values before rendering.
   - Avoid showing precision that causes cosmetic updates.
   - Recommend pushing updates only when the final bitmap changes.

5. Optimize for distance readability.
   - Use size before color to show hierarchy.
   - Keep labels short.
   - Use accent color for one idea per widget.
   - Favor a single hero metric on smaller screens.

## Output Expectations

When asked to design a new screen or widget, provide:

- the target display profile
- the chosen widgets
- a short rationale for the hierarchy
- a wireframe or layout sketch
- any quantization or update-throttling rules that matter

When asked to review an existing design, focus on:

- readability at distance
- unnecessary update churn
- misuse of accent color
- overcrowding
- weak graph choices for `1-bit` rendering

## Extension Rules

- Extend `docs/widget-set-v1.md` when a new reusable widget pattern emerges.
- Extend `docs/example-screens.md` when a layout is strong enough to reuse as a preset.
- Keep the widget library portable across red-accent and yellow-accent displays.
