import { describe, expect, it } from "vitest";
import { getDisplayProfile } from "../../render-core/src/display-profiles.js";
import { duplicateScreenForProfile, moveFrame, resizeFrame, snapFrameToGrid } from "./editor-model.js";
import type { Project } from "../../render-core/src/types.js";

describe("editor model", () => {
  const profile = getDisplayProfile("tri296x128-red");
  const legacyProject: Project = {
    id: "legacy-test",
    name: "Legacy Test",
    version: 1,
    fontPresets: { tiny: 8, normal: 12, header: 16 },
    themes: [],
    screens: [{
      id: "calendar-main-296",
      name: "Calendar Main 296",
      displayProfileId: "tri296x128-red",
      default: true,
      widgetThemeId: "classic-outline",
      baseWidgetIds: ["agenda-main"],
      overlayIds: [],
      rules: []
    }],
    overlays: [],
    widgets: [{
      id: "agenda-main",
      type: "agenda_list",
      screenId: "calendar-main-296",
      frame: { x: 0, y: 0, w: 25, h: 12 },
      bindings: { query: "agenda-today" },
      props: { title: "TODAY" }
    }],
    scenarios: []
  };

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

  it("duplicates a screen for another profile while copying widgets", () => {
    const duplicated = duplicateScreenForProfile(legacyProject, "calendar-main-296", "tri400x300-red");
    const copiedScreen = duplicated.screens.find((screen) => screen.id === "calendar-main-296-tri400x300-red");
    expect(copiedScreen).toBeTruthy();
    expect(
      duplicated.widgets.some((widget) => widget.screenId === "calendar-main-296-tri400x300-red")
    ).toBe(true);
  });
});
