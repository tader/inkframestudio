import { describe, expect, it } from "vitest";
import { getDisplayProfile } from "../../render-core/src/display-profiles.js";
import type { Screen } from "../../render-core/src/types.js";
import {
  frameFromDragSession,
  overlaySelectionForScreen,
  startDragSession,
  toggleScenarioSelection
} from "./interaction-model.js";

describe("interaction model", () => {
  const profile = getDisplayProfile("tri296x128-red");

  it("computes move drags from the origin frame", () => {
    const session = startDragSession("widget-1", "move", 1, 100, 100, { x: 2, y: 3, w: 10, h: 4 });
    expect(frameFromDragSession(session, 132, 116, profile, 2)).toEqual({
      x: 4,
      y: 4,
      w: 10,
      h: 4
    });
  });

  it("computes resize drags from the origin frame", () => {
    const session = startDragSession("widget-1", "resize", 1, 100, 100, { x: 2, y: 3, w: 10, h: 4 });
    expect(frameFromDragSession(session, 132, 116, profile, 2)).toEqual({
      x: 2,
      y: 3,
      w: 12,
      h: 5
    });
  });

  it("toggles scenarios on repeated clicks", () => {
    expect(toggleScenarioSelection("", "scenario-a")).toBe("scenario-a");
    expect(toggleScenarioSelection("scenario-a", "scenario-a")).toBe("");
  });

  it("clears overlay selection when a screen does not contain it", () => {
    const screen: Screen = {
      id: "screen-a",
      name: "Screen A",
      displayProfileId: "tri296x128-red",
      default: true,
      baseWidgetIds: [],
      overlayIds: ["overlay-a"],
      rules: []
    };
    expect(overlaySelectionForScreen(screen, "overlay-a")).toBe("overlay-a");
    expect(overlaySelectionForScreen(screen, "overlay-b")).toBe("");
  });
});
