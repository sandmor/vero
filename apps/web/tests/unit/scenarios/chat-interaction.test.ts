import { describe, expect, it } from 'bun:test';
import type { MessageTreeNode, MessageTreeResult } from '@/lib/db/schema';
import {
  planBranchSwitch,
  computeBranchFromSelection,
} from '@/lib/utils/index';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

// Helper to create a node
const createNode = (
  id: string,
  pathText: string,
  parentPath: string | null,
  siblingIndex: number,
  siblingsCount: number,
  role: 'user' | 'assistant' = 'assistant'
): MessageTreeNode => {
  return {
    id,
    pathText,
    parentPath,
    siblingIndex,
    siblingsCount,
    role,
    parts: [],
    attachments: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    depth: pathText.split('.').length - 1,
    chatId: 'test-chat',
    model: 'test-model',
    selectedChildIndex: 0, // Default, often overridden in tests
    children: [],
  };
};

describe('Chat Interaction Scenarios', () => {
  // Scenario 1: Assistant Regeneration
  // User says "Hi", Assistant replies "Hello" (v1), then regenerates "Hi there" (v2).
  // Tree: User -> [Asst_v1, Asst_v2]
  describe('Assistant Regeneration (Branching)', () => {
    it('navigates correctly between regenerated assistant messages', () => {
      const userMsg = createNode('user-1', '0', null, 0, 1, 'user');
      const asstV1 = createNode('asst-v1', '0.0', '0', 0, 2, 'assistant');
      const asstV2 = createNode('asst-v2', '0.1', '0', 1, 2, 'assistant');

      userMsg.children = [asstV1, asstV2];

      const tree: MessageTreeResult = {
        tree: [userMsg],
        nodes: [userMsg, asstV1, asstV2],
        branch: [userMsg, asstV2], // Currently showing v2 (latest)
        rootMessageIndex: 0,
      };

      // Current state: v2 is selected
      const currentSelection: BranchSelectionSnapshot = {
        rootMessageIndex: 0,
        selections: { 'user-1': 1 }, // user-1 selected child index 1 (asst-v2)
      };

      // 1. Navigate Prev (v2 -> v1)
      const planPrev = planBranchSwitch({
        tree,
        selection: currentSelection,
        messageId: 'asst-v2',
        direction: 'prev',
      });

      expect(planPrev).not.toBeNull();
      expect(planPrev?.operation.childId).toBe('asst-v1');
      expect(planPrev?.snapshot.selections?.['user-1']).toBe(0);

      // 2. Navigate Next (v1 -> v2)
      // Simulate state after switching to v1
      const selectionV1: BranchSelectionSnapshot = {
        rootMessageIndex: 0,
        selections: { 'user-1': 0 },
      };

      const planNext = planBranchSwitch({
        tree,
        selection: selectionV1,
        messageId: 'asst-v1',
        direction: 'next',
      });

      expect(planNext).not.toBeNull();
      expect(planNext?.operation.childId).toBe('asst-v2');
      expect(planNext?.snapshot.selections?.['user-1']).toBe(1);
    });
  });

  // Scenario 2: User Message Editing
  // User says "Help" (v1) -> Asst "Sure".
  // User edits to "Help me" (v2) -> Asst "Okay".
  // Tree: [User_v1 -> Asst_A, User_v2 -> Asst_B]
  describe('User Message Editing (Branching)', () => {
    it('navigates between user message versions and preserves their children', () => {
      const userV1 = createNode('user-v1', '0', null, 0, 2, 'user');
      const asstA = createNode('asst-a', '0.0', '0', 0, 1, 'assistant');

      const userV2 = createNode('user-v2', '1', null, 1, 2, 'user');
      const asstB = createNode('asst-b', '1.0', '1', 0, 1, 'assistant');

      userV1.children = [asstA];
      userV2.children = [asstB];

      const tree: MessageTreeResult = {
        tree: [userV1, userV2],
        nodes: [userV1, asstA, userV2, asstB],
        branch: [userV2, asstB], // Currently showing v2 branch
        rootMessageIndex: 1,
      };

      // Current state: User v2 selected (root index 1)
      const currentSelection: BranchSelectionSnapshot = {
        rootMessageIndex: 1,
        selections: {},
      };

      // 1. Navigate Prev (User v2 -> User v1)
      const planPrev = planBranchSwitch({
        tree,
        selection: currentSelection,
        messageId: 'user-v2',
        direction: 'prev',
      });

      expect(planPrev).not.toBeNull();
      expect(planPrev?.operation.kind).toBe('root');
      expect(planPrev?.operation.rootMessageIndex).toBe(0);
      expect(planPrev?.operation.childId).toBe('user-v1');

      // Verify snapshot updates root index
      expect(planPrev?.snapshot.rootMessageIndex).toBe(0);

      // 2. Verify branch computation for the target state
      const branchV1 = computeBranchFromSelection(tree, planPrev!.snapshot);
      const branchIds = branchV1.map((n) => n.id);
      expect(branchIds).toEqual(['user-v1', 'asst-a']);
    });
  });

  // Scenario 3: Deep Branching (Assistant Edit)
  // User -> Asst -> User -> [Asst_v1, Asst_v2]
  describe('Deep Branching (Assistant Edit)', () => {
    it('navigates correctly in a deep tree', () => {
      const root = createNode('root', '0', null, 0, 1, 'user');
      const l1 = createNode('l1', '0.0', '0', 0, 1, 'assistant');
      const l2 = createNode('l2', '0.0.0', '0.0', 0, 1, 'user');

      const l3_v1 = createNode('l3-v1', '0.0.0.0', '0.0.0', 0, 2, 'assistant');
      const l3_v2 = createNode('l3-v2', '0.0.0.1', '0.0.0', 1, 2, 'assistant');

      root.children = [l1];
      l1.children = [l2];
      l2.children = [l3_v1, l3_v2];

      const tree: MessageTreeResult = {
        tree: [root],
        nodes: [root, l1, l2, l3_v1, l3_v2],
        branch: [root, l1, l2, l3_v1], // Currently on v1
        rootMessageIndex: 0,
      };

      const currentSelection: BranchSelectionSnapshot = {
        rootMessageIndex: 0,
        selections: { l2: 0 }, // l2 selected child 0 (l3-v1)
      };

      // Navigate Next (v1 -> v2)
      const plan = planBranchSwitch({
        tree,
        selection: currentSelection,
        messageId: 'l3-v1',
        direction: 'next',
      });

      expect(plan).not.toBeNull();
      expect(plan?.operation.parentId).toBe('l2');
      expect(plan?.operation.childId).toBe('l3-v2');
      expect(plan?.snapshot.selections?.['l2']).toBe(1);
    });
  });

  // Scenario 4: Mixed Branching (User Edit + Assistant Edit)
  // Root (User)
  //  -> Branch A (Asst v1) -> User A -> Asst A
  //  -> Branch B (Asst v2) -> User B -> [Asst B1, Asst B2]
  describe('Mixed Branching (Complex Navigation)', () => {
    it('handles navigation across different levels and branches', () => {
      const root = createNode('root', '0', null, 0, 1, 'user');

      // Branch A
      const asstV1 = createNode('asst-v1', '0.0', '0', 0, 2, 'assistant');
      const userA = createNode('user-a', '0.0.0', '0.0', 0, 1, 'user');
      const asstA = createNode('asst-a', '0.0.0.0', '0.0.0', 0, 1, 'assistant');

      // Branch B
      const asstV2 = createNode('asst-v2', '0.1', '0', 1, 2, 'assistant');
      const userB = createNode('user-b', '0.1.0', '0.1', 0, 1, 'user');
      const asstB1 = createNode(
        'asst-b1',
        '0.1.0.0',
        '0.1.0',
        0,
        2,
        'assistant'
      );
      const asstB2 = createNode(
        'asst-b2',
        '0.1.0.1',
        '0.1.0',
        1,
        2,
        'assistant'
      );

      root.children = [asstV1, asstV2];
      asstV1.children = [userA];
      userA.children = [asstA];

      asstV2.children = [userB];
      userB.children = [asstB1, asstB2];

      const tree: MessageTreeResult = {
        tree: [root],
        nodes: [root, asstV1, userA, asstA, asstV2, userB, asstB1, asstB2],
        branch: [root, asstV2, userB, asstB2], // Currently deep in Branch B, v2
        rootMessageIndex: 0,
      };

      // 1. Navigate from Asst B2 to Asst B1 (Deep sibling switch)
      const selectionDeep: BranchSelectionSnapshot = {
        rootMessageIndex: 0,
        selections: { root: 1, 'asst-v2': 0, 'user-b': 1 }, // root->v2, v2->userB, userB->b2
      };

      const planDeep = planBranchSwitch({
        tree,
        selection: selectionDeep,
        messageId: 'asst-b2',
        direction: 'prev',
      });

      expect(planDeep?.operation.childId).toBe('asst-b1');
      expect(planDeep?.snapshot.selections?.['user-b']).toBe(0);

      // 2. Navigate from Asst V2 to Asst V1 (High level switch)
      // This should switch the whole branch from B to A
      const planHigh = planBranchSwitch({
        tree,
        selection: selectionDeep,
        messageId: 'asst-v2',
        direction: 'prev',
      });

      expect(planHigh?.operation.childId).toBe('asst-v1');
      expect(planHigh?.snapshot.selections?.['root']).toBe(0);

      // Verify the resulting branch for High level switch
      const branchA = computeBranchFromSelection(tree, planHigh!.snapshot);
      const branchAIds = branchA.map((n) => n.id);
      // Should follow the "latest" or default path in Branch A since we haven't explicitly selected inside A yet
      // In this mock, pickByIndexOrLatest will pick index 0 if not specified, or latest timestamp.
      // Since we didn't set timestamps differently, it might rely on index.
      // Let's assume it picks the only children available.
      expect(branchAIds).toEqual(['root', 'asst-v1', 'user-a', 'asst-a']);
    });
  });
});
