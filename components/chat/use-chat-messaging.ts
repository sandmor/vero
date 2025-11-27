import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { DataUIPart } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';
import { toast } from '@/components/toast';
import type { ChatPreferences } from './use-chat-preferences';
import { ChatSDKError, toChatError, type ChatError } from '@/lib/errors';
import type { ChatMessage, CustomUIDataTypes } from '@/lib/types';
import type { MessageTreeResult } from '@/lib/db/schema';
import type { AppUsage } from '@/lib/usage';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import {
  fetchWithErrorHandlers,
  generateUUID,
  getTextFromMessage,
} from '@/lib/utils';
import { buildEditedUserMessageParts } from '@/lib/message-editing';
import type { VisibilityType } from '../visibility-selector';
import { branchMessageAction, forkChatAction } from '@/app/(chat)/actions';
import type React from 'react';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { branchSwitchMachine } from '@/lib/state-machines/branch-switching.machine';
import { treeSyncMachine } from '@/lib/state-machines/tree-sync.machine';
import { regenerationMachine } from '@/lib/state-machines/regeneration.machine';
import {
  buildSelectionSnapshot,
  cloneSelectionSnapshot,
} from '@/lib/utils/selection-snapshot';

const IS_E2E = process.env.NEXT_PUBLIC_E2E === '1';

const NON_STREAMING_STATUSES = new Set([
  'ready',
  'idle',
  'error',
  'initial',
  'aborted',
  'cancelled',
  'canceled',
  'stopped',
  'failed',
  'paused',
]);

const isStreamingStatus = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  return !NON_STREAMING_STATUSES.has(value);
};

export type SelectionApi = {
  getSelectedIds: () => string[];
  removeFromSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setSelection: (ids: string[]) => void;
};

export type UseChatMessagingArgs = {
  chatId: string;
  initialMessageTree?: MessageTreeResult;
  initialMessages: ChatMessage[];
  visibilityType: VisibilityType;
  isReadonly: boolean;
  preferences: ChatPreferences;
  setUsage: (usage: AppUsage | undefined) => void;
  setDataStream: React.Dispatch<
    React.SetStateAction<DataUIPart<CustomUIDataTypes>[]>
  >;
  selection: SelectionApi;
};

export function useChatMessaging({
  chatId,
  initialMessageTree,
  initialMessages,
  visibilityType,
  isReadonly,
  preferences,
  setUsage,
  setDataStream,
  selection,
}: UseChatMessagingArgs) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    getSelectedIds,
    removeFromSelection,
    clearSelection,
    setSelection: assignSelection,
  } = selection;

  const currentMessageTreeRef = useRef<MessageTreeResult | undefined>(
    initialMessageTree
  );
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const chatDeletedRef = useRef(false);
  const selectionRef = useRef<BranchSelectionSnapshot | null>(
    initialMessageTree
      ? buildSelectionSnapshot(initialMessageTree)
      : { rootMessageIndex: null }
  );
  const treeSyncRef = useRef<Promise<void> | null>(null);

  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const {
    currentModelIdRef,
    stagedPinnedSlugsRef,
    stagedAllowedToolsRef,
    stagedReasoningEffortRef,
    stagedAgentIdRef,
    chatHasStartedRef,
    markChatAsStarted,
  } = preferences;

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop: stopStream,
    resumeStream,
    regenerate,
    error: chatError,
    clearError: clearChatError,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers as typeof fetch,
      prepareSendMessagesRequest(request) {
        const stagedPins = stagedPinnedSlugsRef.current;
        const stagedTools = stagedAllowedToolsRef.current;
        const stagedEffort = stagedReasoningEffortRef.current;
        const stagedAgentId = stagedAgentIdRef.current;
        const isRegenerationTrigger =
          request.trigger === 'regenerate-message' &&
          typeof request.messageId === 'string';
        let outgoingMessage = request.messages.at(-1);
        if (isRegenerationTrigger) {
          for (
            let index = request.messages.length - 1;
            index >= 0;
            index -= 1
          ) {
            const candidate = request.messages[index];
            if (candidate?.role === 'user') {
              outgoingMessage = candidate;
              break;
            }
          }
        }
        return {
          body: {
            ...request.body,
            id: request.id,
            message: outgoingMessage,
            regenerateMessageId: isRegenerationTrigger
              ? request.messageId
              : undefined,
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            pinnedSlugs: stagedPins.length > 0 ? stagedPins : undefined,
            allowedTools: !chatHasStartedRef.current ? stagedTools : undefined,
            reasoningEffort: !chatHasStartedRef.current
              ? stagedEffort
              : undefined,
            agentId: !chatHasStartedRef.current ? stagedAgentId : undefined,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((previous) => (previous ? [...previous, dataPart] : []));
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      if (!chatHasStartedRef.current) {
        // Only invalidate history for new chats to fetch the generated title
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        markChatAsStarted();
      }
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      } else {
        const chatError = toChatError(error);
        console.error('Chat error:', chatError);
        toast({
          type: 'error',
          description:
            chatError.type === 'unknown'
              ? 'An unexpected error occurred'
              : chatError.message,
        });
      }
    },
  });

  const streamingStateRef = useRef(isStreamingStatus(status));

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const refreshMessageTree = useCallback(async () => {
    if (IS_E2E) {
      return;
    }
    if (treeSyncRef.current) {
      return treeSyncRef.current;
    }

    const promise = (async () => {
      try {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        const tree = await getMessageTreeAction({ chatId });
        // Update via tree sync machine
        sendTreeSync({ type: 'TREE_UPDATE_REQUESTED', tree });
      } catch (error) {
        console.error('Failed to refresh message tree', error);
      } finally {
        treeSyncRef.current = null;
      }
    })();

    treeSyncRef.current = promise;
    return promise;
  }, [chatId]);

  // Initialize tree sync machine
  const [, sendTreeSync] = useMachine(treeSyncMachine, {
    input: {
      chatId,
      currentTree: initialMessageTree,
      selection: selectionRef.current,
      onMessagesChange: setMessages,
      onTreeChange: (tree) => {
        currentMessageTreeRef.current = tree;
      },
      onSelectionChange: (selection) => {
        selectionRef.current = selection;
      },
      fetchTree: async () => {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        return await getMessageTreeAction({ chatId });
      },
    },
  });

  // Initialize branch switch machine
  const [, sendBranch, branchActor] = useMachine(branchSwitchMachine, {
    input: {
      chatId,
      tree: currentMessageTreeRef.current,
      selection: selectionRef.current,
      previousMessages: messages,
      onMessagesChange: setMessages,
      onTreeChange: (tree) => {
        currentMessageTreeRef.current = tree;
      },
      onRefreshTree: refreshMessageTree,
    },
  });

  // Check if a branch switch is in progress
  const ensureBranchReady = useCallback((): Promise<void> | null => {
    const snapshot = branchActor.getSnapshot();

    // If already idle, no waiting needed
    if (snapshot.matches('idle')) {
      return null;
    }

    // Branch switch is in progress - subscribe to state changes
    return new Promise((resolve, reject) => {
      const subscription = branchActor.subscribe((state) => {
        if (state.matches('idle')) {
          subscription.unsubscribe();
          // Check if we ended in error state
          if (state.context.error) {
            reject(state.context.error);
          } else {
            resolve();
          }
        } else if (state.matches('rollingBack')) {
          subscription.unsubscribe();
          reject(state.context.error || new Error('Branch switch failed'));
        }
      });

      // Check immediately in case we already transitioned
      const currentState = branchActor.getSnapshot();
      if (currentState.matches('idle')) {
        subscription.unsubscribe();
        if (currentState.context.error) {
          reject(currentState.context.error);
        } else {
          resolve();
        }
      }
    });
  }, [branchActor]);

  const [regenerationState, sendRegeneration] = useMachine(
    regenerationMachine,
    {
      input: {
        regenerateFn: (messageId: string) => {
          regenerate({ messageId });
        },
        ensureBranchReadyFn: ensureBranchReady,
      },
    }
  );

  // Sync tree machine context with current state
  useEffect(() => {
    sendTreeSync({
      type: 'UPDATE_CONTEXT',
      updates: {
        selection: selectionRef.current,
        currentTree: currentMessageTreeRef.current,
      },
    });
  }, [sendTreeSync]);

  // Sync branch machine context
  useEffect(() => {
    sendBranch({
      type: 'UPDATE_CONTEXT',
      updates: {
        tree: currentMessageTreeRef.current,
        selection: selectionRef.current,
        previousMessages: messages,
      },
    });
  }, [sendBranch, messages]);

  // Handle streaming state changes
  useEffect(() => {
    const isStreaming = isStreamingStatus(status);
    const wasStreaming = streamingStateRef.current;

    if (isStreaming && !wasStreaming) {
      sendTreeSync({ type: 'STREAM_STARTED' });
      sendRegeneration({ type: 'STREAM_STARTED' });
    } else if (!isStreaming && wasStreaming) {
      sendTreeSync({ type: 'STREAM_FINISHED' });
      sendRegeneration({ type: 'STREAM_FINISHED' });
    }

    streamingStateRef.current = isStreaming;
  }, [status, sendRegeneration, sendTreeSync]);

  // Handle regeneration completion - refresh tree to get proper sibling metadata
  useEffect(() => {
    const regenerationMessageId = regenerationState.context.messageId;
    const hasStarted = regenerationState.context.hasStarted;

    if (!regenerationMessageId) {
      return;
    }

    // Only act when regeneration has started and stream is no longer active
    if (isStreamingStatus(status)) {
      return;
    }

    if (!hasStarted) {
      return;
    }

    // Regeneration completed - refresh the tree to get the new message with proper metadata
    let cancelled = false;
    (async () => {
      try {
        await refreshMessageTree();
        if (!cancelled) {
          sendRegeneration({ type: 'RESET' });
        }
      } catch (error) {
        if (!cancelled) {
          console.error(
            'Failed to refresh message tree after regeneration',
            error
          );
          sendRegeneration({ type: 'RESET' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    regenerationState.context.messageId,
    regenerationState.context.hasStarted,
    status,
    refreshMessageTree,
    sendRegeneration,
    queryClient,
  ]);

  const handleChatDeleted = useCallback(() => {
    if (chatDeletedRef.current) {
      return;
    }

    chatDeletedRef.current = true;
    clearSelection();
    setMessages([]);
    selectionRef.current = { rootMessageIndex: null };
    router.replace('/chat');
    queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
  }, [clearSelection, queryClient, router, setMessages]);

  const handleDeleteMessage = useCallback(
    async (messageId: string, mode: MessageDeletionMode) => {
      if (isReadonly) {
        return { chatDeleted: false } as const;
      }

      const previousSelection = [...getSelectedIds()];
      removeFromSelection([messageId]);

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages/${messageId}?mode=${encodeURIComponent(mode)}`,
          {
            method: 'DELETE',
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        sendTreeSync({ type: 'SYNC_REQUESTED' });

        const currentMessages = messagesRef.current;
        const remainingIds = new Set(
          currentMessages.map((message) => message.id)
        );
        const filteredSelection = previousSelection.filter((id) =>
          remainingIds.has(id)
        );
        assignSelection(filteredSelection);

        return { chatDeleted: false } as const;
      } catch (error) {
        assignSelection(previousSelection);
        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      getSelectedIds,
      handleChatDeleted,
      isReadonly,
      removeFromSelection,
      sendTreeSync,
    ]
  );

  const handleDeleteSelected = useCallback(
    async (mode: MessageDeletionMode) => {
      if (isReadonly) return;
      const ids = getSelectedIds();
      if (!ids.length) return;

      setIsBulkDeleting(true);
      let previousMessages: ChatMessage[] = [];
      const previousSelection = [...ids];
      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => !ids.includes(message.id));
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: ids, mode }),
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          toast({ type: 'success', description: 'Chat deleted.' });
          handleChatDeleted();
          return;
        }

        sendTreeSync({ type: 'SYNC_REQUESTED' });
        clearSelection();

        let successDescription = 'Messages deleted.';
        if (mode === 'message-with-following') {
          successDescription = 'Messages and following deleted.';
        } else if (mode === 'message-only') {
          successDescription = 'Messages deleted; following preserved.';
        } else if (mode === 'version') {
          successDescription = 'Message versions deleted.';
        }
        toast({ type: 'success', description: successDescription });
      } catch (error) {
        setMessages(previousMessages);
        assignSelection(previousSelection);
        if (error instanceof ChatSDKError) {
          toast({ type: 'error', description: error.message });
        } else {
          toast({ type: 'error', description: 'Failed to delete messages.' });
        }
      } finally {
        setIsBulkDeleting(false);
      }
    },
    [
      assignSelection,
      chatId,
      clearSelection,
      getSelectedIds,
      handleChatDeleted,
      isReadonly,
      sendTreeSync,
      setMessages,
    ]
  );

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      if (isReadonly) {
        return;
      }

      const target = messagesRef.current.find(
        (message) => message.id === messageId
      );
      if (!target) {
        toast({ type: 'error', description: 'Message not found.' });
        return;
      }

      const mode = target.role === 'assistant' ? 'clone' : 'edit';

      let editedText: string | undefined;
      if (mode === 'edit') {
        editedText = getTextFromMessage(target).trim();
        if (!editedText) {
          toast({
            type: 'error',
            description: 'Cannot fork this message without editable text.',
          });
          return;
        }
      }

      toast({ type: 'success', description: 'Forking chat…' });

      try {
        const { newChatId } = await forkChatAction({
          sourceChatId: chatId,
          pivotMessageId: target.id,
          mode,
          editedText,
        });

        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        }, 8000);

        const shouldRegenerate = target.role === 'user';
        router.push(
          `/chat/${newChatId}${shouldRegenerate ? '?regenerate=true' : ''}`
        );
      } catch (error) {
        console.error('Fork failed', error);
        toast({ type: 'error', description: 'Failed to fork chat.' });
      }
    },
    [chatId, isReadonly, queryClient, router]
  );

  const handleRegenerateAssistant = useCallback(
    async (assistantMessageId: string) => {
      if (isStreamingStatus(status)) {
        return;
      }
      if (regenerationState.context.messageId !== null) {
        return;
      }

      sendRegeneration({ type: 'REGENERATE', messageId: assistantMessageId });
    },
    [regenerationState.context.messageId, sendRegeneration, status]
  );

  const stop = useCallback(async () => {
    sendRegeneration({ type: 'CANCEL' });
    await stopStream();
  }, [sendRegeneration, stopStream]);

  const sendMessageWithBranchGuard = useCallback<typeof sendMessage>(
    (payload) => {
      const readiness = ensureBranchReady();
      if (!readiness) {
        return sendMessage(payload);
      }

      return readiness
        .then(() => sendMessage(payload))
        .catch((error) => {
          console.warn(
            'Skipping message send due to branch switch failure',
            error
          );
          toast({
            type: 'error',
            description:
              'Unable to switch to the selected response version. Message not sent.',
          });
        });
    },
    [ensureBranchReady, sendMessage]
  );

  const handleEditMessage = useCallback(
    async (messageId: string, editedText: string) => {
      if (isReadonly) {
        return;
      }

      const trimmed = editedText.trim();
      if (!trimmed) {
        toast({
          type: 'error',
          description: 'Message cannot be empty.',
        });
        throw new ChatSDKError('bad_request:chat');
      }

      const readiness = ensureBranchReady();
      if (readiness) {
        try {
          await readiness;
        } catch (error) {
          toast({
            type: 'error',
            description:
              'Unable to update message while switching versions. Please try again.',
          });
          throw error;
        }
      }

      const currentMessages = messagesRef.current;
      const targetIndex = currentMessages.findIndex(
        (message) => message.id === messageId
      );

      if (targetIndex === -1) {
        toast({ type: 'error', description: 'Message not found.' });
        throw new ChatSDKError('not_found:chat');
      }

      const targetMessage = currentMessages[targetIndex];
      const existingText = getTextFromMessage(targetMessage).trim();
      if (existingText === trimmed) {
        return;
      }

      const previousMessages = [...currentMessages];
      const previousTree = currentMessageTreeRef.current;
      const previousSnapshot =
        selectionRef.current !== null
          ? cloneSelectionSnapshot(selectionRef.current)
          : null;
      const previousSelectionIds = [...getSelectedIds()];

      if (targetMessage.role === 'user') {
        // User edited a user message - treat this as sending a NEW message
        // but preserve sibling metadata so user can see other versions
        const removedSelectionIds = previousMessages
          .slice(targetIndex)
          .map((message) => message.id);
        if (removedSelectionIds.length > 0) {
          removeFromSelection(removedSelectionIds);
        }

        const editedParts = buildEditedUserMessageParts(targetMessage, trimmed);

        try {
          // Step 1: Create a new branch with the edited text in the database
          const { newMessageId } = await branchMessageAction({
            chatId,
            messageId,
            editedText: trimmed,
          });

          // Reset selection - we're on a new branch
          selectionRef.current = null;
          currentMessageTreeRef.current = undefined;

          // Step 2: Refresh tree to get the new message WITH proper sibling metadata
          // This is crucial - the tree has siblingsCount, siblingIndex, etc.
          await refreshMessageTree();

          // Step 3: Find the new message in the refreshed tree
          const currentMessages = messagesRef.current;
          const newMessageInTree = currentMessages.find(
            (msg) => msg.id === newMessageId
          );

          // Step 4: Set up the UI state for sending
          const truncatedMessages = previousMessages.slice(0, targetIndex);

          if (newMessageInTree) {
            // We have the full message with sibling metadata - use it!
            // This ensures the UI shows "1 of N versions" correctly
            setMessages([...truncatedMessages, newMessageInTree]);
          } else {
            // Fallback: just truncate
            setMessages(truncatedMessages);
          }

          // Step 5: Send the message to trigger AI generation
          // useChat will either:
          // - See the message already exists and just trigger API call, OR
          // - Add it to state (if fallback above)
          // Either way, server handles duplicate via ON CONFLICT
          await sendMessage({
            id: newMessageId,
            role: 'user',
            parts: editedParts,
          });

          // Step 6: After generation completes, post-stream sync ensures everything is in sync

          toast({ type: 'success', description: 'Message updated.' });
        } catch (error) {
          // Rollback on error
          setMessages(previousMessages);
          assignSelection(previousSelectionIds);
          currentMessageTreeRef.current = previousTree;
          selectionRef.current = previousSnapshot
            ? cloneSelectionSnapshot(previousSnapshot)
            : null;

          if (error instanceof ChatSDKError) {
            toast({ type: 'error', description: error.message });
          } else {
            toast({ type: 'error', description: 'Failed to update message.' });
          }

          throw error;
        }

        return;
      }

      // Assistant message editing - create new version and switch to it
      try {
        // Branch the assistant message (creates new version in DB)
        const { newMessageId } = await branchMessageAction({
          chatId,
          messageId,
          editedText: trimmed,
        });

        // Reset selection - we're switching to a new branch/version
        selectionRef.current = null;
        currentMessageTreeRef.current = undefined;

        // Refresh tree to get the new branch structure with the new version
        await refreshMessageTree();

        // The tree refresh will automatically switch to the new version
        // because it's the latest one created

        toast({ type: 'success', description: 'Message updated.' });
      } catch (error) {
        // Rollback on error
        setMessages(previousMessages);
        assignSelection(previousSelectionIds);
        currentMessageTreeRef.current = previousTree;
        selectionRef.current = previousSnapshot
          ? cloneSelectionSnapshot(previousSnapshot)
          : null;

        if (error instanceof ChatSDKError) {
          toast({ type: 'error', description: error.message });
        } else {
          toast({ type: 'error', description: 'Failed to update message.' });
        }

        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      ensureBranchReady,
      getSelectedIds,
      isReadonly,
      queryClient,
      removeFromSelection,
      sendMessageWithBranchGuard,
      sendTreeSync,
      setMessages,
    ]
  );

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      if (isStreamingStatus(status)) {
        toast({
          type: 'error',
          description:
            'Finish generating the current response before switching versions.',
        });
        return;
      }

      sendBranch({ type: 'NAVIGATE', messageId, direction });
    },
    [sendBranch, status]
  );

  useEffect(() => {
    if (isStreamingStatus(status)) {
      return;
    }

    if (treeSyncRef.current) {
      return;
    }

    const tree = currentMessageTreeRef.current;
    if (!tree) {
      if (messages.length > 0) {
        sendTreeSync({ type: 'SYNC_REQUESTED' });
      }
      return;
    }

    const knownIds = new Set(tree.nodes.map((node) => node.id));
    const hasMissing = messages.some((message) => !knownIds.has(message.id));

    if (hasMissing) {
      sendTreeSync({ type: 'SYNC_REQUESTED' });
    }
  }, [messages, sendTreeSync, status]);

  const dedupedMessages = useMemo(() => {
    const seenIds = new Set<string>();
    return messages.filter((message) => {
      if (seenIds.has(message.id)) {
        return false;
      }
      seenIds.add(message.id);
      return true;
    });
  }, [messages]);

  const disableRegenerate =
    isStreamingStatus(status) || regenerationState.context.messageId !== null;

  return {
    messages: dedupedMessages,
    setMessages,
    sendMessage: sendMessageWithBranchGuard,
    status,
    stop,
    resumeStream,
    regenerate,
    chatError,
    clearChatError,
    handleDeleteMessage,
    handleDeleteSelected,
    handleForkMessage,
    handleEditMessage,
    handleRegenerateAssistant,
    handleNavigate,
    disableRegenerate,
    isBulkDeleting,
  } as const;
}
