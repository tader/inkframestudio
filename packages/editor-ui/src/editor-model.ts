import type { DisplayProfile, Frame } from "../../render-core/src/types.js";

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
