import { describe, expect, it } from 'bun:test';
import { planBranchSwitch } from '@/lib/utils/branch-planning';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

// Helper to create a minimal valid MessageTreeNode for testing
function createNode(
  id: string,
  pathText: string,
  siblingIndex: number,
  siblingsCount: number,
  parentPath: string | null = null
): MessageTreeNode {
  return {
    id,
    pathText,
    parentPath,
    siblingIndex,
    siblingsCount,
    children: [],
    role: 'assistant',
    parts: [],
    attachments: [],
    createdAt: new Date(),
    depth: 0,
    chatId: 'test-chat-id',
    model: 'test-model',
    selectedChildIndex: 0,
  };
}

describe('planBranchSwitch', () => {
  it('plans a next branch switch with childId', () => {
    const node1 = createNode('msg-1', '_00', 0, 2);
    const node2 = createNode('msg-2', '_01', 1, 2);
    const tree: MessageTreeResult = {
      tree: [node1, node2],
      nodes: [node1, node2],
      branch: [node1],
      rootMessageIndex: 0,
    };
    const selection: BranchSelectionSnapshot = { rootMessageIndex: 0 };

    const plan = planBranchSwitch({
      tree,
      selection,
      messageId: 'msg-1',
      direction: 'next',
    });

    expect(plan).not.toBeNull();
    expect(plan?.operation.kind).toBe('root');
    expect(plan?.operation.rootMessageIndex).toBe(1);
    expect(plan?.operation.childId).toBe('msg-2');
  });

  it('plans a prev branch switch with childId for nested nodes', () => {
    const root = createNode('root', '_00', 0, 1);
    const child1 = createNode('child-1', '_00._00', 0, 2, '_00');
    const child2 = createNode('child-2', '_00._01', 1, 2, '_00');

    root.children = [child1, child2];

    const tree: MessageTreeResult = {
      tree: [root],
      nodes: [root, child1, child2],
      branch: [root, child2],
      rootMessageIndex: 0,
    };
    const selection: BranchSelectionSnapshot = {
      rootMessageIndex: 0,
      selections: { root: 1 },
    };

    const plan = planBranchSwitch({
      tree,
      selection,
      messageId: 'child-2',
      direction: 'prev',
    });

    expect(plan).not.toBeNull();
    expect(plan?.operation.kind).toBe('child');
    expect(plan?.operation.parentId).toBe('root');
    expect(plan?.operation.selectedChildIndex).toBe(0);
    expect(plan?.operation.childId).toBe('child-1');
  });
});
