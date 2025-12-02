import { describe, expect, it, mock } from 'bun:test';
import { createActor, fromPromise } from 'xstate';
import { chatOperationsMachine } from '@/lib/state-machines/chat-operations.machine';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

// Mock external dependencies
mock.module('@/app/(chat)/actions', () => ({
  updateBranchSelection: async () => {},
}));

mock.module('@/components/toast', () => ({
  toast: () => {},
}));

// Mock data helpers
const createMockTree = (): MessageTreeResult => {
  const now = new Date();
  const root: MessageTreeNode = {
    id: 'root',
    chatId: 'test-chat',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    attachments: [],
    createdAt: now,
    model: null,
    pathText: '0',
    parentPath: null,
    siblingIndex: 0,
    siblingsCount: 1,
    selectedChildIndex: 0,
    children: [],
  };
  const msg1: MessageTreeNode = {
    id: 'msg-1',
    chatId: 'test-chat',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Response 1' }],
    attachments: [],
    createdAt: now,
    model: 'test-model',
    pathText: '0.0',
    parentPath: '0',
    siblingIndex: 0,
    siblingsCount: 3,
    selectedChildIndex: null,
    children: [],
  };
  const msg2: MessageTreeNode = {
    id: 'msg-2',
    chatId: 'test-chat',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Response 2' }],
    attachments: [],
    createdAt: now,
    model: 'test-model',
    pathText: '0.1',
    parentPath: '0',
    siblingIndex: 1,
    siblingsCount: 3,
    selectedChildIndex: null,
    children: [],
  };
  const msg3: MessageTreeNode = {
    id: 'msg-3',
    chatId: 'test-chat',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Response 3' }],
    attachments: [],
    createdAt: now,
    model: 'test-model',
    pathText: '0.2',
    parentPath: '0',
    siblingIndex: 2,
    siblingsCount: 3,
    selectedChildIndex: null,
    children: [],
  };

  root.children = [msg1, msg2, msg3];

  return {
    tree: [root],
    nodes: [root, msg1, msg2, msg3],
    branch: [root, msg1],
    rootMessageIndex: 0,
  };
};

const createMockSelection = (): BranchSelectionSnapshot => ({
  rootMessageIndex: 0,
  selections: { root: 0 },
});

const createMockInput = (
  overrides: Partial<Parameters<typeof chatOperationsMachine.provide>[0]> = {}
) => ({
  chatId: 'test-chat',
  initialTree: createMockTree(),
  initialSelection: createMockSelection(),
  initialMessages: [],
  onMessagesChange: () => {},
  onTreeChange: () => {},
  onSelectionChange: () => {},
  fetchTree: async () => createMockTree(),
  persistBranchSelection: async () => {},
  triggerRegenerate: () => {},
  ...overrides,
});

describe('chatOperationsMachine', () => {
  describe('initialization', () => {
    it('should start in idle state', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.activeOperation).toBe('idle');
    });

    it('should initialize with provided context', () => {
      const mockTree = createMockTree();
      const mockSelection = createMockSelection();

      const actor = createActor(chatOperationsMachine, {
        input: createMockInput({
          initialTree: mockTree,
          initialSelection: mockSelection,
        }),
      });
      actor.start();

      expect(actor.getSnapshot().context.tree).toEqual(mockTree);
      expect(actor.getSnapshot().context.selection).toEqual(mockSelection);
    });
  });

  describe('branch navigation', () => {
    it('should transition to branchSwitch.planning on NAVIGATE event', async () => {
      let messagesChanged = false;
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput({
          onMessagesChange: () => {
            messagesChanged = true;
          },
        }),
      });

      actor.start();
      actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

      // Wait for transitions
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have triggered optimistic update
      expect(messagesChanged).toBe(true);
    });

    it('should block navigation when streaming', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();

      // Start streaming
      actor.send({ type: 'STREAM_STARTED' });
      expect(actor.getSnapshot().context.isStreaming).toBe(true);

      // Try to navigate - should stay in idle
      actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });
      expect(actor.getSnapshot().value).toBe('idle');
    });

    it('should queue navigation requests when busy (Latest Wins)', async () => {
      let resolvePersist: () => void;
      const persistPromise = new Promise<void>((resolve) => {
        resolvePersist = resolve;
      });

      const actor = createActor(
        chatOperationsMachine.provide({
          actors: {
            persistSelection: fromPromise(() => persistPromise),
            fetchAndApplyTree: fromPromise(async () => createMockTree()),
          },
        }),
        {
          input: createMockInput(),
        }
      );

      actor.start();

      // 1. Start a navigation
      actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // 2. Queue another navigation (should replace first)
      actor.send({ type: 'NAVIGATE', messageId: 'msg-2', direction: 'next' });
      expect(actor.getSnapshot().context.pendingNavigation).toEqual({
        messageId: 'msg-2',
        direction: 'next',
      });

      // 3. Queue another (should replace previous - Latest Wins)
      actor.send({ type: 'NAVIGATE', messageId: 'msg-3', direction: 'next' });
      expect(actor.getSnapshot().context.pendingNavigation).toEqual({
        messageId: 'msg-3',
        direction: 'next',
      });

      // Resolve to finish
      resolvePersist!();
    });
  });

  describe('regeneration', () => {
    it('should transition to regeneration.starting on REGENERATE event', async () => {
      let regenerateCalled = false;
      let regenerateMessageId: string | null = null;

      const actor = createActor(chatOperationsMachine, {
        input: createMockInput({
          triggerRegenerate: (messageId: string) => {
            regenerateCalled = true;
            regenerateMessageId = messageId;
          },
        }),
      });

      actor.start();
      actor.send({ type: 'REGENERATE', messageId: 'msg-1' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(actor.getSnapshot().context.activeOperation).toBe('regeneration');
      expect(regenerateCalled).toBe(true);
      expect(regenerateMessageId).toBe('msg-1');
    });

    it('should block regeneration when streaming', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();

      // Start streaming
      actor.send({ type: 'STREAM_STARTED' });

      // Try to regenerate - should stay in idle
      actor.send({ type: 'REGENERATE', messageId: 'msg-1' });
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.activeOperation).toBe('idle');
    });

    it('should handle regeneration cancel', async () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput({
          triggerRegenerate: () => {
            // Don't start stream immediately
          },
        }),
      });

      actor.start();
      actor.send({ type: 'REGENERATE', messageId: 'msg-1' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(actor.getSnapshot().context.activeOperation).toBe('regeneration');

      // Cancel
      actor.send({ type: 'CANCEL' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.activeOperation).toBe('idle');
      expect(actor.getSnapshot().context.regenerationMessageId).toBe(null);
    });
  });

  describe('streaming lifecycle', () => {
    it('should track streaming state', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();

      expect(actor.getSnapshot().context.isStreaming).toBe(false);

      actor.send({ type: 'STREAM_STARTED' });
      expect(actor.getSnapshot().context.isStreaming).toBe(true);
      expect(actor.getSnapshot().context.pendingTreeSync).toBe(true);

      actor.send({ type: 'STREAM_FINISHED' });
      expect(actor.getSnapshot().context.isStreaming).toBe(false);
    });

    it('should trigger tree sync after stream finishes', async () => {
      let fetchTreeCalled = false;

      const actor = createActor(
        chatOperationsMachine.provide({
          actors: {
            fetchAndApplyTree: fromPromise(async () => {
              fetchTreeCalled = true;
              return createMockTree();
            }),
          },
        }),
        {
          input: createMockInput(),
        }
      );

      actor.start();

      // Start and finish streaming
      actor.send({ type: 'STREAM_STARTED' });
      actor.send({ type: 'STREAM_FINISHED' });

      // Wait for sync
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchTreeCalled).toBe(true);
    });
  });

  describe('edit operations', () => {
    it('should handle assistant edit completion', async () => {
      let fetchTreeCalled = false;

      const actor = createActor(
        chatOperationsMachine.provide({
          actors: {
            fetchAndApplyTree: fromPromise(async () => {
              fetchTreeCalled = true;
              return createMockTree();
            }),
          },
        }),
        {
          input: createMockInput(),
        }
      );

      actor.start();

      actor.send({
        type: 'EDIT_COMPLETE',
        newMessageId: 'new-msg-id',
        role: 'assistant',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchTreeCalled).toBe(true);
      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.activeOperation).toBe('idle');
    });

    it('should handle user edit and wait for stream', async () => {
      let fetchTreeCallCount = 0;

      const actor = createActor(
        chatOperationsMachine.provide({
          actors: {
            fetchAndApplyTree: fromPromise(async () => {
              fetchTreeCallCount++;
              return createMockTree();
            }),
          },
        }),
        {
          input: createMockInput(),
        }
      );

      actor.start();

      // User edit triggers initial sync
      actor.send({
        type: 'EDIT_COMPLETE',
        newMessageId: 'new-msg-id',
        role: 'user',
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have fetched tree once and be waiting for stream
      expect(fetchTreeCallCount).toBe(1);

      // Simulate streaming
      actor.send({ type: 'STREAM_STARTED' });
      actor.send({ type: 'STREAM_FINISHED' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have fetched tree again after stream finished (final sync)
      expect(fetchTreeCallCount).toBe(2);
      expect(actor.getSnapshot().value).toBe('idle');
    });
  });

  describe('context updates', () => {
    it('should update messages on UPDATE_MESSAGES event', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();

      const newMessages = [
        {
          id: 'new-1',
          role: 'user' as const,
          parts: [],
          createdAt: new Date(),
        },
      ];

      actor.send({ type: 'UPDATE_MESSAGES', messages: newMessages });

      expect(actor.getSnapshot().context.messages).toEqual(newMessages);
    });

    it('should update tree on UPDATE_TREE event', () => {
      const actor = createActor(chatOperationsMachine, {
        input: createMockInput(),
      });
      actor.start();

      const newTree = createMockTree();
      newTree.rootMessageIndex = 1;

      actor.send({ type: 'UPDATE_TREE', tree: newTree });

      expect(actor.getSnapshot().context.tree?.rootMessageIndex).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should rollback on branch switch failure', async () => {
      let messagesChangedCount = 0;
      let rejectPersist: (err: Error) => void;
      const persistPromise = new Promise<void>((_, reject) => {
        rejectPersist = reject;
      });

      const actor = createActor(
        chatOperationsMachine.provide({
          actors: {
            persistSelection: fromPromise(() => persistPromise),
            fetchAndApplyTree: fromPromise(async () => createMockTree()),
          },
        }),
        {
          input: createMockInput({
            onMessagesChange: () => {
              messagesChangedCount++;
            },
          }),
        }
      );

      actor.start();

      // Start navigation
      actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Optimistic update should have happened
      expect(messagesChangedCount).toBe(1);

      // Fail the persist
      rejectPersist!(new Error('Network error'));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have rolled back (called onMessagesChange again)
      expect(messagesChangedCount).toBe(2);
      expect(actor.getSnapshot().value).toBe('idle');
    });
  });
});
