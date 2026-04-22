import type { DisplayProfile, Frame, Project, Screen } from "../../render-core/src/types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapFrameToGrid(frame: Frame, profile: DisplayProfile): Frame {
  const grid = profile.gridUnitPx;
  const maxW = Math.floor(profile.width / grid);
  const maxH = Math.floor(profile.height / grid);
  return {
    x: clamp(Math.round(frame.x), 0, maxW - 1),
    y: clamp(Math.round(frame.y), 0, maxH - 1),
    w: clamp(Math.round(frame.w), 1, maxW),
    h: clamp(Math.round(frame.h), 1, maxH)
  };
}

export function moveFrame(frame: Frame, dx: number, dy: number, profile: DisplayProfile): Frame {
  return snapFrameToGrid(
    {
      ...frame,
      x: frame.x + dx,
      y: frame.y + dy
    },
    profile
  );
}

export function resizeFrame(frame: Frame, dw: number, dh: number, profile: DisplayProfile): Frame {
  return snapFrameToGrid(
    {
      ...frame,
      w: frame.w + dw,
      h: frame.h + dh
    },
    profile
  );
}

export function duplicateScreenForProfile(project: Project, sourceScreenId: string, displayProfileId: string): Project {
  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) {
    throw new Error(`Unknown screen ${sourceScreenId}`);
  }
  const suffix = displayProfileId.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const clonedScreen: Screen = {
    ...source,
    id: `${source.id}-${suffix}`,
    name: `${source.name} (${displayProfileId})`,
    displayProfileId,
    default: false,
    rules: source.rules.map((rule) => ({ ...rule, id: `${rule.id}-${suffix}` }))
  };
  const widgets = project.widgets
    .filter((widget) => widget.screenId === source.id)
    .map((widget) => ({
      ...widget,
      id: `${widget.id}-${suffix}`,
      screenId: clonedScreen.id
    }));

  return {
    ...project,
    screens: [...project.screens, clonedScreen],
    widgets: [...project.widgets, ...widgets]
  };
}
