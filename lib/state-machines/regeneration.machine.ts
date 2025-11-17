import { setup, assign, fromPromise } from 'xstate';
import { toast } from '@/components/toast';

export type RegenerationContext = {
  messageId: string | null;
  hasStarted: boolean;
  error: Error | null;
  // Callback to trigger actual regeneration
  regenerateFn: (messageId: string) => void;
  // Callback to check if branch is ready
  ensureBranchReadyFn: () => Promise<void> | null;
};

export type RegenerationEvents =
  | { type: 'REGENERATE'; messageId: string }
  | { type: 'STREAM_STARTED' }
  | { type: 'STREAM_FINISHED' }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export type RegenerationInput = {
  regenerateFn: (messageId: string) => void;
  ensureBranchReadyFn: () => Promise<void> | null;
};

export const regenerationMachine = setup({
  types: {} as {
    context: RegenerationContext;
    events: RegenerationEvents;
    input: RegenerationInput;
  },
  guards: {
    hasPendingBranchSwitch: ({ context }) => {
      const readiness = context.ensureBranchReadyFn();
      return readiness !== null;
    },
  },
  actions: {
    storeMessageId: assign({
      messageId: ({ event }) => {
        if (event.type === 'REGENERATE') {
          return event.messageId;
        }
        return null;
      },
    }),
    markStarted: assign({
      hasStarted: true,
    }),
    markNotStarted: assign({
      hasStarted: false,
    }),
    clearMessageId: assign({
      messageId: null,
    }),
    resetState: assign({
      messageId: null,
      hasStarted: false,
      error: null,
    }),
    storeError: assign({
      error: ({ event }) => {
        if ('error' in event) {
          return event.error as Error;
        }
        return new Error('Failed to regenerate message');
      },
    }),
    clearError: assign({
      error: null,
    }),
    triggerRegeneration: ({ context }) => {
      if (context.messageId) {
        context.regenerateFn(context.messageId);
      }
    },
    showRegeneratingToast: () => {
      toast({ type: 'success', description: 'Regenerating message…' });
    },
    showBranchSwitchBlockedToast: () => {
      toast({
        type: 'error',
        description:
          'Unable to regenerate while switching versions. Please try again.',
      });
    },
    showFailedToast: () => {
      toast({
        type: 'error',
        description: 'Failed to start regeneration.',
      });
    },
    logError: ({ event }) => {
      if ('error' in event) {
        console.error('Regenerate request failed', event.error);
      }
    },
  },
  actors: {
    // Define the actor here!
    ensureBranchReady: fromPromise(
      async ({
        input,
      }: {
        input: { readinessFn: () => Promise<void> | null };
      }) => {
        const readiness = input.readinessFn();
        if (readiness) {
          await readiness;
        }
      }
    ),
  },
}).createMachine({
  id: 'regeneration',
  context: ({ input }) => ({
    messageId: null,
    hasStarted: false,
    error: null,
    regenerateFn: input.regenerateFn,
    ensureBranchReadyFn: input.ensureBranchReadyFn,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        REGENERATE: {
          target: 'checkingBranchReadiness',
          actions: 'storeMessageId',
        },
      },
    },
    checkingBranchReadiness: {
      always: [
        {
          guard: 'hasPendingBranchSwitch',
          target: 'waitingForBranchReady',
        },
        {
          target: 'requesting',
        },
      ],
    },
    waitingForBranchReady: {
      invoke: {
        src: 'ensureBranchReady',
        input: ({ context }) => ({
          readinessFn: context.ensureBranchReadyFn,
        }),
        onDone: {
          target: 'requesting',
          actions: 'clearError',
        },
        onError: {
          target: 'idle',
          actions: [
            'storeError',
            'logError',
            'showBranchSwitchBlockedToast',
            'clearMessageId',
          ],
        },
      },
    },
    requesting: {
      entry: ['showRegeneratingToast', 'triggerRegeneration'],
      on: {
        STREAM_STARTED: {
          target: 'streaming',
          actions: 'markStarted',
        },
        CANCEL: {
          target: 'idle',
          actions: 'resetState',
        },
      },
    },
    streaming: {
      on: {
        STREAM_FINISHED: 'completing',
        CANCEL: {
          target: 'idle',
          actions: 'resetState',
        },
      },
    },
    completing: {
      // Wait a tick for any cleanup
      always: {
        target: 'idle',
        actions: 'resetState',
      },
    },
    failed: {
      entry: ['showFailedToast', 'logError'],
      always: {
        target: 'idle',
        actions: 'resetState',
      },
    },
  },
  on: {
    RESET: {
      target: '.idle',
      actions: 'resetState',
    },
    CANCEL: {
      target: '.idle',
      actions: 'resetState',
    },
  },
});
