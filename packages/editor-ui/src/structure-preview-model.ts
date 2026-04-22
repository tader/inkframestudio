import type { LayoutInspectionNode } from "../../render-core/src/types.js";

export interface StructureDropIntent {
  kind: "into" | "before" | "after" | "grid-cell";
  parentId: string;
  targetNodeId?: string;
  row?: number;
  column?: number;
}

function containsPoint(node: LayoutInspectionNode, x: number, y: number): boolean {
  return x >= node.frame.x && y >= node.frame.y && x < node.frame.x + node.frame.w && y < node.frame.y + node.frame.h;
}

export function findInspectionNodeAtPoint(node: LayoutInspectionNode | undefined, x: number, y: number): LayoutInspectionNode | undefined {
  if (!node || !containsPoint(node, x, y)) {
    return undefined;
  }
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    const found = findInspectionNodeAtPoint(child, x, y);
    if (found) {
      return found;
    }
  }
  return node;
}

export function findInspectionPathAtPoint(
  node: LayoutInspectionNode | undefined,
  x: number,
  y: number,
  trail: LayoutInspectionNode[] = []
): LayoutInspectionNode[] {
  if (!node || !containsPoint(node, x, y)) {
    return [];
  }
  const nextTrail = [...trail, node];
  for (let index = node.children.length - 1; index >= 0; index -= 1) {
    const child = node.children[index];
    const found = findInspectionPathAtPoint(child, x, y, nextTrail);
    if (found.length) {
      return found;
    }
  }
  return nextTrail;
}

function resolveGridCell(node: LayoutInspectionNode, x: number, y: number): { row: number; column: number } | undefined {
  const cell = node.gridCells?.find((entry) => x >= entry.frame.x && y >= entry.frame.y && x < entry.frame.x + entry.frame.w && y < entry.frame.y + entry.frame.h);
  return cell ? { row: cell.row, column: cell.column } : undefined;
}

export function deriveStructureDropIntent(
  root: LayoutInspectionNode | undefined,
  draggedNodeId: string,
  x: number,
  y: number
): StructureDropIntent | null {
  const path = findInspectionPathAtPoint(root, x, y);
  if (!path.length) {
    return null;
  }
  const target = path[path.length - 1];
  if (target.nodeId === draggedNodeId) {
    return null;
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const candidate = path[index];
    if (candidate.nodeType === "grid" && candidate.gridCells?.length) {
      const cell = resolveGridCell(candidate, x, y);
      if (cell) {
        return {
          kind: "grid-cell",
          parentId: candidate.nodeId,
          row: cell.row,
          column: cell.column
        };
      }
    }
  }

  if (target.isContainer) {
    const centerInsetX = Math.min(18, Math.floor(target.frame.w * 0.25));
    const centerInsetY = Math.min(18, Math.floor(target.frame.h * 0.25));
    const insideCenter =
      x >= target.frame.x + centerInsetX &&
      x < target.frame.x + target.frame.w - centerInsetX &&
      y >= target.frame.y + centerInsetY &&
      y < target.frame.y + target.frame.h - centerInsetY;
    if (insideCenter) {
      return {
        kind: "into",
        parentId: target.nodeId
      };
    }
  }

  const parent = path[path.length - 2];
  if (!parent || !parent.isContainer) {
    return target.isContainer ? { kind: "into", parentId: target.nodeId } : null;
  }
  const axis = parent.stackAxis ?? "vertical";
  const before =
    axis === "horizontal"
      ? x < target.frame.x + target.frame.w / 2
      : y < target.frame.y + target.frame.h / 2;
  return {
    kind: before ? "before" : "after",
    parentId: parent.nodeId,
    targetNodeId: target.nodeId
  };
}
