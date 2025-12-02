import type {
  DBMessage,
  MessageTreeNode,
  MessageTreeResult,
} from '../db/schema';
import {
  PATH_PATTERN,
  getParentPath,
  parsePathSegments,
} from '@/lib/chat/message-path';

export interface BranchSelectionContext {
  rootMessageIndex?: number | null;
}

function toTimestamp(value: Date | string | number | null | undefined): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pickByIndexOrLatest(
  siblings: MessageTreeNode[],
  preferredIndex?: number | null
): MessageTreeNode | undefined {
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
}

/**
 * Build message tree from raw messages.
 * This function is shared between client and server to avoid data duplication.
 * Moving tree building to client reduces network transfer and storage costs.
 */
export function buildMessageTree(
  messages: DBMessage[],
  selection?: BranchSelectionContext
): MessageTreeResult {
  if (!messages.length) {
    return { tree: [], nodes: [], branch: [], rootMessageIndex: null };
  }

  const nodesByPath = new Map<string, MessageTreeNode>();
  const nodes: MessageTreeNode[] = [];

  for (const message of messages) {
    const pathText = message.pathText;
    if (!pathText || !PATH_PATTERN.test(pathText)) {
      continue;
    }

    const parentPath = getParentPath(pathText);
    const depth = parsePathSegments(pathText).length;
    const node: MessageTreeNode = {
      ...message,
      pathText,
      parentPath,
      depth,
      children: [],
      siblingsCount: 0,
      siblingIndex: 0,
    };

    nodesByPath.set(pathText, node);
    nodes.push(node);
  }

  const roots: MessageTreeNode[] = [];
  for (const node of nodes) {
    if (!node.parentPath) {
      roots.push(node);
      continue;
    }
    const parent = nodesByPath.get(node.parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (items: MessageTreeNode[]) => {
    items.sort((a, b) =>
      a.pathText.localeCompare(b.pathText, 'en', { sensitivity: 'case' })
    );
    for (const child of items) {
      if (child.children.length) sortChildren(child.children);
    }
  };
  sortChildren(roots);

  const stampSiblingStats = (topLevel: MessageTreeNode[]) => {
    const queue: MessageTreeNode[][] = [topLevel];
    while (queue.length) {
      const siblings = queue.shift()!;
      const count = siblings.length;
      for (let i = 0; i < count; i++) {
        const n = siblings[i];
        n.siblingsCount = count;
        n.siblingIndex = i;
        if (n.children.length) queue.push(n.children);
      }
    }
  };
  stampSiblingStats(roots);

  const branch: MessageTreeNode[] = [];
  let resolvedRootIndex: number | null = null;
  if (roots.length) {
    const preferredRootIndex = selection?.rootMessageIndex ?? null;
    let cursor = pickByIndexOrLatest(roots, preferredRootIndex);

    if (cursor) {
      resolvedRootIndex = cursor.siblingIndex;
    }

    while (cursor) {
      branch.push(cursor);
      cursor = pickByIndexOrLatest(
        cursor.children,
        cursor.selectedChildIndex ?? null
      );
    }
  }

  return { tree: roots, nodes, branch, rootMessageIndex: resolvedRootIndex };
}
