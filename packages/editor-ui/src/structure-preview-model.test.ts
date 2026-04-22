import { describe, expect, it } from "vitest";
import type { LayoutInspectionNode } from "../../render-core/src/types.js";
import { deriveStructureDropIntent, findInspectionNodeAtPoint } from "./structure-preview-model.js";

function sampleInspection(): LayoutInspectionNode {
  return {
    nodeId: "root",
    nodeType: "stack",
    label: "stack",
    frame: { x: 0, y: 0, w: 300, h: 200 },
    contentFrame: { x: 0, y: 0, w: 300, h: 200 },
    children: [
      {
        nodeId: "top",
        nodeType: "primitive_instance",
        label: "text",
        frame: { x: 0, y: 0, w: 300, h: 80 },
        contentFrame: { x: 4, y: 4, w: 292, h: 72 },
        children: [],
        isContainer: false
      },
      {
        nodeId: "grid",
        nodeType: "grid",
        label: "grid",
        frame: { x: 0, y: 80, w: 300, h: 120 },
        contentFrame: { x: 0, y: 80, w: 300, h: 120 },
        gridCells: [
          { row: 0, column: 0, frame: { x: 0, y: 80, w: 150, h: 60 } },
          { row: 0, column: 1, frame: { x: 150, y: 80, w: 150, h: 60 } },
          { row: 1, column: 0, frame: { x: 0, y: 140, w: 150, h: 60 } },
          { row: 1, column: 1, frame: { x: 150, y: 140, w: 150, h: 60 } }
        ],
        children: [
          {
            nodeId: "cell-text",
            nodeType: "primitive_instance",
            label: "number",
            frame: { x: 150, y: 140, w: 150, h: 60 },
            contentFrame: { x: 154, y: 144, w: 142, h: 52 },
            gridPlacement: { row: 1, column: 1 },
            children: [],
            isContainer: false
          }
        ],
        isContainer: true
      }
    ],
    isContainer: true,
    stackAxis: "vertical"
  };
}

describe("structure preview model", () => {
  it("finds deepest node at point", () => {
    expect(findInspectionNodeAtPoint(sampleInspection(), 200, 160)?.nodeId).toBe("cell-text");
    expect(findInspectionNodeAtPoint(sampleInspection(), 20, 20)?.nodeId).toBe("top");
  });

  it("derives before/after drop intent for stacks", () => {
    const intent = deriveStructureDropIntent(sampleInspection(), "cell-text", 20, 10);
    expect(intent).toEqual({
      kind: "before",
      parentId: "root",
      targetNodeId: "top"
    });
  });

  it("derives grid cell drop intent", () => {
    const intent = deriveStructureDropIntent(sampleInspection(), "top", 20, 150);
    expect(intent).toEqual({
      kind: "grid-cell",
      parentId: "grid",
      row: 1,
      column: 0
    });
  });
});
