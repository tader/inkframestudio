import { describe, expect, it } from "vitest";
import type { LayoutNode } from "../../render-core/src/types.js";
import { buildNodeTree, getNodeById, insertNode, isContainerNode, isDescendant, moveNode, moveNodeBefore, moveNodeToGridCell, removeNode } from "./tree-model.js";

function sampleRoot(): LayoutNode {
  return {
    id: "root",
    type: "stack",
    axis: "vertical",
    children: [
      {
        id: "child-a",
        type: "primitive_instance",
        primitiveType: "text"
      },
      {
        id: "container",
        type: "zstack",
        children: [
          {
            id: "child-b",
            type: "primitive_instance",
            primitiveType: "number"
          }
        ]
      }
    ]
  };
}

describe("tree model", () => {
  it("builds flat tree entries", () => {
    const entries = buildNodeTree(sampleRoot());
    expect(entries.map((entry) => `${entry.depth}:${entry.node.id}`)).toEqual([
      "0:root",
      "1:child-a",
      "1:container",
      "2:child-b"
    ]);
  });

  it("finds nodes and container status", () => {
    const root = sampleRoot();
    expect(getNodeById(root, "child-b")?.id).toBe("child-b");
    expect(isContainerNode(getNodeById(root, "container"))).toBe(true);
    expect(isContainerNode(getNodeById(root, "child-a"))).toBe(false);
  });

  it("removes nodes", () => {
    const { root, removed } = removeNode(sampleRoot(), "child-a");
    expect(removed?.id).toBe("child-a");
    expect(getNodeById(root, "child-a")).toBeUndefined();
  });

  it("moves nodes across parents", () => {
    const root = moveNode(sampleRoot(), "child-a", "container");
    const container = getNodeById(root, "container");
    expect(container?.type).toBe("zstack");
    if (container?.type === "zstack") {
      expect(container.children.map((child) => child.id)).toEqual(["child-b", "child-a"]);
    }
  });

  it("detects descendants", () => {
    const root = sampleRoot();
    expect(isDescendant(root, "container", "child-b")).toBe(true);
    expect(isDescendant(root, "child-b", "container")).toBe(false);
  });

  it("moves nodes before siblings", () => {
    const root = moveNodeBefore(sampleRoot(), "child-b", "root", "child-a");
    expect(root.type).toBe("stack");
    if (root.type === "stack") {
      expect(root.children.map((child) => child.id)).toEqual(["child-b", "child-a", "container"]);
    }
  });

  it("inserts nodes into grid with default placement", () => {
    const root: LayoutNode = {
      id: "grid-root",
      type: "grid",
      rows: [{ size: { mode: "fill" } }],
      columns: [{ size: { mode: "fill" } }],
      children: []
    };
    const next = insertNode(root, "grid-root", {
      id: "bar-chart",
      type: "primitive_instance",
      primitiveType: "bar_chart"
    });
    expect(next.type).toBe("grid");
    if (next.type === "grid") {
      expect(next.children[0]?.node.id).toBe("bar-chart");
      expect(next.children[0]?.placement).toEqual({ row: 0, column: 0 });
    }
  });

  it("moves nodes into explicit grid cells", () => {
    const root: LayoutNode = {
      id: "root",
      type: "stack",
      axis: "vertical",
      children: [
        { id: "text", type: "primitive_instance", primitiveType: "text" },
        {
          id: "grid",
          type: "grid",
          rows: [{ size: { mode: "fill" } }, { size: { mode: "fill" } }],
          columns: [{ size: { mode: "fill" } }, { size: { mode: "fill" } }],
          children: []
        }
      ]
    };
    const next = moveNodeToGridCell(root, "text", "grid", 1, 1);
    const grid = getNodeById(next, "grid");
    expect(grid?.type).toBe("grid");
    if (grid?.type === "grid") {
      expect(grid.children[0]?.placement).toEqual({ row: 1, column: 1, rowSpan: 1, columnSpan: 1 });
    }
  });

  it("tracks meta-node branch and template slots in the tree", () => {
    const root: LayoutNode = {
      id: "root",
      type: "data_query",
      queryKind: "calendar_events",
      variableName: "events",
      dateVariableName: "date",
      calendarEntityIds: ["calendar.family"],
      offsetDays: 0,
      child: {
        id: "loop",
        type: "foreach",
        itemsRef: "events",
        itemAlias: "event",
        indexAlias: "index",
        axis: "vertical",
        child: {
          id: "branch",
          type: "if_else",
          condition: "event.allday == true",
          thenChild: {
            id: "then-text",
            type: "primitive_instance",
            primitiveType: "text"
          },
          elseChild: {
            id: "else-icon",
            type: "primitive_instance",
            primitiveType: "icon"
          }
        }
      }
    };
    const entries = buildNodeTree(root);
    expect(entries.map((entry) => `${entry.depth}:${entry.slotLabel ?? "-"}:${entry.node.id}`)).toEqual([
      "0:-:root",
      "1:Child:loop",
      "2:Template:branch",
      "3:Then:then-text",
      "3:Else:else-icon"
    ]);
  });
});
