import { describe, expect, it } from 'bun:test';
import type { MessageTreeNode, MessageTreeResult } from '@/lib/db/schema';
import { calculateBranchSwitch } from '@/components/chat/use-chat-messaging';

const createNode = ({
  id,
  role,
  pathText,
  parentPath,
  depth,
  createdAt,
}: {
  id: string;
  role: 'user' | 'assistant';
  pathText: string;
  parentPath: string | null;
  depth: number;
  createdAt: Date;
}): MessageTreeNode => {
  return {
    id,
    chatId: 'chat-test',
    role,
    parts: [],
    attachments: [],
    createdAt,
    updatedAt: createdAt,
    parentId: parentPath ? 'parent-placeholder' : null,
    model: null,
    pathText,
    parentPath,
    depth,
    siblingsCount: 1,
    siblingIndex: 0,
    children: [],
  } as unknown as MessageTreeNode;
};

describe('calculateBranchSwitch', () => {
  it('switches to the next sibling and follows the newest leaf by default', () => {
    const base = new Date('2024-01-01T00:00:00Z');
    const userRoot = createNode({
      id: 'user-1',
      role: 'user',
      pathText: '0',
      parentPath: null,
      depth: 0,
      createdAt: base,
    });
    const assistantOriginal = createNode({
      id: 'assistant-1',
      role: 'assistant',
      pathText: '0.0',
      parentPath: '0',
      depth: 1,
      createdAt: new Date(base.getTime() + 60_000),
    });
    const assistantAlternate = createNode({
      id: 'assistant-2',
      role: 'assistant',
      pathText: '0.1',
      parentPath: '0',
      depth: 1,
      createdAt: new Date(base.getTime() + 120_000),
    });
    const userFollowUp = createNode({
      id: 'user-2',
      role: 'user',
      pathText: '0.1.0',
      parentPath: '0.1',
      depth: 2,
      createdAt: new Date(base.getTime() + 180_000),
    });

    userRoot.children = [assistantOriginal, assistantAlternate];
    assistantOriginal.children = [];
    assistantAlternate.children = [userFollowUp];
    userFollowUp.children = [];

    userRoot.siblingsCount = 1;
    userRoot.siblingIndex = 0;
    assistantOriginal.siblingsCount = 2;
    assistantOriginal.siblingIndex = 0;
    assistantAlternate.siblingsCount = 2;
    assistantAlternate.siblingIndex = 1;
    userFollowUp.siblingsCount = 1;
    userFollowUp.siblingIndex = 0;

    const tree: MessageTreeResult = {
      tree: [userRoot],
      nodes: [userRoot, assistantOriginal, assistantAlternate, userFollowUp],
      branch: [userRoot, assistantOriginal],
    };

    const result = calculateBranchSwitch({
      tree,
      messageId: 'assistant-1',
      direction: 'next',
    });

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected a branch switch result');
    }
    const branchIds = result.branchNodes.map((node) => node.id);
    expect(branchIds).toEqual(['user-1', 'assistant-2', 'user-2']);
    expect(result.headNode.id).toBe('user-2');
  });

  it('prefers a requested head when it exists in the target subtree', () => {
    const base = new Date('2024-01-02T00:00:00Z');
    const userRoot = createNode({
      id: 'user-1',
      role: 'user',
      pathText: '0',
      parentPath: null,
      depth: 0,
      createdAt: base,
    });
    const assistantOriginal = createNode({
      id: 'assistant-1',
      role: 'assistant',
      pathText: '0.0',
      parentPath: '0',
      depth: 1,
      createdAt: new Date(base.getTime() + 45_000),
    });
    const assistantAlternate = createNode({
      id: 'assistant-2',
      role: 'assistant',
      pathText: '0.1',
      parentPath: '0',
      depth: 1,
      createdAt: new Date(base.getTime() + 90_000),
    });
    const userRecent = createNode({
      id: 'user-2',
      role: 'user',
      pathText: '0.1.0',
      parentPath: '0.1',
      depth: 2,
      createdAt: new Date(base.getTime() + 150_000),
    });
    const userEarlier = createNode({
      id: 'user-3',
      role: 'user',
      pathText: '0.1.1',
      parentPath: '0.1',
      depth: 2,
      createdAt: new Date(base.getTime() + 120_000),
    });
    const assistantPreferred = createNode({
      id: 'assistant-3',
      role: 'assistant',
      pathText: '0.1.1.0',
      parentPath: '0.1.1',
      depth: 3,
      createdAt: new Date(base.getTime() + 121_000),
    });

    userRoot.children = [assistantOriginal, assistantAlternate];
    assistantOriginal.children = [];
    assistantAlternate.children = [userRecent, userEarlier];
    userRecent.children = [];
    userEarlier.children = [assistantPreferred];
    assistantPreferred.children = [];

    userRoot.siblingsCount = 1;
    userRoot.siblingIndex = 0;
    assistantOriginal.siblingsCount = 2;
    assistantOriginal.siblingIndex = 0;
    assistantAlternate.siblingsCount = 2;
    assistantAlternate.siblingIndex = 1;
    userRecent.siblingsCount = 2;
    userRecent.siblingIndex = 0;
    userEarlier.siblingsCount = 2;
    userEarlier.siblingIndex = 1;
    assistantPreferred.siblingsCount = 1;
    assistantPreferred.siblingIndex = 0;

    const tree: MessageTreeResult = {
      tree: [userRoot],
      nodes: [
        userRoot,
        assistantOriginal,
        assistantAlternate,
        userRecent,
        userEarlier,
        assistantPreferred,
      ],
      branch: [userRoot, assistantOriginal],
    };

    const result = calculateBranchSwitch({
      tree,
      messageId: 'assistant-1',
      direction: 'next',
      preferredHeadId: 'assistant-3',
    });

    expect(result).not.toBeNull();
    if (!result) {
      throw new Error('Expected a branch switch result');
    }
    const branchIds = result.branchNodes.map((node) => node.id);
    expect(branchIds).toEqual([
      'user-1',
      'assistant-2',
      'user-3',
      'assistant-3',
    ]);
    expect(result.headNode.id).toBe('assistant-3');
  });
});
