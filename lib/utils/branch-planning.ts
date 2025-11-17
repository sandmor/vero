// hooks/utils/branch-planning.ts
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import { cloneSelectionSnapshot } from './selection-snapshot';

export type BranchSelectionOperation =
  | { kind: 'root'; rootMessageIndex: number | null }
  | { kind: 'child'; parentId: string; selectedChildIndex: number | null };

export type BranchSwitchPlan = {
  branch: MessageTreeNode[];
  snapshot: BranchSelectionSnapshot;
  operation: BranchSelectionOperation;
};

const toTimestamp = (value: Date | string | number | null | undefined) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Picks a node from siblings by preferred index, falling back to the latest node
 */
const pickByIndexOrLatest = (
  siblings: MessageTreeNode[],
  preferredIndex?: number | null
): MessageTreeNode | undefined => {
  if (!siblings.length) {
    return undefined;
  }

  if (
    preferredIndex !== null &&
    preferredIndex !== undefined &&
    Number.isFinite(preferredIndex)
  ) {
    const candidate = siblings.find(
      (node) => node.siblingIndex === preferredIndex
    );
    if (candidate) {
      return candidate;
    }
  }

  // Fall back to latest node
  return siblings.reduce((latest, node) => {
    const latestTimestamp = toTimestamp(latest.createdAt);
    const nodeTimestamp = toTimestamp(node.createdAt);

    if (nodeTimestamp > latestTimestamp) {
      return node;
    }

    if (nodeTimestamp === latestTimestamp) {
      return node.pathText.localeCompare(latest.pathText) > 0 ? node : latest;
    }

    return latest;
  }, siblings[0]);
};

/**
 * Computes the current message branch based on a selection snapshot
 */
export const computeBranchFromSelection = (
  tree: MessageTreeResult,
  selection: BranchSelectionSnapshot
): MessageTreeNode[] => {
  const branch: MessageTreeNode[] = [];
  const roots = tree.tree;
  if (!roots.length) {
    return branch;
  }

  const rootNode = pickByIndexOrLatest(roots, selection.rootMessageIndex);
  let cursor = rootNode;

  while (cursor) {
    branch.push(cursor);
    const overrides = selection.selections ?? {};
    const preferredChildIndex = Object.prototype.hasOwnProperty.call(
      overrides,
      cursor.id
    )
      ? (overrides[cursor.id] ?? null)
      : (cursor.selectedChildIndex ?? null);

    cursor = pickByIndexOrLatest(cursor.children, preferredChildIndex);
  }

  return branch;
};

/**
 * Plans a branch switch for next/prev navigation
 * Returns null if the switch is not possible (no siblings, out of bounds, etc.)
 */
export const planBranchSwitch = ({
  tree,
  selection,
  messageId,
  direction,
}: {
  tree: MessageTreeResult;
  selection: BranchSelectionSnapshot;
  messageId: string;
  direction: 'next' | 'prev';
}): BranchSwitchPlan | null => {
  if (!tree) {
    return null;
  }

  const nodesById = new Map<string, MessageTreeNode>();
  const nodesByPath = new Map<string, MessageTreeNode>();

  for (const node of tree.nodes) {
    nodesById.set(node.id, node);
    if (node.pathText) {
      nodesByPath.set(node.pathText, node);
    }
  }

  const currentNode = nodesById.get(messageId);
  if (!currentNode) {
    return null;
  }

  const parent = currentNode.parentPath
    ? nodesByPath.get(currentNode.parentPath)
    : null;

  const siblings = parent ? parent.children : tree.tree;
  if (!siblings || siblings.length < 2) {
    return null;
  }

  const currentIndex = siblings.findIndex((child) => child.id === messageId);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
  if (nextIndex < 0 || nextIndex >= siblings.length) {
    return null;
  }

  const targetNode = siblings[nextIndex];
  const nextSnapshot = cloneSelectionSnapshot(selection);
  let operation: BranchSelectionOperation;

  if (!parent) {
    operation = { kind: 'root', rootMessageIndex: targetNode.siblingIndex };
    nextSnapshot.rootMessageIndex = targetNode.siblingIndex;
  } else {
    operation = {
      kind: 'child',
      parentId: parent.id,
      selectedChildIndex: targetNode.siblingIndex,
    };
    const selections = ensureSelectionMap(nextSnapshot);
    selections[parent.id] = targetNode.siblingIndex;
  }

  const branch = computeBranchFromSelection(tree, nextSnapshot);
  if (!branch.length) {
    return null;
  }

  return { branch, snapshot: nextSnapshot, operation };
};

/**
 * Helper to ensure selections map exists on snapshot
 */
const ensureSelectionMap = (
  snapshot: BranchSelectionSnapshot
): Record<string, number | null> => {
  if (!snapshot.selections) {
    snapshot.selections = {};
  }
  return snapshot.selections;
};
