import { describe, expect, it } from 'bun:test';
import type { MessageTreeNode, MessageTreeResult } from '@/lib/db/schema';
import {
  planBranchSwitch,
  computeBranchFromSelection,
  shouldDeferTreeUpdate,
  drainSelectionUpdateRef,
} from '@/components/chat/use-chat-messaging';
import type { SelectionUpdateState } from '@/components/chat/use-chat-messaging';

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

describe('planBranchSwitch', () => {
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
      rootMessageIndex: 0,
    };

    const initialSelection = { rootMessageIndex: 0, selections: { '0': 0 } };

    const plan = planBranchSwitch({
      tree,
      selection: initialSelection,
      messageId: 'assistant-1',
      direction: 'next',
    });

    expect(plan).not.toBeNull();
    if (!plan) {
      throw new Error('Expected a branch switch plan');
    }

    const branch = computeBranchFromSelection(tree, plan.snapshot);
    const branchIds = branch.map((node: MessageTreeNode) => node.id);
    expect(branchIds).toEqual(['user-1', 'assistant-2', 'user-2']);
    expect(branch[branch.length - 1].id).toBe('user-2');
  });

  it('switches to the next sibling and follows the newest leaf', () => {
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
      rootMessageIndex: 0,
    };

    const initialSelection = { rootMessageIndex: 0, selections: { '0': 0 } };

    const plan = planBranchSwitch({
      tree,
      selection: initialSelection,
      messageId: 'assistant-1',
      direction: 'next',
    });

    expect(plan).not.toBeNull();
    if (!plan) {
      throw new Error('Expected a branch switch plan');
    }

    const branch = computeBranchFromSelection(tree, plan.snapshot);
    const branchIds = branch.map((node: MessageTreeNode) => node.id);
    expect(branchIds).toEqual(['user-1', 'assistant-2', 'user-2']);
    expect(branch[branch.length - 1].id).toBe('user-2');
  });
});

describe('shouldDeferTreeUpdate', () => {
  it('defers during streaming unless explicitly allowed', () => {
    expect(
      shouldDeferTreeUpdate({
        isStreaming: true,
        desiredSelection: null,
        treeSelection: { rootMessageIndex: 0 },
      })
    ).toBe(true);

    expect(
      shouldDeferTreeUpdate({
        isStreaming: true,
        desiredSelection: null,
        treeSelection: { rootMessageIndex: 0 },
        options: { allowDuringStreaming: true },
      })
    ).toBe(false);
  });

  it('defers when the desired selection differs from the incoming tree selection', () => {
    expect(
      shouldDeferTreeUpdate({
        isStreaming: false,
        desiredSelection: { rootMessageIndex: 0 },
        treeSelection: { rootMessageIndex: 1 },
      })
    ).toBe(true);
  });

  it('allows updates when no desired selection is locked in', () => {
    expect(
      shouldDeferTreeUpdate({
        isStreaming: false,
        desiredSelection: null,
        treeSelection: { rootMessageIndex: 0 },
      })
    ).toBe(false);
  });
});

describe('drainSelectionUpdateRef', () => {
  const operation: SelectionUpdateState['operation'] = {
    kind: 'root',
    rootMessageIndex: 0,
  };

  it('returns null when there is no pending attempt', () => {
    const ref = { current: null };
    expect(drainSelectionUpdateRef(ref)).toBeNull();
  });

  it('resolves after a pending attempt completes', async () => {
    let resolvePromise: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const attemptId = Symbol('pending');

    const pendingState: SelectionUpdateState = {
      id: attemptId,
      operation,
      status: 'pending',
      promise: pendingPromise,
      error: null,
    };

    const successState: SelectionUpdateState = {
      id: attemptId,
      operation,
      status: 'success',
      promise: Promise.resolve(),
      error: null,
    };

    const ref = { current: pendingState };
    pendingPromise.then(() => {
      ref.current = successState;
    });

    const readiness = drainSelectionUpdateRef(ref);
    expect(readiness).not.toBeNull();

    resolvePromise!();
    await readiness;

    expect(ref.current).toBeNull();
  });

  it('propagates errors and clears the ref', async () => {
    const failure = new Error('boom');
    const ref = {
      current: {
        id: Symbol('error'),
        operation,
        status: 'error',
        promise: Promise.resolve(),
        error: failure,
      } satisfies SelectionUpdateState,
    };

    await expect(drainSelectionUpdateRef(ref)).rejects.toThrow('boom');
    expect(ref.current).toBeNull();
  });

  it('consumes completed attempts and returns null', () => {
    const ref = {
      current: {
        id: Symbol('success'),
        operation,
        status: 'success',
        promise: Promise.resolve(),
        error: null,
      } satisfies SelectionUpdateState,
    };

    expect(drainSelectionUpdateRef(ref)).toBeNull();
    expect(ref.current).toBeNull();
  });
});
