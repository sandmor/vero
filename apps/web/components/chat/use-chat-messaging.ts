import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { DataUIPart } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMachine } from '@xstate/react';
import { toast } from '@/components/toast';
import type { ChatPreferences } from './use-chat-preferences';
import { ChatSDKError, toChatError } from '@/lib/errors';
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
import {
  branchMessageAction,
  forkChatAction,
  updateBranchSelection,
  updateMessageTextAction,
} from '@/app/actions/chat';
import type React from 'react';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { chatOperationsMachine } from '@/lib/state-machines/chat-operations.machine';
import {
  buildSelectionSnapshot,
  cloneSelectionSnapshot,
} from '@/lib/utils/selection-snapshot';
import type { BranchSelectionOperation } from '@/lib/utils/branch-planning';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { useExternalChatSync } from './use-external-chat-sync';
import { getSyncManager } from '@/lib/cache/sync-manager';

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
    addOptimisticChat,
    setActiveChat,
    markGenerationStarted,
    markGenerationEnded,
    recordLocalChange,
  } = useEncryptedCache();

  const {
    getSelectedIds,
    removeFromSelection,
    clearSelection,
    setSelection: assignSelection,
  } = selection;

  // Track current state in refs for synchronous access
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
      if (dataPart.type === 'data-init') {
        const { modelId } = dataPart.data as { modelId?: string };
        if (modelId) {
          setMessages((currentMessages) => {
            const lastMessage = currentMessages.at(-1);
            if (!lastMessage || lastMessage.role !== 'assistant') {
              return currentMessages;
            }
            // Create a new array and new message object to trigger re-render
            const newMessages = [...currentMessages];
            // Ensure strict typing for metadata update
            const currentMetadata = lastMessage.metadata || {
              createdAt: new Date().toISOString(),
              siblingIndex: 0,
              siblingsCount: 1,
            };
            newMessages[newMessages.length - 1] = {
              ...lastMessage,
              metadata: {
                ...currentMetadata,
                createdAt:
                  currentMetadata.createdAt ?? new Date().toISOString(),
                model: modelId,
              },
            };
            return newMessages;
          });
        }
      }
    },
    onFinish: () => {
      if (!chatHasStartedRef.current) {
        // Add optimistic entry for immediate sidebar display
        addOptimisticChat({ id: chatId, title: 'New Chat' });
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

  // Track previous streaming state to detect transitions
  const streamingStateRef = useRef(isStreamingStatus(status));

  // Set this chat as the active chat for sync protection
  useEffect(() => {
    setActiveChat(chatId);
    return () => {
      setActiveChat(null);
    };
  }, [chatId, setActiveChat]);

  // Keep refs in sync with state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Listen for external updates from other tabs via BroadcastChannel
  const { markLocalUpdate } = useExternalChatSync({
    chatId,
    messages,
    setMessages,
    isStreaming: isStreamingStatus(status),
  });

  // Fetch tree function for the machine
  const fetchTree = useCallback(async (): Promise<MessageTreeResult> => {
    if (IS_E2E) {
      // In E2E mode, return the current tree state from the machine
      // This is a no-op fetch since we can't call the server
      const currentTree = currentMessageTreeRef.current;
      if (currentTree) {
        return currentTree;
      }
      // If no tree is available, return an empty tree
      return { tree: [], nodes: [], branch: [], rootMessageIndex: null };
    }
    const { getMessageTreeAction } = await import('@/app/actions/chat');
    return await getMessageTreeAction({ chatId });
  }, [chatId]);

  // Persist branch selection function for the machine
  const persistBranchSelection = useCallback(
    async (
      operation: BranchSelectionOperation,
      snapshot: BranchSelectionSnapshot | null
    ) => {
      if (IS_E2E) return;
      await updateBranchSelection({
        chatId,
        operation,
        expectedSnapshot: snapshot ?? undefined,
      });
    },
    [chatId]
  );

  // Initialize the unified chat operations machine
  const [operationsState, sendOperations, operationsActor] = useMachine(
    chatOperationsMachine,
    {
      input: {
        chatId,
        initialTree: initialMessageTree,
        initialSelection: selectionRef.current,
        initialMessages,
        onMessagesChange: setMessages,
        onTreeChange: (tree) => {
          currentMessageTreeRef.current = tree;
        },
        onSelectionChange: (selection) => {
          selectionRef.current = selection;
        },
        fetchTree,
        persistBranchSelection,
        triggerRegenerate: (messageId: string) => {
          regenerate({ messageId });
        },
      },
    }
  );

  // Debug: Log state machine transitions and invalidate cache when operations complete
  useEffect(() => {
    let previousOperation: string = 'idle';
    const subscription = operationsActor.subscribe((state) => {
      const currentOperation = state.context.activeOperation;
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          'Chat Operations State:',
          JSON.stringify(state.value),
          '| Active Operation:',
          currentOperation
        );
      }

      // Invalidate bootstrap cache when a mutating operation completes
      // This ensures the updated messages are fetched on reload
      if (
        previousOperation !== 'idle' &&
        currentOperation === 'idle' &&
        !state.context.isStreaming
      ) {
        queryClient.invalidateQueries({
          queryKey: ['chat', 'bootstrap', chatId],
        });
      }
      previousOperation = currentOperation;
    });
    return () => subscription.unsubscribe();
  }, [chatId, operationsActor, queryClient]);

  // Sync streaming state with the operations machine and SyncManager
  useEffect(() => {
    const isStreaming = isStreamingStatus(status);
    const wasStreaming = streamingStateRef.current;

    if (isStreaming && !wasStreaming) {
      sendOperations({ type: 'STREAM_STARTED' });
      // Notify SyncManager that generation started - protects this chat from external syncs
      markGenerationStarted();
    } else if (!isStreaming && wasStreaming) {
      sendOperations({ type: 'STREAM_FINISHED' });
      // Notify SyncManager that generation ended - protection window begins
      markGenerationEnded();
      // Record local change for echo filtering
      recordLocalChange(chatId);

      // Notify other tabs about the message update via the tab-leader BroadcastChannel
      const syncManager = getSyncManager();
      syncManager?.notifyMessagesUpdated(chatId);
    }

    streamingStateRef.current = isStreaming;
  }, [
    status,
    sendOperations,
    chatId,
    markGenerationStarted,
    markGenerationEnded,
    recordLocalChange,
  ]);

  // Sync messages with the machine when they change externally
  useEffect(() => {
    sendOperations({ type: 'UPDATE_MESSAGES', messages });
  }, [messages, sendOperations]);

  // Helper to check if operation machine is busy
  const isOperationBusy = useCallback((): boolean => {
    const snapshot = operationsActor.getSnapshot();
    return snapshot.context.activeOperation !== 'idle';
  }, [operationsActor]);

  // Wait for any active operation to complete
  const ensureOperationsReady = useCallback((): Promise<void> | null => {
    const snapshot = operationsActor.getSnapshot();

    if (
      snapshot.context.activeOperation === 'idle' &&
      !snapshot.context.isStreaming
    ) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const subscription = operationsActor.subscribe((state) => {
        if (
          state.context.activeOperation === 'idle' &&
          !state.context.isStreaming
        ) {
          subscription.unsubscribe();
          if (state.context.syncError) {
            reject(state.context.syncError);
          } else {
            resolve();
          }
        }
      });

      // Check immediately in case we already transitioned
      const currentState = operationsActor.getSnapshot();
      if (
        currentState.context.activeOperation === 'idle' &&
        !currentState.context.isStreaming
      ) {
        subscription.unsubscribe();
        if (currentState.context.syncError) {
          reject(currentState.context.syncError);
        } else {
          resolve();
        }
      }
    });
  }, [operationsActor]);

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

        // Record local change for sync echo filtering
        recordLocalChange(chatId);

        // Request tree sync after deletion
        sendOperations({ type: 'SYNC_TREE' });

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
      recordLocalChange,
      removeFromSelection,
      sendOperations,
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

        // Record local change for sync echo filtering
        recordLocalChange(chatId);

        // Request tree sync after deletion
        sendOperations({ type: 'SYNC_TREE' });
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
      recordLocalChange,
      sendOperations,
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
        toast({
          type: 'error',
          description:
            'Finish generating the current response before regenerating.',
        });
        return;
      }

      const currentOperation =
        operationsActor.getSnapshot().context.activeOperation;
      if (currentOperation !== 'idle') {
        toast({
          type: 'error',
          description: 'Please wait for the current operation to complete.',
        });
        return;
      }

      sendOperations({ type: 'REGENERATE', messageId: assistantMessageId });
    },
    [operationsActor, sendOperations, status]
  );

  const stop = useCallback(async () => {
    sendOperations({ type: 'CANCEL' });
    await stopStream();
  }, [sendOperations, stopStream]);

  const sendMessageWithGuard = useCallback<typeof sendMessage>(
    (payload) => {
      // Mark local update to filter out echo events from other tabs
      markLocalUpdate();

      const readiness = ensureOperationsReady();
      if (!readiness) {
        return sendMessage(payload);
      }

      return readiness
        .then(() => sendMessage(payload))
        .catch((error) => {
          console.warn('Skipping message send due to pending operation', error);
          toast({
            type: 'error',
            description:
              'Unable to send message while another operation is in progress.',
          });
        });
    },
    [ensureOperationsReady, markLocalUpdate, sendMessage]
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

      // Wait for any pending operations
      const readiness = ensureOperationsReady();
      if (readiness) {
        try {
          await readiness;
        } catch (error) {
          toast({
            type: 'error',
            description:
              'Unable to update message while another operation is in progress.',
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

      // Save previous state for rollback
      const previousMessages = [...currentMessages];
      const previousTree = currentMessageTreeRef.current;
      const previousSnapshot =
        selectionRef.current !== null
          ? cloneSelectionSnapshot(selectionRef.current)
          : null;
      const previousSelectionIds = [...getSelectedIds()];

      if (targetMessage.role === 'user') {
        // User message edit - create branch, then send new message to trigger AI
        const removedSelectionIds = previousMessages
          .slice(targetIndex)
          .map((message) => message.id);
        if (removedSelectionIds.length > 0) {
          removeFromSelection(removedSelectionIds);
        }

        const editedParts = buildEditedUserMessageParts(targetMessage, trimmed);

        try {
          // Step 1: Create branch in database
          const { newMessageId } = await branchMessageAction({
            chatId,
            messageId,
            editedText: trimmed,
          });

          // Step 2: Reset selection state and truncate messages
          selectionRef.current = null;
          currentMessageTreeRef.current = undefined;
          const truncatedMessages = previousMessages.slice(0, targetIndex);
          setMessages(truncatedMessages);

          // Step 3: Send message to trigger AI generation
          // The useChat hook will add this message to the messages array
          await sendMessage({
            id: newMessageId,
            role: 'user',
            parts: editedParts,
          });

          // Step 4: Notify machine that edit completed
          // The machine will sync the tree after streaming finishes
          sendOperations({
            type: 'EDIT_COMPLETE',
            newMessageId,
            role: 'user',
          });

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

      // Assistant message edit - create new version
      try {
        const { newMessageId } = await branchMessageAction({
          chatId,
          messageId,
          editedText: trimmed,
        });

        // Record local change for sync echo filtering
        recordLocalChange(chatId);

        // Reset selection state
        selectionRef.current = null;
        currentMessageTreeRef.current = undefined;

        // Notify machine to handle sync
        sendOperations({
          type: 'EDIT_COMPLETE',
          newMessageId,
          role: 'assistant',
        });

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
      ensureOperationsReady,
      fetchTree,
      getSelectedIds,
      isReadonly,
      recordLocalChange,
      removeFromSelection,
      sendMessage,
      sendOperations,
      setMessages,
    ]
  );

  // Edit a message without triggering regeneration (for user messages)
  // or without creating a new version (for both user and assistant messages)
  // Updates the message text in place.
  const handleEditMessageOnly = useCallback(
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

      // Wait for any pending operations
      const readiness = ensureOperationsReady();
      if (readiness) {
        try {
          await readiness;
        } catch (error) {
          toast({
            type: 'error',
            description:
              'Unable to update message while another operation is in progress.',
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

      // Save previous state for rollback
      const previousMessages = [...currentMessages];

      // Optimistically update the message in local state
      const updatedParts = targetMessage.parts.map((part) => {
        if (part.type === 'text') {
          return { ...part, text: trimmed };
        }
        return part;
      });
      // If no text part existed, add one
      const hasTextPart = targetMessage.parts.some(
        (part) => part.type === 'text'
      );
      const finalParts = hasTextPart
        ? updatedParts
        : [...updatedParts, { type: 'text' as const, text: trimmed }];

      setMessages((current) =>
        current.map((msg) =>
          msg.id === messageId ? { ...msg, parts: finalParts } : msg
        )
      );

      // Update message text in place (no new version created)
      try {
        await updateMessageTextAction({
          chatId,
          messageId,
          editedText: trimmed,
        });

        // Record local change for sync echo filtering
        recordLocalChange(chatId);

        // Invalidate the bootstrap query cache so the updated message is fetched on reload
        queryClient.invalidateQueries({
          queryKey: ['chat', 'bootstrap', chatId],
        });

        toast({ type: 'success', description: 'Message updated.' });
      } catch (error) {
        // Rollback on error
        setMessages(previousMessages);

        if (error instanceof ChatSDKError) {
          toast({ type: 'error', description: error.message });
        } else {
          toast({ type: 'error', description: 'Failed to update message.' });
        }

        throw error;
      }
    },
    [
      chatId,
      ensureOperationsReady,
      isReadonly,
      queryClient,
      recordLocalChange,
      setMessages,
    ]
  );

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      sendOperations({ type: 'NAVIGATE', messageId, direction });
    },
    [sendOperations]
  );

  // Sync tree when messages contain unknown IDs (e.g., after external changes)
  useEffect(() => {
    if (isStreamingStatus(status)) {
      return;
    }

    const tree = currentMessageTreeRef.current;
    if (!tree) {
      if (messages.length > 0) {
        sendOperations({ type: 'SYNC_TREE' });
      }
      return;
    }

    const knownIds = new Set(tree.nodes.map((node) => node.id));
    const hasMissing = messages.some((message) => !knownIds.has(message.id));

    if (hasMissing) {
      sendOperations({ type: 'SYNC_TREE' });
    }
  }, [messages, sendOperations, status]);

  // Deduplicate messages (defensive)
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

  // Compute disabled state from machine
  const disableRegenerate =
    isStreamingStatus(status) ||
    operationsState.context.isStreaming ||
    operationsState.context.activeOperation !== 'idle';

  return {
    messages: dedupedMessages,
    setMessages,
    sendMessage: sendMessageWithGuard,
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
    handleEditMessageOnly,
    handleRegenerateAssistant,
    handleNavigate,
    disableRegenerate,
    isBulkDeleting,
  } as const;
}
