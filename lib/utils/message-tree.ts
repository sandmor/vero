import type {
  DBMessage,
  MessageTreeNode,
  MessageTreeResult,
} from '../db/schema';
const PATH_PATTERN = /^(_[0-9a-z]{2})(\._[0-9a-z]{2})*$/;

function parsePathSegments(path: string): string[] {
  return path.split('.').filter(Boolean);
}

function getParentPathFromText(path: string): string | null {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? null : path.slice(0, lastDot);
}

/**
 * Build message tree from raw messages.
 * This function is shared between client and server to avoid data duplication.
 * Moving tree building to client reduces network transfer and storage costs.
 */
export function buildMessageTree(
  messages: DBMessage[],
  headMessageId?: string | null
): MessageTreeResult {
  if (!messages.length) {
    return { tree: [], nodes: [], branch: [] };
  }

  const nodesByPath = new Map<string, MessageTreeNode>();
  const nodes: MessageTreeNode[] = [];

  for (const message of messages) {
    const pathText = message.pathText;
    if (!pathText || !PATH_PATTERN.test(pathText)) {
      continue;
    }

    const parentPath = getParentPathFromText(pathText);
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
  if (roots.length) {
    let cursor: MessageTreeNode | undefined;
    if (headMessageId) {
      const headMessage = messages.find((m) => m.id === headMessageId);
      cursor = headMessage ? nodesByPath.get(headMessage.pathText!) : undefined;
    } else {
      let latestMessage = messages[0];
      for (let i = 1; i < messages.length; i++) {
        if (messages[i].createdAt > latestMessage.createdAt) {
          latestMessage = messages[i];
        }
      }
      cursor = nodesByPath.get(latestMessage.pathText!);
    }

    while (cursor) {
      branch.push(cursor);
      if (!cursor.parentPath) break;
      cursor = nodesByPath.get(cursor.parentPath);
    }
    branch.reverse();
  }

  return { tree: roots, nodes, branch };
}
