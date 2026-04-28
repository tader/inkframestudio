import type { GridChild, LayoutInspectionNode, LayoutNode } from "../../render-core/src/types.js";

export const STRUCTURE_PREVIEW_SIDE_PADDING = 12;
export const STRUCTURE_PREVIEW_BOTTOM_PADDING = 12;
export const STRUCTURE_PREVIEW_TOP_PADDING = 12;

const STRUCTURE_NODE_HEADER_HEIGHT = 12;
const STRUCTURE_NODE_PADDING_X = 12;
const STRUCTURE_NODE_PADDING_Y = 12;
const STRUCTURE_NODE_GAP = 3;
const STRUCTURE_NODE_MIN_WIDTH = 92;
const STRUCTURE_NODE_LEAF_BODY_HEIGHT = 1;
const STRUCTURE_NODE_CHAR_WIDTH = 6;
const STRUCTURE_ZSTACK_OFFSET = 3;

function measureLabelWidth(label: string): number {
  return Math.max(STRUCTURE_NODE_MIN_WIDTH, Math.min(260, 20 + label.length * STRUCTURE_NODE_CHAR_WIDTH));
}

function prefixedLabel(prefix: string | undefined, label: string): string {
  return prefix ? `${prefix}: ${label}` : label;
}

export function translateStructurePreviewTree(node: LayoutInspectionNode, offsetX: number, offsetY: number): LayoutInspectionNode {
  return {
    ...node,
    frame: {
      x: node.frame.x + offsetX,
      y: node.frame.y + offsetY,
      w: node.frame.w,
      h: node.frame.h
    },
    contentFrame: {
      x: node.contentFrame.x + offsetX,
      y: node.contentFrame.y + offsetY,
      w: node.contentFrame.w,
      h: node.contentFrame.h
    },
    gridCells: node.gridCells?.map((cell) => ({
      ...cell,
      frame: {
        x: cell.frame.x + offsetX,
        y: cell.frame.y + offsetY,
        w: cell.frame.w,
        h: cell.frame.h
      }
    })),
    children: node.children.map((child) => translateStructurePreviewTree(child, offsetX, offsetY))
  };
}

function gridChildAt(node: LayoutNode, row: number, column: number): GridChild | undefined {
  if (node.type !== "grid") {
    return undefined;
  }
  return node.children.find((child) => child.placement.row === row && child.placement.column === column);
}

function structureLabel(node: LayoutNode, labelForNode: (node: LayoutNode) => string, slotLabel?: string): string {
  let label = labelForNode(node);
  if (node.type === "foreach") {
    const repeatHint = typeof node.maxItems === "number" && Number.isFinite(node.maxItems)
      ? ` x${Math.max(0, Math.floor(node.maxItems))}`
      : " x...";
    label += repeatHint;
  }
  return prefixedLabel(slotLabel, label);
}

function buildLeafNode(node: LayoutNode, label: string): LayoutInspectionNode {
  const width = measureLabelWidth(label);
  const height = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y * 2 + STRUCTURE_NODE_LEAF_BODY_HEIGHT;
  return {
    nodeId: node.id,
    nodeType: node.type,
    label,
    frame: { x: 0, y: 0, w: width, h: height },
    contentFrame: {
      x: STRUCTURE_NODE_PADDING_X,
      y: STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y,
      w: Math.max(1, width - STRUCTURE_NODE_PADDING_X * 2),
      h: STRUCTURE_NODE_LEAF_BODY_HEIGHT
    },
    children: [],
    isContainer: false
  };
}

function buildStructuredNode(
  node: LayoutNode,
  labelForNode: (node: LayoutNode) => string,
  slotLabel?: string
): LayoutInspectionNode {
  const label = structureLabel(node, labelForNode, slotLabel);
  if (node.type === "primitive_instance" || node.type === "compound_ref" || node.type === "spacer") {
    return buildLeafNode(node, label);
  }

  if (node.type === "zstack") {
    const children = node.children.map((child) => buildStructuredNode(child, labelForNode));
    const cascadeWidth = children.reduce((max, child, index) => Math.max(max, child.frame.w + index * STRUCTURE_ZSTACK_OFFSET), 0);
    const cascadeHeight = children.reduce((max, child, index) => Math.max(max, child.frame.h + index * STRUCTURE_ZSTACK_OFFSET), 0);
    const width = Math.max(measureLabelWidth(label), cascadeWidth + STRUCTURE_NODE_PADDING_X * 2);
    const height = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y * 2 + Math.max(STRUCTURE_NODE_LEAF_BODY_HEIGHT, cascadeHeight);
    const positionedChildren = children.map((child, index) =>
      translateStructurePreviewTree(child, STRUCTURE_NODE_PADDING_X + index * STRUCTURE_ZSTACK_OFFSET, STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y + index * STRUCTURE_ZSTACK_OFFSET)
    );
    return {
      nodeId: node.id,
      nodeType: node.type,
      label,
      frame: { x: 0, y: 0, w: width, h: height },
      contentFrame: {
        x: STRUCTURE_NODE_PADDING_X,
        y: STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y,
        w: Math.max(1, width - STRUCTURE_NODE_PADDING_X * 2),
        h: Math.max(STRUCTURE_NODE_LEAF_BODY_HEIGHT, cascadeHeight)
      },
      children: positionedChildren,
      isContainer: true,
      stackAxis: "vertical"
    };
  }

  if (node.type === "grid") {
    const rows = Math.max(1, node.rows.length);
    const columns = Math.max(1, node.columns.length);
    const cellTrees = new Map<string, LayoutInspectionNode>();
    const columnWidths = Array.from({ length: columns }, () => STRUCTURE_NODE_MIN_WIDTH);
    const rowHeights = Array.from({ length: rows }, () => STRUCTURE_NODE_LEAF_BODY_HEIGHT + STRUCTURE_NODE_PADDING_Y * 2);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const child = gridChildAt(node, row, column);
        if (!child) {
          continue;
        }
        const tree = buildStructuredNode(child.node, labelForNode);
        cellTrees.set(`${row}:${column}`, tree);
        columnWidths[column] = Math.max(columnWidths[column], tree.frame.w);
        rowHeights[row] = Math.max(rowHeights[row], tree.frame.h);
      }
    }
    const bodyWidth = columnWidths.reduce((sum, value) => sum + value, 0) + STRUCTURE_NODE_GAP * Math.max(0, columns - 1);
    const bodyHeight = rowHeights.reduce((sum, value) => sum + value, 0) + STRUCTURE_NODE_GAP * Math.max(0, rows - 1);
    const width = Math.max(measureLabelWidth(label), bodyWidth + STRUCTURE_NODE_PADDING_X * 2);
    const height = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y * 2 + bodyHeight;
    const positionedChildren: LayoutInspectionNode[] = [];
    const gridCells = [];
    let cursorY = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y;
    for (let row = 0; row < rows; row += 1) {
      let cursorX = STRUCTURE_NODE_PADDING_X;
      for (let column = 0; column < columns; column += 1) {
        const cellFrame = { x: cursorX, y: cursorY, w: columnWidths[column], h: rowHeights[row] };
        gridCells.push({ row, column, frame: cellFrame });
        const tree = cellTrees.get(`${row}:${column}`);
        if (tree) {
      positionedChildren.push(translateStructurePreviewTree(tree, cellFrame.x, cellFrame.y));
        }
        cursorX += columnWidths[column] + STRUCTURE_NODE_GAP;
      }
      cursorY += rowHeights[row] + STRUCTURE_NODE_GAP;
    }
    return {
      nodeId: node.id,
      nodeType: node.type,
      label,
      frame: { x: 0, y: 0, w: width, h: height },
      contentFrame: {
        x: STRUCTURE_NODE_PADDING_X,
        y: STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y,
        w: Math.max(1, width - STRUCTURE_NODE_PADDING_X * 2),
        h: bodyHeight
      },
      children: positionedChildren,
      isContainer: true,
      gridCells
    };
  }

  const directChildren: Array<{ node: LayoutNode; slotLabel?: string }> =
    node.type === "stack"
      ? node.children.map((child) => ({ node: child }))
      : node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "script"
        ? (node.child ? [{ node: node.child, slotLabel: "Child" }] : [])
        : node.type === "foreach"
          ? (node.child ? [{ node: node.child, slotLabel: "Template" }] : [])
          : node.type === "if_else"
            ? [
                ...(node.thenChild ? [{ node: node.thenChild, slotLabel: "Then" }] : []),
                ...(node.elseChild ? [{ node: node.elseChild, slotLabel: "Else" }] : [])
              ]
            : [];

  const builtChildren = directChildren.map((child) => buildStructuredNode(child.node, labelForNode, child.slotLabel));
  const horizontal = node.type === "stack" && node.axis === "horizontal";
  const bodyWidth = builtChildren.length
    ? horizontal
      ? builtChildren.reduce((sum, child) => sum + child.frame.w, 0) + STRUCTURE_NODE_GAP * Math.max(0, builtChildren.length - 1)
      : Math.max(...builtChildren.map((child) => child.frame.w))
    : STRUCTURE_NODE_MIN_WIDTH;
  const bodyHeight = builtChildren.length
    ? horizontal
      ? Math.max(...builtChildren.map((child) => child.frame.h))
      : builtChildren.reduce((sum, child) => sum + child.frame.h, 0) + STRUCTURE_NODE_GAP * Math.max(0, builtChildren.length - 1)
    : STRUCTURE_NODE_LEAF_BODY_HEIGHT;
  const width = Math.max(measureLabelWidth(label), bodyWidth + STRUCTURE_NODE_PADDING_X * 2);
  const height = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y * 2 + bodyHeight;
  const positionedChildren: LayoutInspectionNode[] = [];
  if (horizontal) {
    let cursorX = STRUCTURE_NODE_PADDING_X;
    const contentY = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y;
    for (const child of builtChildren) {
      positionedChildren.push(translateStructurePreviewTree(child, cursorX, contentY));
      cursorX += child.frame.w + STRUCTURE_NODE_GAP;
    }
  } else {
    let cursorY = STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y;
    const contentX = STRUCTURE_NODE_PADDING_X;
    for (const child of builtChildren) {
      positionedChildren.push(translateStructurePreviewTree(child, contentX, cursorY));
      cursorY += child.frame.h + STRUCTURE_NODE_GAP;
    }
  }
  return {
    nodeId: node.id,
    nodeType: node.type,
    label,
    frame: { x: 0, y: 0, w: width, h: height },
    contentFrame: {
      x: STRUCTURE_NODE_PADDING_X,
      y: STRUCTURE_NODE_HEADER_HEIGHT + STRUCTURE_NODE_PADDING_Y,
      w: Math.max(1, width - STRUCTURE_NODE_PADDING_X * 2),
      h: bodyHeight
    },
    children: positionedChildren,
    isContainer: true,
    stackAxis: horizontal ? "horizontal" : "vertical"
  };
}

export function buildStructurePreviewTree(
  root: LayoutNode | undefined,
  labelForNode: (node: LayoutNode) => string
): LayoutInspectionNode | undefined {
  return root ? buildStructuredNode(root, labelForNode) : undefined;
}

export interface StructureDropIntent {
  kind: "into" | "before" | "after" | "grid-cell";
  parentId: string;
  targetNodeId?: string;
  row?: number;
  column?: number;
}

function inflatedFrame(node: LayoutInspectionNode): { x: number; y: number; w: number; h: number } {
  const side = STRUCTURE_PREVIEW_SIDE_PADDING;
  const top = STRUCTURE_PREVIEW_TOP_PADDING;
  const bottom = STRUCTURE_PREVIEW_BOTTOM_PADDING;
  return {
    x: node.frame.x - side,
    y: node.frame.y - top,
    w: node.frame.w + side * 2,
    h: node.frame.h + top + bottom
  };
}

function containsPoint(node: LayoutInspectionNode, x: number, y: number): boolean {
  const frame = inflatedFrame(node);
  return x >= frame.x && y >= frame.y && x < frame.x + frame.w && y < frame.y + frame.h;
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

export function findInspectionNodesAtPoint(node: LayoutInspectionNode | undefined, x: number, y: number): LayoutInspectionNode[] {
  if (!node || !containsPoint(node, x, y)) {
    return [];
  }
  return [
    node,
    ...node.children.flatMap((child) => findInspectionNodesAtPoint(child, x, y))
  ];
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
    const targetFrame = inflatedFrame(target);
    const centerInsetX = Math.min(18, Math.floor(targetFrame.w * 0.25));
    const centerInsetY = Math.min(18, Math.floor(targetFrame.h * 0.25));
    const insideCenter =
      x >= targetFrame.x + centerInsetX &&
      x < targetFrame.x + targetFrame.w - centerInsetX &&
      y >= targetFrame.y + centerInsetY &&
      y < targetFrame.y + targetFrame.h - centerInsetY;
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
  const targetFrame = inflatedFrame(target);
  const before =
    axis === "horizontal"
      ? x < targetFrame.x + targetFrame.w / 2
      : y < targetFrame.y + targetFrame.h / 2;
  return {
    kind: before ? "before" : "after",
    parentId: parent.nodeId,
    targetNodeId: target.nodeId
  };
}
