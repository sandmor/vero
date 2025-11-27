import { setup, assign, fromPromise } from 'xstate';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import type { ChatMessage } from '@/lib/types';
import {
  planBranchSwitch,
  type BranchSwitchPlan,
  type BranchSelectionOperation,
  cloneSelectionSnapshot,
  buildSelectionSnapshot,
} from '@/lib/utils/index';
import { updateBranchSelection } from '@/app/(chat)/actions';
import { toast } from '@/components/toast';
import { convertToUIMessages } from '@/lib/utils';

export type BranchSwitchContext = {
  chatId: string;
  tree: MessageTreeResult | undefined;
  selection: BranchSelectionSnapshot | null;
  messageId: string | null;
  direction: 'next' | 'prev' | null;
  plan: BranchSwitchPlan | null;
  error: Error | null;
  previousMessages: ChatMessage[];
  previousBranch: MessageTreeNode[];
  previousSelection: BranchSelectionSnapshot | null;
  // Callbacks to communicate with parent
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onRefreshTree: () => Promise<void>;
  pendingNavigation: { messageId: string; direction: 'next' | 'prev' } | null;
};

export type BranchSwitchEvents =
  | { type: 'NAVIGATE'; messageId: string; direction: 'next' | 'prev' }
  | { type: 'UPDATE_CONTEXT'; updates: Partial<BranchSwitchContext> };

export type BranchSwitchInput = {
  chatId: string;
  tree: MessageTreeResult | undefined;
  selection: BranchSelectionSnapshot | null;
  previousMessages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onTreeChange: (tree: MessageTreeResult) => void;
  onRefreshTree: () => Promise<void>;
};

export const branchSwitchMachine = setup({
  types: {} as {
    context: BranchSwitchContext;
    events: BranchSwitchEvents;
    input: BranchSwitchInput;
  },
  guards: {
    hasValidTree: ({ context }) => {
      return context.tree !== undefined;
    },
    hasValidPlan: ({ context }) => {
      return context.plan !== null && context.plan.branch.length > 0;
    },
  },
  actions: {
    storeNavigationRequest: assign({
      messageId: ({ event }) => {
        if (event.type === 'NAVIGATE') {
          return event.messageId;
        }
        return null;
      },
      direction: ({ event }) => {
        if (event.type === 'NAVIGATE') {
          return event.direction;
        }
        return null;
      },
    }),
    updateContextFromEvent: assign(({ event }) => {
      if (event.type === 'UPDATE_CONTEXT') {
        return event.updates;
      }
      return {};
    }),
    savePreviousState: assign({
      previousMessages: ({ context }) => [...context.previousMessages],
      previousBranch: ({ context }) =>
        context.tree ? [...context.tree.branch] : [],
      previousSelection: ({ context }) =>
        context.tree ? buildSelectionSnapshot(context.tree) : null,
    }),
    computePlan: assign({
      plan: ({ context }) => {
        if (!context.tree || !context.messageId || !context.direction) {
          return null;
        }

        const activeSelection = context.selection ?? { rootMessageIndex: null };

        return planBranchSwitch({
          tree: context.tree,
          selection: activeSelection,
          messageId: context.messageId,
          direction: context.direction,
        });
      },
    }),
    applyOptimisticUpdate: ({ context }) => {
      if (!context.plan || !context.tree) return;

      const nextMessages = convertToUIMessages(context.plan.branch);
      context.onMessagesChange(nextMessages);

      // Update tree with new branch AND selection metadata
      const updatedTree = {
        ...context.tree,
        branch: context.plan.branch,
        rootMessageIndex: context.plan.snapshot.rootMessageIndex,
      };

      // Also update selectedChildIndex in nodes if selections changed
      if (context.plan.snapshot.selections) {
        updatedTree.nodes = context.tree.nodes.map((node) => {
          if (context.plan!.snapshot.selections?.[node.id] !== undefined) {
            return {
              ...node,
              selectedChildIndex:
                context.plan!.snapshot.selections[node.id] ?? 0,
            };
          }
          return node;
        });
      }

      context.onTreeChange(updatedTree);
    },
    updateSelection: assign({
      selection: ({ context }) => {
        return context.plan ? context.plan.snapshot : context.selection;
      },
    }),
    rollback: ({ context }) => {
      // Silent Rollback: If there's a pending navigation, don't restore the UI
      // because we're about to navigate somewhere else anyway.
      if (context.pendingNavigation) {
        return;
      }

      // Restore previous messages
      context.onMessagesChange([...context.previousMessages]);

      // Restore previous tree with previous selection metadata
      if (context.tree && context.previousSelection) {
        const restoredTree = {
          ...context.tree,
          branch: context.previousBranch,
          rootMessageIndex: context.previousSelection.rootMessageIndex,
        };

        // Restore selectedChildIndex in nodes
        if (context.previousSelection.selections) {
          restoredTree.nodes = context.tree.nodes.map((node) => {
            if (
              context.previousSelection!.selections?.[node.id] !== undefined
            ) {
              return {
                ...node,
                selectedChildIndex:
                  context.previousSelection!.selections[node.id] ?? 0,
              };
            }
            return node;
          });
        }

        context.onTreeChange(restoredTree);
      }
    },
    restorePreviousSelection: assign({
      selection: ({ context }) => {
        return context.previousSelection
          ? cloneSelectionSnapshot(context.previousSelection)
          : context.selection;
      },
    }),
    clearNavigationRequest: assign({
      messageId: null,
      direction: null,
      plan: null,
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
    showBlockedToast: () => {
      toast({
        type: 'error',
        description:
          'Finish generating the current response before switching versions.',
      });
    },
  },
  actors: {
    persistSelection: fromPromise(
      async ({
        input,
      }: {
        input: {
          chatId: string;
          operation: BranchSelectionOperation;
          snapshot: BranchSelectionSnapshot | null;
        };
      }) => {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            await updateBranchSelection({
              chatId: input.chatId,
              operation: input.operation,
              expectedSnapshot: input.snapshot ?? undefined,
            });
            return;
          } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
          }
        }
      }
    ),
    refreshTree: fromPromise(
      async ({ input }: { input: { refreshFn: () => Promise<void> } }) => {
        let attempts = 0;
        const maxAttempts = 3;
        while (attempts < maxAttempts) {
          try {
            await input.refreshFn();
            return;
          } catch (error) {
            attempts++;
            if (attempts >= maxAttempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempts));
          }
        }
      }
    ),
  },
}).createMachine({
  id: 'branchSwitch',
  context: ({ input }) => ({
    chatId: input.chatId,
    tree: input.tree,
    selection: input.selection,
    messageId: null,
    direction: null,
    plan: null,
    error: null,
    previousMessages: input.previousMessages,
    previousBranch: [],
    previousSelection: null,
    pendingNavigation: null,
    onMessagesChange: input.onMessagesChange,
    onTreeChange: input.onTreeChange,
    onRefreshTree: input.onRefreshTree,
  }),
  initial: 'idle',
  states: {
    idle: {
      always: {
        guard: ({ context }) => context.pendingNavigation !== null,
        target: 'validating',
        actions: assign({
          messageId: ({ context }) => context.pendingNavigation!.messageId,
          direction: ({ context }) => context.pendingNavigation!.direction,
          pendingNavigation: null,
        }),
      },
      on: {
        NAVIGATE: {
          target: 'validating',
          actions: 'storeNavigationRequest',
        },
        UPDATE_CONTEXT: {
          actions: 'updateContextFromEvent',
        },
      },
    },
    validating: {
      on: {
        NAVIGATE: {
          actions: assign({
            pendingNavigation: ({ event }) => ({
              messageId: event.messageId,
              direction: event.direction,
            }),
          }),
        },
      },
      always: [
        {
          guard: 'hasValidTree',
          target: 'planning',
        },
        {
          target: 'idle',
          actions: 'clearNavigationRequest',
        },
      ],
    },
    planning: {
      entry: ['savePreviousState', 'computePlan'],
      on: {
        NAVIGATE: {
          actions: assign({
            pendingNavigation: ({ event }) => ({
              messageId: event.messageId,
              direction: event.direction,
            }),
          }),
        },
      },
      always: [
        {
          guard: 'hasValidPlan',
          target: 'applying',
        },
        {
          target: 'idle',
          actions: 'clearNavigationRequest',
        },
      ],
    },
    applying: {
      entry: ['applyOptimisticUpdate', 'updateSelection'],
      on: {
        NAVIGATE: {
          actions: assign({
            pendingNavigation: ({ event }) => ({
              messageId: event.messageId,
              direction: event.direction,
            }),
          }),
        },
      },
      invoke: {
        src: 'persistSelection',
        input: ({ context }) => ({
          chatId: context.chatId,
          operation: {
            ...context.plan!.operation,
            childId: context.plan!.operation.childId,
          },
          snapshot: context.previousSelection,
        }),
        onDone: {
          target: 'syncing',
          actions: 'clearError',
        },
        onError: {
          target: 'rollingBack',
          actions: 'storeError',
        },
      },
    },
    syncing: {
      on: {
        NAVIGATE: {
          actions: assign({
            pendingNavigation: ({ event }) => ({
              messageId: event.messageId,
              direction: event.direction,
            }),
          }),
        },
      },
      invoke: {
        src: 'refreshTree',
        input: ({ context }) => ({
          refreshFn: context.onRefreshTree,
        }),
        onDone: {
          target: 'idle',
          actions: 'clearNavigationRequest',
        },
        onError: {
          target: 'idle',
          actions: ['clearNavigationRequest', 'storeError'],
        },
      },
    },
    rollingBack: {
      entry: ['rollback', 'restorePreviousSelection'],
      always: {
        target: 'idle',
      },
    },
  },
});
