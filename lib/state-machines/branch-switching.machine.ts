import { setup, assign, fromPromise } from 'xstate';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import type { ChatMessage } from '@/lib/types';
import {
  planBranchSwitch,
  type BranchSwitchPlan,
  type BranchSelectionOperation,
  cloneSelectionSnapshot,
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
        context.selection ? cloneSelectionSnapshot(context.selection) : null,
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

      // Update tree with new branch
      context.onTreeChange({
        ...context.tree,
        branch: context.plan.branch,
      });
    },
    updateSelection: assign({
      selection: ({ context }) => {
        return context.plan ? context.plan.snapshot : context.selection;
      },
    }),
    rollback: ({ context }) => {
      // Restore previous messages
      context.onMessagesChange([...context.previousMessages]);

      // Restore previous tree
      if (context.tree) {
        context.onTreeChange({
          ...context.tree,
          branch: context.previousBranch,
        });
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
        await updateBranchSelection({
          chatId: input.chatId,
          operation: input.operation,
          expectedSnapshot: input.snapshot ?? undefined,
        });
      }
    ),
    refreshTree: fromPromise(
      async ({ input }: { input: { refreshFn: () => Promise<void> } }) => {
        await input.refreshFn();
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
    onMessagesChange: input.onMessagesChange,
    onTreeChange: input.onTreeChange,
    onRefreshTree: input.onRefreshTree,
  }),
  initial: 'idle',
  states: {
    idle: {
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
      invoke: {
        src: 'persistSelection',
        input: ({ context }) => ({
          chatId: context.chatId,
          operation: context.plan!.operation,
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
        actions: 'clearNavigationRequest',
      },
    },
  },
});
