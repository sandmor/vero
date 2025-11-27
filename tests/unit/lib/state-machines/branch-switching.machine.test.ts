import { describe, expect, it, mock, spyOn } from 'bun:test';
import { createActor, fromPromise } from 'xstate';
import { branchSwitchMachine } from '@/lib/state-machines/branch-switching.machine';
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
  const root = {
    id: 'root',
    children: [],
    role: 'user',
    pathText: '0',
    createdAt: now,
  } as any;
  const msg1 = {
    id: 'msg-1',
    children: [],
    role: 'assistant',
    pathText: '0.0',
    parentPath: '0',
    siblingIndex: 0,
    createdAt: now,
  } as any;
  const msg2 = {
    id: 'msg-2',
    children: [],
    role: 'assistant',
    pathText: '0.1',
    parentPath: '0',
    siblingIndex: 1,
    createdAt: now,
  } as any;
  const msg3 = {
    id: 'msg-3',
    children: [],
    role: 'assistant',
    pathText: '0.2',
    parentPath: '0',
    siblingIndex: 2,
    createdAt: now,
  } as any;

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

describe('branchSwitchMachine', () => {
  it('sanity check: should start in idle', () => {
    const actor = createActor(branchSwitchMachine, {
      input: {
        chatId: 'test-chat',
        tree: createMockTree(),
        selection: createMockSelection(),
        previousMessages: [],
        onMessagesChange: () => {},
        onTreeChange: () => {},
        onRefreshTree: async () => {},
      },
    });
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('should transition to validating on NAVIGATE event', async () => {
    let messagesChanged = false;
    const actor = createActor(branchSwitchMachine, {
      input: {
        chatId: 'test-chat',
        tree: createMockTree(),
        selection: createMockSelection(),
        previousMessages: [],
        onMessagesChange: () => {
          messagesChanged = true;
        },
        onTreeChange: () => {},
        onRefreshTree: async () => {},
      },
    });

    actor.start();
    // Use msg-1 so next -> msg-2 is valid
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

    // Wait a bit for transitions
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have called onMessagesChange (optimistic update)
    expect(messagesChanged).toBe(true);
  });

  it('should queue navigation requests when busy (Latest Wins)', async () => {
    let resolvePersist: () => void;
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });

    const actor = createActor(
      branchSwitchMachine.provide({
        actors: {
          persistSelection: fromPromise(() => persistPromise),
          refreshTree: fromPromise(async () => {}),
        },
      }),
      {
        input: {
          chatId: 'test-chat',
          tree: createMockTree(),
          selection: createMockSelection(),
          previousMessages: [],
          onMessagesChange: () => {},
          onTreeChange: () => {},
          onRefreshTree: async () => {},
        },
      }
    );

    actor.start();

    // 1. Start a navigation -> should go to applying and get stuck in persistSelection
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(actor.getSnapshot().value).toBe('applying');

    // 2. Request navigation to msg-2 (should be queued)
    actor.send({ type: 'NAVIGATE', messageId: 'msg-2', direction: 'next' });
    expect(actor.getSnapshot().context.pendingNavigation).toEqual({
      messageId: 'msg-2',
      direction: 'next',
    });

    // 3. Request navigation to msg-3 (should overwrite msg-2 -> Latest Wins)
    actor.send({ type: 'NAVIGATE', messageId: 'msg-3', direction: 'next' });
    expect(actor.getSnapshot().context.pendingNavigation).toEqual({
      messageId: 'msg-3',
      direction: 'next',
    });

    // 4. Resolve persist -> should finish first nav, then process msg-3
    resolvePersist!();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(actor.getSnapshot().context.pendingNavigation).toBeNull();
  });

  it('should skip UI rollback if navigation is pending (Silent Rollback)', async () => {
    let resolvePersist1: () => void;
    let rejectPersist1: (err: Error) => void;
    const persistPromise1 = new Promise<void>((resolve, reject) => {
      resolvePersist1 = resolve;
      rejectPersist1 = reject;
    });

    let resolvePersist2: () => void;
    const persistPromise2 = new Promise<void>((resolve) => {
      resolvePersist2 = resolve;
    });

    let callCount = 0;
    let messagesChangedCount = 0;

    const actor = createActor(
      branchSwitchMachine.provide({
        actors: {
          persistSelection: fromPromise(() => {
            callCount++;
            if (callCount === 1) return persistPromise1;
            return persistPromise2;
          }),
          refreshTree: fromPromise(async () => {}),
        },
      }),
      {
        input: {
          chatId: 'test-chat',
          tree: createMockTree(),
          selection: createMockSelection(),
          previousMessages: [],
          onMessagesChange: () => {
            messagesChangedCount++;
          },
          onTreeChange: () => {},
          onRefreshTree: async () => {},
        },
      }
    );

    actor.start();

    // 1. Start navigation -> applying
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // messagesChangedCount should be 1 (optimistic update)
    expect(messagesChangedCount).toBe(1);

    // 2. Queue another navigation
    actor.send({ type: 'NAVIGATE', messageId: 'msg-2', direction: 'next' });

    // 3. Fail the first navigation
    rejectPersist1!(new Error('Network error'));

    await new Promise((resolve) => setTimeout(resolve, 50));

    // 4. Verify behavior
    // It should have gone applying -> rollingBack -> idle (then processed msg-2)
    // Crucially, messagesChangedCount should NOT have incremented for the rollback
    // because pendingNavigation (msg-2) was present.
    // However, it WILL increment again when msg-2 is processed and optimistic update happens.
    // So:
    // 1. Optimistic update (msg-1) -> count = 1
    // 2. Rollback (skipped) -> count = 1
    // 3. Optimistic update (msg-2) -> count = 2

    expect(messagesChangedCount).toBe(2);
    expect(actor.getSnapshot().context.messageId).toBe('msg-2');
  });
});
