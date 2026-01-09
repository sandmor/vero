/**
 * Chat Operations State Machine
 *
 * This machine orchestrates all chat message operations (edit, regenerate, branch switch)
 * to prevent race conditions and ensure proper sequencing of:
 * 1. Optimistic UI updates
 * 2. Backend persistence
 * 3. Tree synchronization
 *
 * Key principles:
 * - Only one "mutating" operation can be active at a time
 * - Branch navigation during streaming is blocked
 * - Tree sync is deferred until operations complete
 * - Rollback on failure restores previous state
 */

import { toast } from '@/components/toast';
import type { MessageTreeResult } from '@/lib/db/schema';
import type { ChatMessage } from '@/lib/types';
import { convertToUIMessages } from '@/lib/utils';
import {
  planBranchSwitch,
  type BranchSelectionOperation,
  type BranchSwitchPlan,
} from '@/lib/utils/branch-planning';
import {
  buildSelectionSnapshot,
  cloneSelectionSnapshot,
} from '@/lib/utils/selection-snapshot';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import {
  assign,
  fromPromise,
  setup,
  type ActorRefFrom,
  type DoneActorEvent,
} from 'xstate';

// ============================================================================
// Types
// ============================================================================

export type OperationType =
  | 'idle'
  | 'branch-switch'
  | 'regeneration'
  | 'edit-user'
  | 'edit-assistant';

export type ChatOperationsContext = {
  chatId: string;

  // Current state
  tree: MessageTreeResult | undefined;
  selection: BranchSelectionSnapshot | null;
  messages: ChatMessage[];

  // Operation state
  activeOperation: OperationType;
  isStreaming: boolean;

  // Branch switch specific
  branchPlan: BranchSwitchPlan | null;
  pendingNavigation: { messageId: string; direction: 'next' | 'prev' } | null;

  // Regeneration specific
  regenerationMessageId: string | null;
  regenerationStarted: boolean;

  // Edit specific
  editMessageId: string | null;
  editNewMessageId: string | null;

  // Rollback state
  previousMessages: ChatMessage[];
  previousTree: MessageTreeResult | undefined;
  previousSelection: BranchSelectionSnapshot | null;

  // Sync state
  pendingTreeSync: boolean;
  syncError: Error | null;

  // Callbacks
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onSelectionChange: (selection: BranchSelectionSnapshot) => void;

  // External dependencies
  fetchTree: () => Promise<MessageTreeResult>;
  persistBranchSelection: (
    operation: BranchSelectionOperation,
    snapshot: BranchSelectionSnapshot | null
  ) => Promise<void>;
  triggerRegenerate: (messageId: string) => void;
  onNavigationComplete?: () => void;
};

export type ChatOperationsEvents =
  // Branch navigation
  | { type: 'NAVIGATE'; messageId: string; direction: 'next' | 'prev' }
  // Regeneration
  | { type: 'REGENERATE'; messageId: string }
  // Edit operations
  | {
      type: 'EDIT_COMPLETE';
      newMessageId: string;
      role: 'user' | 'assistant';
    }
  // Streaming lifecycle
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_FINISHED' }
  // Tree sync
  | { type: 'TREE_UPDATED'; tree: MessageTreeResult }
  | { type: 'SYNC_TREE' }
  // Context updates
  | { type: 'UPDATE_MESSAGES'; messages: ChatMessage[] }
  | {
      type: 'UPDATE_TREE';
      tree: MessageTreeResult;
      selection?: BranchSelectionSnapshot;
    }
  // Control
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export type ChatOperationsInput = {
  chatId: string;
  initialTree: MessageTreeResult | undefined;
  initialSelection: BranchSelectionSnapshot | null;
  initialMessages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onSelectionChange: (selection: BranchSelectionSnapshot) => void;
  fetchTree: () => Promise<MessageTreeResult>;
  persistBranchSelection: (
    operation: BranchSelectionOperation,
    snapshot: BranchSelectionSnapshot | null
  ) => Promise<void>;
  triggerRegenerate: (messageId: string) => void;
  onNavigationComplete?: () => void;
};

// ============================================================================
// Machine Definition
// ============================================================================

export const chatOperationsMachine = setup({
  types: {} as {
    context: ChatOperationsContext;
    events: ChatOperationsEvents;
    input: ChatOperationsInput;
  },

  guards: {
    isStreaming: ({ context }) => context.isStreaming,
    hasValidTree: ({ context }) => context.tree !== undefined,
    hasPendingNavigation: ({ context }) => context.pendingNavigation !== null,
    hasPendingSync: ({ context }) => context.pendingTreeSync,
    canNavigate: ({ context }) =>
      !context.isStreaming && context.activeOperation === 'idle',
    canRegenerate: ({ context }) =>
      !context.isStreaming && context.activeOperation === 'idle',
    hasValidBranchPlan: ({ context }) =>
      context.branchPlan !== null && context.branchPlan.branch.length > 0,
    isRegenerationActive: ({ context }) =>
      context.activeOperation === 'regeneration',
    isEditActive: ({ context }) =>
      context.activeOperation === 'edit-user' ||
      context.activeOperation === 'edit-assistant',
    isBranchSwitchActive: ({ context }) =>
      context.activeOperation === 'branch-switch',
    shouldSyncAfterStream: ({ context }) =>
      !context.isStreaming &&
      context.pendingTreeSync &&
      context.activeOperation === 'idle',
  },

  actions: {
    // State management
    saveRollbackState: assign({
      previousMessages: ({ context }) => [...context.messages],
      previousTree: ({ context }) => context.tree,
      previousSelection: ({ context }) =>
        context.selection ? cloneSelectionSnapshot(context.selection) : null,
    }),

    rollback: ({ context }) => {
      context.onMessagesChange([...context.previousMessages]);
      if (context.previousTree) {
        context.onTreeChange(context.previousTree);
      }
      if (context.previousSelection) {
        context.onSelectionChange(
          cloneSelectionSnapshot(context.previousSelection)
        );
      }
    },

    restoreRollbackState: assign({
      messages: ({ context }) => [...context.previousMessages],
      tree: ({ context }) => context.previousTree,
      selection: ({ context }) =>
        context.previousSelection
          ? cloneSelectionSnapshot(context.previousSelection)
          : null,
    }),

    clearRollbackState: assign({
      previousMessages: [],
      previousTree: undefined,
      previousSelection: null,
    }),

    // Branch switch actions
    storePendingNavigation: assign({
      pendingNavigation: ({ event }) => {
        if (event.type === 'NAVIGATE') {
          return { messageId: event.messageId, direction: event.direction };
        }
        return null;
      },
    }),

    clearPendingNavigation: assign({
      pendingNavigation: null,
    }),

    computeBranchPlan: assign({
      branchPlan: ({ context, event }) => {
        if (!context.tree) return null;

        const messageId =
          event.type === 'NAVIGATE'
            ? event.messageId
            : context.pendingNavigation?.messageId;

        const direction =
          event.type === 'NAVIGATE'
            ? event.direction
            : context.pendingNavigation?.direction;

        if (!messageId || !direction) return null;

        const selection = context.selection ?? { rootMessageIndex: null };
        return planBranchSwitch({
          tree: context.tree,
          selection,
          messageId,
          direction,
        });
      },
    }),

    applyBranchSwitch: assign(({ context }) => {
      if (!context.branchPlan || !context.tree) {
        return {};
      }

      const nextMessages = convertToUIMessages(context.branchPlan.branch);
      context.onMessagesChange(nextMessages);

      const updatedTree: MessageTreeResult = {
        ...context.tree,
        branch: context.branchPlan.branch,
        rootMessageIndex: context.branchPlan.snapshot.rootMessageIndex,
      };

      // Update selectedChildIndex in nodes
      if (context.branchPlan.snapshot.selections) {
        updatedTree.nodes = context.tree.nodes.map((node) => {
          const selectedIndex =
            context.branchPlan!.snapshot.selections?.[node.id];
          if (selectedIndex !== undefined) {
            return { ...node, selectedChildIndex: selectedIndex ?? 0 };
          }
          return node;
        });
      }

      context.onTreeChange(updatedTree);

      const nextSelection = context.branchPlan.snapshot;
      context.onSelectionChange(nextSelection);

      return {
        messages: nextMessages,
        tree: updatedTree,
        selection: nextSelection,
        activeOperation: 'branch-switch' as OperationType,
      };
    }),

    clearBranchPlan: assign({
      branchPlan: null,
    }),

    // Regeneration actions
    storeRegenerationTarget: assign({
      regenerationMessageId: ({ event }) => {
        if (event.type === 'REGENERATE') {
          return event.messageId;
        }
        return null;
      },
      regenerationStarted: false,
      activeOperation: 'regeneration' as OperationType,
    }),

    triggerRegenerationCall: ({ context }) => {
      if (context.regenerationMessageId) {
        context.triggerRegenerate(context.regenerationMessageId);
      }
    },

    markRegenerationStarted: assign({
      regenerationStarted: true,
    }),

    clearRegenerationState: assign({
      regenerationMessageId: null,
      regenerationStarted: false,
    }),

    // Edit actions
    storeEditTarget: assign({
      editMessageId: ({ event }) => {
        if (event.type === 'EDIT_COMPLETE') {
          return null; // The edit is already complete
        }
        return null;
      },
      editNewMessageId: ({ event }) => {
        if (event.type === 'EDIT_COMPLETE') {
          return event.newMessageId;
        }
        return null;
      },
      activeOperation: ({ event }) => {
        if (event.type === 'EDIT_COMPLETE') {
          return event.role === 'user'
            ? ('edit-user' as OperationType)
            : ('edit-assistant' as OperationType);
        }
        return 'idle' as OperationType;
      },
    }),

    clearEditState: assign({
      editMessageId: null,
      editNewMessageId: null,
    }),

    // Streaming actions
    markStreamStarted: assign({
      isStreaming: true,
      pendingTreeSync: true,
    }),

    markStreamFinished: assign({
      isStreaming: false,
    }),

    // Tree sync actions
    markSyncPending: assign({
      pendingTreeSync: true,
    }),

    clearSyncPending: assign({
      pendingTreeSync: false,
    }),

    applyTreeUpdate: assign(({ context, event }) => {
      if (event.type !== 'TREE_UPDATED') return {};

      const tree = event.tree;
      const selection = buildSelectionSnapshot(tree);
      const messages = convertToUIMessages(tree.branch);

      context.onTreeChange(tree);
      context.onSelectionChange(selection);
      context.onMessagesChange(messages);

      return {
        tree,
        selection,
        messages,
        pendingTreeSync: false,
      };
    }),

    // Special action to apply tree from invoke done event
    applyFetchedTree: assign(({ context, event }) => {
      // Handle DoneActorEvent from fetchAndApplyTree invoke
      const tree = (event as unknown as DoneActorEvent<MessageTreeResult>)
        .output;
      if (!tree) return {};

      const selection = buildSelectionSnapshot(tree);
      const messages = convertToUIMessages(tree.branch);

      context.onTreeChange(tree);
      context.onSelectionChange(selection);
      context.onMessagesChange(messages);

      return {
        tree,
        selection,
        messages,
        pendingTreeSync: false,
      };
    }),

    updateMessages: assign({
      messages: ({ event }) => {
        if (event.type === 'UPDATE_MESSAGES') {
          return event.messages;
        }
        return [];
      },
    }),

    updateTreeAndSelection: assign(({ event }) => {
      if (event.type !== 'UPDATE_TREE') return {};
      return {
        tree: event.tree,
        selection: event.selection ?? buildSelectionSnapshot(event.tree),
      };
    }),

    // Operation lifecycle
    setActiveOperation: assign({
      activeOperation: (_, params: { operation: OperationType }) =>
        params.operation,
    }),

    clearActiveOperation: assign({
      activeOperation: 'idle' as OperationType,
    }),

    // Error handling
    storeSyncError: assign({
      syncError: ({ event }) => {
        if ('error' in event && event.error instanceof Error) {
          return event.error;
        }
        return new Error('Unknown sync error');
      },
    }),

    clearSyncError: assign({
      syncError: null,
    }),

    // Toast notifications
    showStreamingBlockedToast: () => {
      toast({
        type: 'error',
        description:
          'Finish generating the current response before switching versions.',
      });
    },

    showRegeneratingToast: () => {
      toast({ type: 'success', description: 'Regenerating message…' });
    },

    showBranchSwitchErrorToast: () => {
      toast({
        type: 'error',
        description: 'Failed to switch to the selected version.',
      });
    },

    notifyNavigationComplete: ({ context }) => {
      context.onNavigationComplete?.();
    },

    logError: ({ event }) => {
      if ('error' in event) {
        console.error('Chat operation error:', event.error);
      }
    },
  },

  actors: {
    persistSelection: fromPromise(
      async ({
        input,
      }: {
        input: {
          persist: (
            operation: BranchSelectionOperation,
            snapshot: BranchSelectionSnapshot | null
          ) => Promise<void>;
          operation: BranchSelectionOperation;
          snapshot: BranchSelectionSnapshot | null;
        };
      }) => {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            await input.persist(input.operation, input.snapshot);
            return;
          } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
          }
        }
      }
    ),

    fetchAndApplyTree: fromPromise(
      async ({
        input,
      }: {
        input: {
          fetchTree: () => Promise<MessageTreeResult>;
        };
      }) => {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            return await input.fetchTree();
          } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
          }
        }
        throw new Error('Failed to fetch tree after max attempts');
      }
    ),
  },
}).createMachine({
  id: 'chatOperations',

  context: ({ input }) => ({
    chatId: input.chatId,
    tree: input.initialTree,
    selection: input.initialSelection,
    messages: input.initialMessages,

    activeOperation: 'idle',
    isStreaming: false,

    branchPlan: null,
    pendingNavigation: null,

    regenerationMessageId: null,
    regenerationStarted: false,

    editMessageId: null,
    editNewMessageId: null,

    previousMessages: [],
    previousTree: undefined,
    previousSelection: null,

    pendingTreeSync: false,
    syncError: null,

    onMessagesChange: input.onMessagesChange,
    onTreeChange: input.onTreeChange,
    onSelectionChange: input.onSelectionChange,
    fetchTree: input.fetchTree,
    persistBranchSelection: input.persistBranchSelection,
    triggerRegenerate: input.triggerRegenerate,
    onNavigationComplete: input.onNavigationComplete,
  }),

  initial: 'idle',

  states: {
    idle: {
      always: [
        // Process pending navigation
        {
          guard: ({ context }) =>
            context.pendingNavigation !== null &&
            !context.isStreaming &&
            context.tree !== undefined,
          target: 'branchSwitch.planning',
        },
        // Sync tree if needed
        {
          guard: 'shouldSyncAfterStream',
          target: 'syncing',
        },
      ],

      on: {
        NAVIGATE: [
          {
            guard: 'isStreaming',
            actions: 'showStreamingBlockedToast',
          },
          {
            guard: 'hasValidTree',
            target: 'branchSwitch.planning',
            actions: 'storePendingNavigation',
          },
        ],

        REGENERATE: [
          {
            guard: 'isStreaming',
            actions: 'showStreamingBlockedToast',
          },
          {
            target: 'regeneration.starting',
            actions: ['saveRollbackState', 'storeRegenerationTarget'],
          },
        ],

        EDIT_COMPLETE: {
          target: 'editing.routing',
          actions: ['saveRollbackState', 'storeEditTarget'],
        },

        STREAM_STARTED: {
          actions: 'markStreamStarted',
          // Re-enter idle to trigger always transitions
          target: 'idle',
          reenter: true,
        },

        STREAM_FINISHED: {
          actions: 'markStreamFinished',
          // Re-enter idle to trigger always transitions (for tree sync)
          target: 'idle',
          reenter: true,
        },

        SYNC_TREE: {
          target: 'syncing',
        },

        UPDATE_MESSAGES: {
          actions: 'updateMessages',
        },

        UPDATE_TREE: {
          actions: 'updateTreeAndSelection',
        },
      },
    },

    branchSwitch: {
      initial: 'planning',

      states: {
        planning: {
          entry: ['saveRollbackState', 'computeBranchPlan'],

          always: [
            {
              guard: 'hasValidBranchPlan',
              target: 'applying',
            },
            {
              target: '#chatOperations.idle',
              actions: ['clearPendingNavigation', 'clearBranchPlan'],
            },
          ],

          on: {
            NAVIGATE: {
              actions: 'storePendingNavigation',
            },
          },
        },

        applying: {
          entry: 'applyBranchSwitch',

          invoke: {
            src: 'persistSelection',
            input: ({ context }) => ({
              persist: context.persistBranchSelection,
              operation: context.branchPlan!.operation,
              snapshot: context.previousSelection,
            }),
            onDone: 'syncing',
            onError: {
              target: 'rollingBack',
              actions: ['storeSyncError', 'logError'],
            },
          },

          on: {
            NAVIGATE: {
              actions: 'storePendingNavigation',
            },
          },
        },

        syncing: {
          invoke: {
            src: 'fetchAndApplyTree',
            input: ({ context }) => ({
              fetchTree: context.fetchTree,
            }),
            onDone: {
              target: '#chatOperations.idle',
              actions: [
                'applyFetchedTree',
                'clearBranchPlan',
                'clearPendingNavigation',
                'clearActiveOperation',
                'clearRollbackState',
                'notifyNavigationComplete',
              ],
            },
            onError: {
              target: '#chatOperations.idle',
              actions: ['clearBranchPlan', 'clearActiveOperation', 'logError'],
            },
          },

          on: {
            NAVIGATE: {
              actions: 'storePendingNavigation',
            },
          },
        },

        rollingBack: {
          entry: [
            'rollback',
            'restoreRollbackState',
            'showBranchSwitchErrorToast',
          ],

          always: {
            target: '#chatOperations.idle',
            actions: [
              'clearBranchPlan',
              'clearPendingNavigation',
              'clearActiveOperation',
            ],
          },
        },
      },

      on: {
        STREAM_STARTED: {
          actions: 'markStreamStarted',
        },
        STREAM_FINISHED: {
          actions: 'markStreamFinished',
        },
      },
    },

    regeneration: {
      initial: 'starting',

      states: {
        starting: {
          entry: ['showRegeneratingToast', 'triggerRegenerationCall'],

          on: {
            STREAM_STARTED: {
              target: 'streaming',
              actions: ['markStreamStarted', 'markRegenerationStarted'],
            },

            STREAM_FINISHED: {
              target: 'syncing',
              actions: 'markStreamFinished',
            },

            CANCEL: {
              target: '#chatOperations.idle',
              actions: [
                'clearRegenerationState',
                'clearActiveOperation',
                'clearRollbackState',
              ],
            },
          },
        },

        streaming: {
          on: {
            STREAM_FINISHED: {
              target: 'syncing',
              actions: 'markStreamFinished',
            },

            CANCEL: {
              target: '#chatOperations.idle',
              actions: ['clearRegenerationState', 'clearActiveOperation'],
            },

            NAVIGATE: {
              actions: ['storePendingNavigation', 'showStreamingBlockedToast'],
            },
          },
        },

        syncing: {
          invoke: {
            src: 'fetchAndApplyTree',
            input: ({ context }) => ({
              fetchTree: context.fetchTree,
            }),
            onDone: {
              target: '#chatOperations.idle',
              actions: [
                'applyFetchedTree',
                'clearRegenerationState',
                'clearActiveOperation',
                'clearRollbackState',
              ],
            },
            onError: {
              target: '#chatOperations.idle',
              actions: [
                'clearRegenerationState',
                'clearActiveOperation',
                'logError',
              ],
            },
          },

          on: {
            NAVIGATE: {
              actions: 'storePendingNavigation',
            },
          },
        },
      },

      on: {
        STREAM_STARTED: {
          actions: 'markStreamStarted',
        },
        STREAM_FINISHED: {
          actions: 'markStreamFinished',
        },
      },
    },

    editing: {
      initial: 'routing',

      states: {
        // Route based on edit type - user edits skip initial sync
        routing: {
          always: [
            // For user edits, skip initial sync and wait for stream
            // The server hasn't received the new message yet
            {
              guard: ({ context }) => context.activeOperation === 'edit-user',
              target: 'waitingForStream',
            },
            // For assistant edits, sync immediately
            {
              target: 'syncing',
            },
          ],
        },

        syncing: {
          invoke: {
            src: 'fetchAndApplyTree',
            input: ({ context }) => ({
              fetchTree: context.fetchTree,
            }),
            onDone: {
              target: '#chatOperations.idle',
              actions: [
                'applyFetchedTree',
                'clearEditState',
                'clearActiveOperation',
                'clearRollbackState',
              ],
            },
            onError: {
              target: '#chatOperations.idle',
              actions: ['clearEditState', 'clearActiveOperation', 'logError'],
            },
          },

          on: {
            STREAM_STARTED: {
              actions: 'markStreamStarted',
            },
            STREAM_FINISHED: {
              actions: 'markStreamFinished',
            },
          },
        },

        waitingForStream: {
          on: {
            STREAM_STARTED: {
              target: 'streaming',
              actions: 'markStreamStarted',
            },

            STREAM_FINISHED: {
              target: 'finalSync',
              actions: 'markStreamFinished',
            },
          },
        },

        streaming: {
          on: {
            STREAM_FINISHED: {
              target: 'finalSync',
              actions: 'markStreamFinished',
            },

            NAVIGATE: {
              actions: ['storePendingNavigation', 'showStreamingBlockedToast'],
            },
          },
        },

        finalSync: {
          invoke: {
            src: 'fetchAndApplyTree',
            input: ({ context }) => ({
              fetchTree: context.fetchTree,
            }),
            onDone: {
              target: '#chatOperations.idle',
              actions: [
                'applyFetchedTree',
                'clearEditState',
                'clearActiveOperation',
                'clearRollbackState',
              ],
            },
            onError: {
              target: '#chatOperations.idle',
              actions: ['clearEditState', 'clearActiveOperation', 'logError'],
            },
          },

          on: {
            NAVIGATE: {
              actions: 'storePendingNavigation',
            },
            STREAM_STARTED: {
              actions: 'markStreamStarted',
            },
            STREAM_FINISHED: {
              actions: 'markStreamFinished',
            },
          },
        },
      },
    },

    syncing: {
      invoke: {
        src: 'fetchAndApplyTree',
        input: ({ context }) => ({
          fetchTree: context.fetchTree,
        }),
        onDone: {
          target: 'idle',
          actions: ['applyFetchedTree', 'clearSyncPending'],
        },
        onError: {
          target: 'idle',
          actions: ['clearSyncPending', 'logError'],
        },
      },

      on: {
        NAVIGATE: {
          actions: 'storePendingNavigation',
        },

        STREAM_STARTED: {
          actions: 'markStreamStarted',
        },

        STREAM_FINISHED: {
          actions: 'markStreamFinished',
        },
      },
    },
  },
});

export type ChatOperationsMachine = typeof chatOperationsMachine;
export type ChatOperationsActor = ActorRefFrom<ChatOperationsMachine>;
