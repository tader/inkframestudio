import type { DisplayProfile, Frame, Screen } from "../../render-core/src/types.js";
import { moveFrame, resizeFrame } from "./editor-model.js";

export type DragMode = "move" | "resize";

export interface DragSession {
  widgetId: string;
  mode: DragMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originFrame: Frame;
}

export function startDragSession(
  widgetId: string,
  mode: DragMode,
  pointerId: number,
  startClientX: number,
  startClientY: number,
  originFrame: Frame
): DragSession {
  return {
    widgetId,
    mode,
    pointerId,
    startClientX,
    startClientY,
    originFrame
  };
}

export function frameFromDragSession(
  session: DragSession,
  clientX: number,
  clientY: number,
  profile: DisplayProfile,
  scale: number
): Frame {
  const gridPixels = profile.gridUnitPx * scale;
  const deltaX = Math.round((clientX - session.startClientX) / gridPixels);
  const deltaY = Math.round((clientY - session.startClientY) / gridPixels);
  return session.mode === "move"
    ? moveFrame(session.originFrame, deltaX, deltaY, profile)
    : resizeFrame(session.originFrame, deltaX, deltaY, profile);
}

export function toggleScenarioSelection(currentScenarioId: string, clickedScenarioId: string): string {
  return currentScenarioId === clickedScenarioId ? "" : clickedScenarioId;
}

export function overlaySelectionForScreen(screen: Screen, currentOverlayId: string): string {
  return screen.overlayIds.includes(currentOverlayId) ? currentOverlayId : "";
}
