import type { MessageTreeNode, MessageTreeResult } from '@/lib/db/schema';
import {
  chatOperationsMachine,
  type ChatOperationsInput,
} from '@/lib/state-machines/chat-operations.machine';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import { describe, expect, it, mock } from 'bun:test';
import { createActor, fromPromise } from 'xstate';

mock.module('@/app/actions/chat', () => ({
  updateBranchSelection: async () => {},
}));

mock.module('@/components/toast', () => ({
  toast: () => {},
}));

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const createMockTree = (): MessageTreeResult => {
  const now = new Date();

  const root: MessageTreeNode = {
    id: 'root',
    chatId: 'test-chat',
    role: 'user',
    parts: [{ type: 'text', text: 'Hello' }],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    model: null,
    pathText: '0',
    parentPath: null,
    siblingIndex: 0,
    siblingsCount: 1,
    selectedChildIndex: 0,
    depth: 0,
    children: [],
  };

  const branchA: MessageTreeNode = {
    id: 'msg-1',
    chatId: 'test-chat',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Response 1' }],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    model: 'test-model',
    pathText: '0.0',
    parentPath: '0',
    siblingIndex: 0,
    siblingsCount: 2,
    selectedChildIndex: 0,
    depth: 1,
    children: [],
  };

  const branchB: MessageTreeNode = {
    id: 'msg-2',
    chatId: 'test-chat',
    role: 'assistant',
    parts: [{ type: 'text', text: 'Response 2' }],
    attachments: [],
    createdAt: now,
    updatedAt: now,
    model: 'test-model',
    pathText: '0.1',
    parentPath: '0',
    siblingIndex: 1,
    siblingsCount: 2,
    selectedChildIndex: 0,
    depth: 1,
    children: [],
  };

  root.children = [branchA, branchB];

  return {
    tree: [root],
    nodes: [root, branchA, branchB],
    branch: [root, branchA],
    rootMessageIndex: 0,
  };
};

const createSelection = (): BranchSelectionSnapshot => ({
  rootMessageIndex: 0,
  selections: { root: 0 },
});

const createInput = (
  overrides: Partial<ChatOperationsInput> = {}
): ChatOperationsInput => ({
  chatId: 'test-chat',
  initialTree: createMockTree(),
  initialSelection: createSelection(),
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
  it('starts idle with expected context', () => {
    const actor = createActor(chatOperationsMachine, {
      input: createInput(),
    });

    actor.start();

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.activeOperation).toBe('idle');
    expect(actor.getSnapshot().context.selection?.rootMessageIndex).toBe(0);
  });

  it('blocks branch navigation while streaming', () => {
    const actor = createActor(chatOperationsMachine, {
      input: createInput(),
    });

    actor.start();
    actor.send({ type: 'STREAM_STARTED' });
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.pendingNavigation).toBe(null);
  });

  it('keeps latest queued navigation when busy', async () => {
    let resolvePersist: (() => void) | null = null;
    const pendingPersist = new Promise<void>((resolve) => {
      resolvePersist = resolve;
    });

    const actor = createActor(
      chatOperationsMachine.provide({
        actors: {
          persistSelection: fromPromise(() => pendingPersist),
          fetchAndApplyTree: fromPromise(async () => createMockTree()),
        },
      }),
      {
        input: createInput(),
      }
    );

    actor.start();
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

    await wait();

    actor.send({ type: 'NAVIGATE', messageId: 'msg-2', direction: 'prev' });
    actor.send({ type: 'NAVIGATE', messageId: 'msg-1', direction: 'next' });

    expect(actor.getSnapshot().context.pendingNavigation).toEqual({
      messageId: 'msg-1',
      direction: 'next',
    });

    resolvePersist?.();
  });

  it('starts regeneration and records target message', async () => {
    let calledWith: string | null = null;

    const actor = createActor(chatOperationsMachine, {
      input: createInput({
        triggerRegenerate: (messageId) => {
          calledWith = messageId;
        },
      }),
    });

    actor.start();
    actor.send({ type: 'REGENERATE', messageId: 'msg-1' });

    await wait();

    expect(actor.getSnapshot().context.activeOperation).toBe('regeneration');
    expect(calledWith).toBe('msg-1');
  });

  it('cancels regeneration and returns to idle', async () => {
    const actor = createActor(chatOperationsMachine, {
      input: createInput(),
    });

    actor.start();
    actor.send({ type: 'REGENERATE', messageId: 'msg-1' });

    await wait();

    actor.send({ type: 'CANCEL' });
    await wait();

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.activeOperation).toBe('idle');
    expect(actor.getSnapshot().context.regenerationMessageId).toBe(null);
  });

  it('defers user edit tree sync until streaming completes', async () => {
    let fetchCount = 0;

    const actor = createActor(
      chatOperationsMachine.provide({
        actors: {
          fetchAndApplyTree: fromPromise(async () => {
            fetchCount += 1;
            return createMockTree();
          }),
        },
      }),
      {
        input: createInput(),
      }
    );

    actor.start();
    actor.send({
      type: 'EDIT_COMPLETE',
      newMessageId: 'new-msg',
      role: 'user',
    });

    await wait(40);
    expect(fetchCount).toBe(0);

    actor.send({ type: 'STREAM_STARTED' });
    actor.send({ type: 'STREAM_FINISHED' });

    await wait(60);
    expect(fetchCount).toBe(1);
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('syncs assistant edits immediately', async () => {
    let fetchCount = 0;

    const actor = createActor(
      chatOperationsMachine.provide({
        actors: {
          fetchAndApplyTree: fromPromise(async () => {
            fetchCount += 1;
            return createMockTree();
          }),
        },
      }),
      {
        input: createInput(),
      }
    );

    actor.start();
    actor.send({
      type: 'EDIT_COMPLETE',
      newMessageId: 'new-msg',
      role: 'assistant',
    });

    await wait(60);

    expect(fetchCount).toBe(1);
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('syncs tree after stream completion in idle state', async () => {
    let fetchCount = 0;

    const actor = createActor(
      chatOperationsMachine.provide({
        actors: {
          fetchAndApplyTree: fromPromise(async () => {
            fetchCount += 1;
            return createMockTree();
          }),
        },
      }),
      {
        input: createInput(),
      }
    );

    actor.start();

    actor.send({ type: 'STREAM_STARTED' });
    actor.send({ type: 'STREAM_FINISHED' });

    await wait(60);

    expect(fetchCount).toBe(1);
    expect(actor.getSnapshot().context.pendingTreeSync).toBe(false);
  });
});
