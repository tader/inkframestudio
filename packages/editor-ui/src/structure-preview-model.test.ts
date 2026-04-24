import { describe, expect, it } from "vitest";
import type { LayoutInspectionNode, LayoutNode } from "../../render-core/src/types.js";
import { buildStructurePreviewTree, deriveStructureDropIntent, findInspectionNodeAtPoint } from "./structure-preview-model.js";

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

  it("builds schematic tree with both if branches", () => {
    const root: LayoutNode = {
      id: "root",
      type: "stack",
      axis: "vertical",
      children: [
        {
          id: "cond",
          type: "if_else",
          condition: "foo",
          thenChild: {
            id: "then-stack",
            type: "stack",
            axis: "vertical",
            children: []
          },
          elseChild: {
            id: "else-stack",
            type: "stack",
            axis: "vertical",
            children: []
          }
        }
      ]
    };
    const schematic = buildStructurePreviewTree(root, (node) => node.type === "if_else" ? "if/else" : node.type);
    const ifNode = schematic?.children[0];
    expect(ifNode?.label).toBe("if/else");
    expect(ifNode?.children.map((child) => child.label)).toEqual(["Then: stack", "Else: stack"]);
  });

  it("builds foreach as one template node with repeat hint", () => {
    const root: LayoutNode = {
      id: "foreach",
      type: "foreach",
      itemsRef: "events",
      itemAlias: "event",
      indexAlias: "index",
      axis: "vertical",
      maxItems: 5,
      child: {
        id: "template-text",
        type: "primitive_instance",
        primitiveType: "text",
        props: { text: "Hello" }
      }
    };
    const schematic = buildStructurePreviewTree(root, (node) => node.type === "foreach" ? "foreach event" : node.type === "primitive_instance" ? "text" : node.type);
    expect(schematic?.label).toBe("foreach event x5");
    expect(schematic?.children).toHaveLength(1);
    expect(schematic?.children[0]?.label).toBe("Template: text");
  });
});
