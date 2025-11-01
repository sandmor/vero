import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { DataUIPart } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import equal from 'fast-deep-equal';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/toast';
import type { ChatPreferences } from './use-chat-preferences';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage, CustomUIDataTypes } from '@/lib/types';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { AppUsage } from '@/lib/usage';
import {
  buildBranchFromNode,
  convertToUIMessages,
  fetchWithErrorHandlers,
  generateUUID,
  getTextFromMessage,
} from '@/lib/utils';
import type { VisibilityType } from '../visibility-selector';
import {
  branchMessageAction,
  forkChatAction,
  updateHeadMessage,
} from '@/app/(chat)/actions';
import type React from 'react';
import type { MessageDeletionMode } from '@/lib/message-deletion';

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

type BranchSwitchState = {
  id: symbol;
  targetHeadId: string;
  status: 'pending' | 'success' | 'error';
  promise: Promise<void>;
  error: unknown;
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
  const regenerationStartedRef = useRef(false);
  const branchSwitchRef = useRef<BranchSwitchState | null>(null);
  const currentHeadIdRef = useRef<string | null>(
    initialMessageTree?.branch.at(-1)?.id ?? null
  );
  const requestedHeadIdRef = useRef<string | null>(currentHeadIdRef.current);
  const treeSyncRef = useRef<Promise<void> | null>(null);

  const [pendingRegenerationId, setPendingRegenerationId] = useState<
    string | null
  >(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const headMessageMutation = useMutation<
    void,
    ChatSDKError | Error,
    { messageId: string; expectedHeadId: string | null }
  >({
    mutationFn: async ({ messageId, expectedHeadId }) => {
      await updateHeadMessage({ chatId, messageId, expectedHeadId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
    },
  });

  const { mutateAsync: persistHeadMessageAsync } = headMessageMutation;

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
    stop,
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
      fetch: fetchWithErrorHandlers,
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
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      if (!chatHasStartedRef.current) {
        markChatAsStarted();
      }
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      }
    },
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const updateTreeSnapshot = useCallback(
    (tree: MessageTreeResult) => {
      currentMessageTreeRef.current = tree;
      const headId = tree.branch.at(-1)?.id ?? null;
      currentHeadIdRef.current = headId;
      requestedHeadIdRef.current = headId;

      setMessages((current) => {
        const next = convertToUIMessages(tree.branch);
        if (equal(current, next)) {
          return current;
        }
        return next;
      });
    },
    [setMessages]
  );

  const refreshMessageTree = useCallback(async () => {
    if (treeSyncRef.current) {
      return treeSyncRef.current;
    }

    const promise = (async () => {
      try {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        const tree = await getMessageTreeAction({ chatId });
        updateTreeSnapshot(tree);
      } catch (error) {
        console.error('Failed to refresh message tree', error);
      } finally {
        treeSyncRef.current = null;
      }
    })();

    treeSyncRef.current = promise;
    return promise;
  }, [chatId, updateTreeSnapshot]);

  const handleChatDeleted = useCallback(() => {
    if (chatDeletedRef.current) {
      return;
    }

    chatDeletedRef.current = true;
    clearSelection();
    setMessages([]);
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

        await refreshMessageTree();

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
      refreshMessageTree,
      removeFromSelection,
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

        await refreshMessageTree();
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
      refreshMessageTree,
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
    (assistantMessageId: string) => {
      if (status === 'submitted' || status === 'streaming') {
        return;
      }
      if (pendingRegenerationId) {
        return;
      }
      setPendingRegenerationId(assistantMessageId);
      toast({ type: 'success', description: 'Regenerating message…' });
      try {
        regenerate({ messageId: assistantMessageId });
      } catch (error) {
        console.error('Regenerate request failed', error);
        toast({
          type: 'error',
          description: 'Failed to start regeneration.',
        });
        setPendingRegenerationId(null);
      }
    },
    [pendingRegenerationId, regenerate, status]
  );

  useEffect(() => {
    if (!pendingRegenerationId) {
      regenerationStartedRef.current = false;
      return;
    }

    if (status === 'submitted' || status === 'streaming') {
      regenerationStartedRef.current = true;
    }
  }, [pendingRegenerationId, status]);

  useEffect(() => {
    if (!pendingRegenerationId) {
      return;
    }
    if (status === 'submitted' || status === 'streaming') {
      return;
    }
    if (!regenerationStartedRef.current) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        const tree = await getMessageTreeAction({ chatId });
        if (cancelled) return;
        currentMessageTreeRef.current = tree;
        setMessages(convertToUIMessages(tree.branch));
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      } catch (error) {
        if (!cancelled) {
          console.error(
            'Failed to refresh message tree after regeneration',
            error
          );
        }
      } finally {
        if (!cancelled) {
          setPendingRegenerationId(null);
          regenerationStartedRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, pendingRegenerationId, queryClient, setMessages, status]);

  const disableRegenerate =
    status === 'submitted' ||
    status === 'streaming' ||
    pendingRegenerationId !== null;

  const ensureBranchReady = useCallback((): Promise<void> | null => {
    const attempt = branchSwitchRef.current;
    if (!attempt) {
      return null;
    }

    if (attempt.status === 'pending') {
      return attempt.promise.then(() => {
        const followUp = ensureBranchReady();
        if (followUp) {
          return followUp;
        }
      });
    }

    if (attempt.status === 'error') {
      const error =
        attempt.error instanceof Error
          ? attempt.error
          : new Error('Failed to switch message version.');
      branchSwitchRef.current = null;
      return Promise.reject(error);
    }

    if (branchSwitchRef.current === attempt) {
      branchSwitchRef.current = null;
    }

    return ensureBranchReady();
  }, []);

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
      const previousHeadId = currentHeadIdRef.current;
      const previousRequestedHeadId = requestedHeadIdRef.current;

      const optimisticId = generateUUID();
      const optimisticMessage: ChatMessage = {
        id: optimisticId,
        role: targetMessage.role,
        parts: [{ type: 'text', text: trimmed }],
        metadata: {
          createdAt: new Date().toISOString(),
          model: targetMessage.metadata?.model,
          siblingIndex: 0,
          siblingsCount: 1,
        },
      };

      const truncatedMessages = [
        ...previousMessages.slice(0, targetIndex),
        optimisticMessage,
      ];

      setMessages(truncatedMessages);
      currentHeadIdRef.current = optimisticId;
      requestedHeadIdRef.current = optimisticId;
      currentMessageTreeRef.current = undefined;

      try {
        const { newMessageId } = await branchMessageAction({
          chatId,
          messageId,
          editedText: trimmed,
        });

        currentHeadIdRef.current = newMessageId;
        requestedHeadIdRef.current = newMessageId;

        toast({ type: 'success', description: 'Message updated.' });

        await refreshMessageTree();
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      } catch (error) {
        setMessages(previousMessages);
        currentMessageTreeRef.current = previousTree;
        currentHeadIdRef.current = previousHeadId;
        requestedHeadIdRef.current = previousRequestedHeadId;

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
      ensureBranchReady,
      isReadonly,
      queryClient,
      refreshMessageTree,
      setMessages,
    ]
  );

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      const tree = currentMessageTreeRef.current;
      if (!tree) return;

      const findParent = (
        nodes: MessageTreeNode[],
        id: string
      ): MessageTreeNode | null => {
        for (const node of nodes) {
          if (node.children.some((child) => child.id === id)) {
            return node;
          }
        }
        return null;
      };

      const parent = findParent(tree.branch, messageId);
      if (!parent || !parent.children?.length) return;

      const currentIndex = parent.children.findIndex(
        (child) => child.id === messageId
      );
      if (currentIndex === -1) return;

      const newIndex =
        direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex < 0 || newIndex >= parent.children.length) return;

      const newSiblingNode = parent.children[newIndex];
      const newBranchMessages = buildBranchFromNode(newSiblingNode);
      if (!newBranchMessages.length) return;

      const switchIndex = messagesRef.current.findIndex(
        (msg) => msg.id === messageId
      );
      if (switchIndex === -1) return;

      const previousHeadId = currentHeadIdRef.current ?? null;

      const previousMessages = [...messagesRef.current];
      const previousBranch = [...tree.branch];

      const nextMessages = [
        ...previousMessages.slice(0, switchIndex),
        ...newBranchMessages,
      ];
      setMessages(nextMessages);

      const newHeadMessage = newBranchMessages.at(-1);
      if (!newHeadMessage) {
        return;
      }

      currentHeadIdRef.current = newHeadMessage.id;
      requestedHeadIdRef.current = newHeadMessage.id;

      const nodesByPath = new Map<string, MessageTreeNode>();
      for (const node of tree.nodes) {
        if (node.pathText) {
          nodesByPath.set(node.pathText, node);
        }
      }

      let leafNode: MessageTreeNode | undefined = newSiblingNode;
      while (leafNode.children.length) {
        leafNode = leafNode.children[leafNode.children.length - 1];
      }

      if (leafNode) {
        const updatedBranchNodes: MessageTreeNode[] = [];
        let cursor: MessageTreeNode | undefined = leafNode;
        while (cursor) {
          updatedBranchNodes.push(cursor);
          if (!cursor.parentPath) break;
          cursor = cursor.parentPath
            ? (nodesByPath.get(cursor.parentPath) ?? undefined)
            : undefined;
        }
        updatedBranchNodes.reverse();
        currentMessageTreeRef.current = {
          ...tree,
          branch: updatedBranchNodes,
        };
      }

      const attemptId = Symbol('branch-switch');
      let rolledBack = false;
      const rollback = () => {
        if (rolledBack) return;
        rolledBack = true;
        setMessages(() => [...previousMessages]);
        currentMessageTreeRef.current = {
          ...tree,
          branch: previousBranch,
        };
        currentHeadIdRef.current = previousHeadId;
        requestedHeadIdRef.current = previousHeadId;
      };

      const persistPromise = persistHeadMessageAsync({
        messageId: newHeadMessage.id,
        expectedHeadId: previousHeadId,
      })
        .then(() => {
          if (requestedHeadIdRef.current !== newHeadMessage.id) {
            return;
          }

          if (branchSwitchRef.current?.id === attemptId) {
            branchSwitchRef.current = {
              id: attemptId,
              targetHeadId: newHeadMessage.id,
              status: 'success',
              promise: Promise.resolve(),
              error: null,
            };
          }
          refreshMessageTree();
        })
        .catch((error) => {
          if (branchSwitchRef.current?.id === attemptId) {
            rollback();
            console.warn('Failed to persist head message', error);
            branchSwitchRef.current = {
              id: attemptId,
              targetHeadId: newHeadMessage.id,
              status: 'error',
              promise: Promise.resolve(),
              error,
            };
          }
          refreshMessageTree();
          return Promise.reject(error);
        })
        .finally(() => {
          if (
            branchSwitchRef.current?.id === attemptId &&
            branchSwitchRef.current.status !== 'error'
          ) {
            branchSwitchRef.current = null;
          }
        });

      branchSwitchRef.current = {
        id: attemptId,
        targetHeadId: newHeadMessage.id,
        status: 'pending',
        promise: persistPromise.catch(() => undefined),
        error: null,
      };
    },
    [persistHeadMessageAsync, refreshMessageTree, setMessages]
  );

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    if (treeSyncRef.current) {
      return;
    }

    const tree = currentMessageTreeRef.current;
    if (!tree) {
      if (messages.length > 0) {
        refreshMessageTree();
      }
      return;
    }

    const knownIds = new Set(tree.nodes.map((node) => node.id));
    const hasMissing = messages.some((message) => !knownIds.has(message.id));

    if (hasMissing) {
      refreshMessageTree();
    }
  }, [messages, refreshMessageTree, status]);

  return {
    messages,
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
