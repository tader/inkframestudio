import { describe, expect, it } from "vitest";
import { getDisplayProfile } from "../../render-core/src/display-profiles.js";
import { moveFrame, resizeFrame, snapFrameToGrid } from "./editor-model.js";

describe("editor model", () => {
  const profile = getDisplayProfile("tri296x128-red");

  it("snaps frames to valid grid coordinates", () => {
    expect(snapFrameToGrid({ x: -1.4, y: 2.6, w: 40.2, h: 0.2 }, profile)).toEqual({
      x: 0,
      y: 3,
      w: 37,
      h: 1
    });
  });

  it("moves frames on the grid", () => {
    expect(moveFrame({ x: 2, y: 2, w: 5, h: 5 }, 3, -1, profile)).toEqual({
      x: 5,
      y: 1,
      w: 5,
      h: 5
    });
  });

  it("resizes frames on the grid", () => {
    expect(resizeFrame({ x: 2, y: 2, w: 5, h: 5 }, 2, -3, profile)).toEqual({
      x: 2,
      y: 2,
      w: 7,
      h: 2
    });
  });
});
