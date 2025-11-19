import { setup, assign, fromPromise } from 'xstate';
import type { MessageTreeResult } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import type { ChatMessage } from '@/lib/types';
import { convertToUIMessages } from '@/lib/utils';
import { buildSelectionSnapshot } from '@/lib/utils/selection-snapshot';
import { shouldDeferTreeUpdate } from '@/lib/utils/tree-update';

export type TreeSyncContext = {
  chatId: string;
  currentTree: MessageTreeResult | undefined;
  deferredTree: MessageTreeResult | null;
  selection: BranchSelectionSnapshot | null;
  isStreaming: boolean;
  pendingPostStreamSync: boolean;
  error: Error | null;
  // Callbacks
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onSelectionChange: (selection: BranchSelectionSnapshot) => void;
  fetchTree: () => Promise<MessageTreeResult>;
};

export type TreeSyncEvents =
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_FINISHED' }
  | {
      type: 'TREE_UPDATE_REQUESTED';
      tree: MessageTreeResult;
      options?: TreeUpdateOptions;
    }
  | { type: 'SYNC_REQUESTED' }
  | { type: 'UPDATE_CONTEXT'; updates: Partial<TreeSyncContext> }
  | { type: 'RETRY' };

export type TreeUpdateOptions = {
  allowDuringStreaming?: boolean;
  ignoreSelectionAlignment?: boolean;
};

export type TreeSyncInput = {
  chatId: string;
  currentTree: MessageTreeResult | undefined;
  selection: BranchSelectionSnapshot | null;
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onSelectionChange: (selection: BranchSelectionSnapshot) => void;
  fetchTree: () => Promise<MessageTreeResult>;
};

export const treeSyncMachine = setup({
  types: {} as {
    context: TreeSyncContext;
    events: TreeSyncEvents;
    input: TreeSyncInput;
  },
  guards: {
    shouldDefer: ({ context, event }) => {
      if (event.type !== 'TREE_UPDATE_REQUESTED') return false;

      const treeSelection = buildSelectionSnapshot(event.tree);

      return shouldDeferTreeUpdate({
        isStreaming: context.isStreaming,
        desiredSelection: context.selection,
        treeSelection,
        options: event.options,
      });
    },
    hasDeferredTree: ({ context }) => {
      return context.deferredTree !== null;
    },
    isIdle: ({ context }) => {
      return !context.isStreaming;
    },
    shouldSyncPostStream: ({ context }) => {
      return (
        context.pendingPostStreamSync &&
        !context.isStreaming &&
        typeof context.fetchTree === 'function'
      );
    },
  },
  actions: {
    updateContextFromEvent: assign(({ event }) => {
      if (event.type === 'UPDATE_CONTEXT') {
        return event.updates;
      }
      return {};
    }),
    markStreaming: assign({
      isStreaming: true,
      pendingPostStreamSync: true,
    }),
    markNotStreaming: assign({
      isStreaming: false,
    }),
    deferTree: assign({
      deferredTree: ({ event }) => {
        if (event.type === 'TREE_UPDATE_REQUESTED') {
          return event.tree;
        }
        return null;
      },
    }),
    applyTree: ({ context, event }) => {
      const tree =
        event.type === 'TREE_UPDATE_REQUESTED'
          ? event.tree
          : context.currentTree;

      if (!tree) return;

      const selection = buildSelectionSnapshot(tree);
      const messages = convertToUIMessages(tree.branch);

      context.onTreeChange(tree);
      context.onSelectionChange(selection);
      context.onMessagesChange(messages);
    },
    applyTreeFromContext: ({ context }) => {
      const tree = context.currentTree;
      if (!tree) return;

      const selection = buildSelectionSnapshot(tree);
      const messages = convertToUIMessages(tree.branch);

      context.onTreeChange(tree);
      context.onSelectionChange(selection);
      context.onMessagesChange(messages);
    },
    applyDeferredTree: ({ context }) => {
      if (!context.deferredTree) return;

      const tree = context.deferredTree;
      const selection = buildSelectionSnapshot(tree);
      const messages = convertToUIMessages(tree.branch);

      context.onTreeChange(tree);
      context.onSelectionChange(selection);
      context.onMessagesChange(messages);
    },
    updateCurrentTree: assign(({ event }) => {
      if (event.type === 'TREE_UPDATE_REQUESTED') {
        return { currentTree: event.tree };
      }
      return {};
    }),
    updateTreeFromFetch: assign({
      currentTree: ({ event }) => {
        if ('data' in event && event.data) {
          return event.data as MessageTreeResult;
        }
        return undefined;
      },
    }),
    clearDeferredTree: assign({
      deferredTree: null,
    }),
    clearPendingPostStreamSync: assign({
      pendingPostStreamSync: false,
    }),
    storeError: assign({
      error: ({ event }) => {
        if ('error' in event) {
          return event.error as Error;
        }
        return null;
      },
    }),
    clearError: assign({
      error: null,
    }),
    logError: ({ event }) => {
      if ('error' in event) {
        console.error('Failed to sync message tree', event.error);
      }
    },
  },
  actors: {
    fetchTree: fromPromise(
      async ({
        input,
      }: {
        input: { fetchFn: () => Promise<MessageTreeResult> };
      }) => {
        return await input.fetchFn();
      }
    ),
  },
}).createMachine({
  id: 'treeSync',
  context: ({ input }) => ({
    chatId: input.chatId,
    currentTree: input.currentTree,
    deferredTree: null,
    selection: input.selection,
    isStreaming: false,
    pendingPostStreamSync: false,
    error: null,
    onMessagesChange: input.onMessagesChange,
    onTreeChange: input.onTreeChange,
    onSelectionChange: input.onSelectionChange,
    fetchTree: input.fetchTree,
  }),
  initial: 'idle',
  states: {
    idle: {
      always: [
        {
          guard: 'shouldSyncPostStream',
          target: 'fetching',
        },
      ],
      on: {
        TREE_UPDATE_REQUESTED: [
          {
            guard: 'shouldDefer',
            target: 'deferred',
            actions: 'deferTree',
          },
          {
            target: 'applying',
          },
        ],
        SYNC_REQUESTED: 'fetching',
        STREAM_STARTED: {
          actions: 'markStreaming',
        },
        UPDATE_CONTEXT: {
          actions: 'updateContextFromEvent',
        },
      },
    },
    deferred: {
      on: {
        TREE_UPDATE_REQUESTED: [
          {
            guard: 'shouldDefer',
            actions: 'deferTree',
          },
          {
            target: 'applying',
          },
        ],
        STREAM_FINISHED: {
          actions: 'markNotStreaming',
        },
        UPDATE_CONTEXT: {
          actions: 'updateContextFromEvent',
        },
      },
      always: [
        {
          guard: 'isIdle',
          target: 'applyingDeferred',
        },
      ],
    },
    applying: {
      entry: ['applyTree', 'updateCurrentTree', 'clearDeferredTree'],
      always: 'idle',
    },
    applyingDeferred: {
      entry: ['applyDeferredTree', 'clearDeferredTree'],
      always: 'idle',
    },
    fetching: {
      invoke: {
        src: 'fetchTree',
        input: ({ context }) => ({
          fetchFn: context.fetchTree,
        }),
        onDone: {
          target: 'applying',
          actions: [
            'updateTreeFromFetch',
            'clearError',
            'clearPendingPostStreamSync',
          ],
        },
        onError: {
          target: 'idle',
          actions: ['storeError', 'logError', 'clearPendingPostStreamSync'],
        },
      },
    },
  },
  on: {
    STREAM_FINISHED: {
      actions: 'markNotStreaming',
    },
  },
});
