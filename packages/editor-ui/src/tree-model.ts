import type { GridChild, LayoutNode } from "../../render-core/src/types.js";

export interface NodeTreeEntry {
  node: LayoutNode;
  parentId?: string;
  depth: number;
  slotLabel?: string;
}

export function isContainerNode(node: LayoutNode | undefined): boolean {
  return Boolean(node && (
    node.type === "stack" ||
    node.type === "zstack" ||
    node.type === "grid" ||
    node.type === "data_query" ||
    node.type === "filter" ||
    node.type === "unique" ||
    node.type === "foreach" ||
    node.type === "script"
  ));
}

export function getNodeById(node: LayoutNode | undefined, nodeId: string): LayoutNode | undefined {
  if (!node) {
    return undefined;
  }
  if (node.id === nodeId) {
    return node;
  }
  if (node.type === "stack" || node.type === "zstack") {
    for (const child of node.children) {
      const found = getNodeById(child, nodeId);
      if (found) {
        return found;
      }
    }
  }
  if (node.type === "grid") {
    for (const child of node.children) {
      const found = getNodeById(child.node, nodeId);
      if (found) {
        return found;
      }
    }
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return getNodeById(node.child, nodeId);
  }
  if (node.type === "if_else") {
    return getNodeById(node.thenChild, nodeId) ?? getNodeById(node.elseChild, nodeId);
  }
  return undefined;
}

export function isDescendant(root: LayoutNode | undefined, ancestorId: string, candidateId: string): boolean {
  const ancestor = getNodeById(root, ancestorId);
  if (!ancestor) {
    return false;
  }
  return Boolean(getNodeById(ancestor, candidateId));
}

export function buildNodeTree(root: LayoutNode | undefined): NodeTreeEntry[] {
  const entries: NodeTreeEntry[] = [];
  const visit = (node: LayoutNode, depth: number, parentId?: string, slotLabel?: string): void => {
    entries.push({ node, depth, parentId, slotLabel });
    if (node.type === "stack" || node.type === "zstack") {
      node.children.forEach((child) => visit(child, depth + 1, node.id));
    }
    if (node.type === "grid") {
      node.children.forEach((child) => visit(child.node, depth + 1, node.id));
    }
    if (node.type === "data_query" && node.child) {
      visit(node.child, depth + 1, node.id, "Child");
    }
    if (node.type === "filter" && node.child) {
      visit(node.child, depth + 1, node.id, "Child");
    }
    if (node.type === "unique" && node.child) {
      visit(node.child, depth + 1, node.id, "Child");
    }
    if (node.type === "foreach" && node.child) {
      visit(node.child, depth + 1, node.id, "Template");
    }
    if (node.type === "script" && node.child) {
      visit(node.child, depth + 1, node.id, "Child");
    }
    if (node.type === "if_else") {
      if (node.thenChild) {
        visit(node.thenChild, depth + 1, node.id, "Then");
      }
      if (node.elseChild) {
        visit(node.elseChild, depth + 1, node.id, "Else");
      }
    }
  };
  if (root) {
    visit(root, 0);
  }
  return entries;
}

function mapChildren(node: LayoutNode, mapper: (child: LayoutNode) => LayoutNode): LayoutNode {
  if (node.type === "stack" || node.type === "zstack") {
    return {
      ...node,
      children: node.children.map(mapper)
    };
  }
  if (node.type === "grid") {
    return {
      ...node,
      children: node.children.map((child) => ({
        ...child,
        node: mapper(child.node)
      }))
    };
  }
  if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "foreach" || node.type === "script") {
    return {
      ...node,
      child: node.child ? mapper(node.child) : undefined
    };
  }
  if (node.type === "if_else") {
    return {
      ...node,
      thenChild: node.thenChild ? mapper(node.thenChild) : undefined,
      elseChild: node.elseChild ? mapper(node.elseChild) : undefined
    };
  }
  return node;
}

export function removeNode(root: LayoutNode, nodeId: string): { root: LayoutNode; removed?: LayoutNode } {
  let removed: LayoutNode | undefined;
  const walk = (node: LayoutNode): LayoutNode => {
    if (node.type === "stack" || node.type === "zstack") {
      return {
        ...node,
        children: node.children
          .filter((child) => {
            if (child.id === nodeId) {
              removed = child;
              return false;
            }
            return true;
          })
          .map(walk)
      };
    }
    if (node.type === "grid") {
      return {
        ...node,
        children: node.children
          .filter((child) => {
            if (child.node.id === nodeId) {
              removed = child.node;
              return false;
            }
            return true;
          })
          .map((child) => ({
            ...child,
            node: walk(child.node)
          }))
      };
    }
    if (node.type === "data_query" || node.type === "filter" || node.type === "unique" || node.type === "script") {
      if (node.child?.id === nodeId) {
        removed = node.child;
        return { ...node, child: undefined };
      }
      return {
        ...node,
        child: node.child ? walk(node.child) : undefined
      };
    }
    if (node.type === "foreach") {
      if (node.child?.id === nodeId) {
        removed = node.child;
        return { ...node, child: undefined };
      }
      return {
        ...node,
        child: node.child ? walk(node.child) : undefined
      };
    }
    if (node.type === "if_else") {
      if (node.thenChild?.id === nodeId) {
        removed = node.thenChild;
        return { ...node, thenChild: undefined };
      }
      if (node.elseChild?.id === nodeId) {
        removed = node.elseChild;
        return { ...node, elseChild: undefined };
      }
      return {
        ...node,
        thenChild: node.thenChild ? walk(node.thenChild) : undefined,
        elseChild: node.elseChild ? walk(node.elseChild) : undefined
      };
    }
    return node;
  };
  return { root: walk(root), removed };
}

function appendIntoGrid(children: GridChild[], child: LayoutNode, index?: number): GridChild[] {
  const entry: GridChild = {
    placement: { row: 0, column: 0 },
    node: child
  };
  if (index === undefined || index < 0 || index > children.length) {
    return [...children, entry];
  }
  const next = [...children];
  next.splice(index, 0, entry);
  return next;
}

function appendIntoGridCell(children: GridChild[], child: LayoutNode, row: number, column: number): GridChild[] {
  return [
    ...children.filter((entry) => entry.node.id !== child.id),
    {
      placement: { row, column, rowSpan: 1, columnSpan: 1 },
      node: child
    }
  ];
}

export function insertNode(root: LayoutNode, parentId: string, child: LayoutNode, index?: number): LayoutNode {
  if (root.id === parentId) {
    if (root.type === "stack" || root.type === "zstack") {
      const children = [...root.children];
      if (index === undefined || index < 0 || index > children.length) {
        children.push(child);
      } else {
        children.splice(index, 0, child);
      }
      return { ...root, children };
    }
    if (root.type === "grid") {
      return { ...root, children: appendIntoGrid(root.children, child, index) };
    }
    if (root.type === "data_query" || root.type === "filter" || root.type === "unique" || root.type === "foreach" || root.type === "script") {
      return { ...root, child };
    }
    return root;
  }
  return mapChildren(root, (entry) => insertNode(entry, parentId, child, index));
}

export function insertNodeIntoGridCell(root: LayoutNode, parentId: string, child: LayoutNode, row: number, column: number): LayoutNode {
  if (root.id === parentId) {
    if (root.type === "grid") {
      return { ...root, children: appendIntoGridCell(root.children, child, row, column) };
    }
    return root;
  }
  return mapChildren(root, (entry) => insertNodeIntoGridCell(entry, parentId, child, row, column));
}

export function moveNode(root: LayoutNode, nodeId: string, targetParentId: string, index?: number): LayoutNode {
  const { root: withoutNode, removed } = removeNode(root, nodeId);
  if (!removed) {
    return root;
  }
  return insertNode(withoutNode, targetParentId, removed, index);
}

export function moveNodeToGridCell(root: LayoutNode, nodeId: string, targetParentId: string, row: number, column: number): LayoutNode {
  const { root: withoutNode, removed } = removeNode(root, nodeId);
  if (!removed) {
    return root;
  }
  return insertNodeIntoGridCell(withoutNode, targetParentId, removed, row, column);
}

export function childIndexInParent(root: LayoutNode, parentId: string, childId: string): number {
  const parent = getNodeById(root, parentId);
  if (!parent) {
    return -1;
  }
  if (parent.type === "stack" || parent.type === "zstack") {
    return parent.children.findIndex((child) => child.id === childId);
  }
  if (parent.type === "grid") {
    return parent.children.findIndex((child) => child.node.id === childId);
  }
  return -1;
}

export function moveNodeAfter(root: LayoutNode, nodeId: string, targetParentId: string, targetNodeId: string): LayoutNode {
  const { root: withoutNode, removed } = removeNode(root, nodeId);
  if (!removed) {
    return root;
  }
  const targetIndex = childIndexInParent(withoutNode, targetParentId, targetNodeId);
  return insertNode(withoutNode, targetParentId, removed, targetIndex < 0 ? undefined : targetIndex + 1);
}

export function moveNodeBefore(root: LayoutNode, nodeId: string, targetParentId: string, targetNodeId: string): LayoutNode {
  const { root: withoutNode, removed } = removeNode(root, nodeId);
  if (!removed) {
    return root;
  }
  const targetIndex = childIndexInParent(withoutNode, targetParentId, targetNodeId);
  return insertNode(withoutNode, targetParentId, removed, targetIndex < 0 ? 0 : targetIndex);
}
