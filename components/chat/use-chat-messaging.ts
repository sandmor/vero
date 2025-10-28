import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { DataUIPart } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/toast';
import type { ChatPreferences } from './use-chat-preferences';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage, CustomUIDataTypes } from '@/lib/types';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { AppUsage } from '@/lib/usage';
import {
  buildBranchFromNode,
  fetchWithErrorHandlers,
  generateUUID,
} from '@/lib/utils';
import type { VisibilityType } from '../visibility-selector';
import type React from 'react';

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

  const [isForking, setIsForking] = useState(false);
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
        return {
          body: {
            ...request.body,
            id: request.id,
            message: request.messages.at(-1),
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
    async (messageId: string) => {
      let previousMessages: ChatMessage[] = [];
      const previousSelection = [...getSelectedIds()];
      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => message.id !== messageId);
      });
      removeFromSelection([messageId]);

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages/${messageId}`,
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

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        assignSelection(previousSelection);
        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      getSelectedIds,
      handleChatDeleted,
      removeFromSelection,
      setMessages,
    ]
  );

  const handleDeleteMessageCascade = useCallback(
    async (messageId: string) => {
      if (isReadonly) {
        return { chatDeleted: false } as const;
      }

      const currentMessages = messagesRef.current;
      const startIndex = currentMessages.findIndex(
        (message) => message.id === messageId
      );

      if (startIndex === -1) {
        return { chatDeleted: false } as const;
      }

      const idsToDelete = currentMessages
        .slice(startIndex)
        .map((message) => message.id);

      if (idsToDelete.length <= 1) {
        return handleDeleteMessage(messageId);
      }

      let previousMessages: ChatMessage[] = [];
      const previousSelection = [...getSelectedIds()];

      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => !idsToDelete.includes(message.id));
      });
      removeFromSelection(idsToDelete);

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: idsToDelete }),
          }
        );
        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        assignSelection(previousSelection);
        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      getSelectedIds,
      handleChatDeleted,
      handleDeleteMessage,
      isReadonly,
      removeFromSelection,
      setMessages,
    ]
  );

  const handleDeleteSelected = useCallback(async () => {
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
          body: JSON.stringify({ messageIds: ids }),
        }
      );

      const payload = await response.json().catch(() => null);
      const chatDeleted = Boolean(payload?.chatDeleted);

      clearSelection();

      if (chatDeleted || messagesRef.current.length === 0) {
        toast({ type: 'success', description: 'Chat deleted.' });
        handleChatDeleted();
      } else {
        toast({ type: 'success', description: 'Messages deleted.' });
      }
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
  }, [
    assignSelection,
    chatId,
    clearSelection,
    getSelectedIds,
    handleChatDeleted,
    isReadonly,
    setMessages,
  ]);

  const handleForkRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (isForking) return;
      setIsForking(true);
      toast({ type: 'success', description: 'Forking chat…' });
      try {
        const match = window.location.pathname.match(/\/chat\/(.+)$/);
        if (!match) throw new Error('Cannot infer current chat id');
        const currentChatId = match[1];
        const { forkChatAction } = await import('@/app/(chat)/actions');
        const result: any = await forkChatAction({
          sourceChatId: currentChatId,
          pivotMessageId: assistantMessageId,
          mode: 'regenerate',
        });
        if (!result?.newChatId) {
          throw new Error('Fork action did not return newChatId');
        }
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        }, 8000);
        requestAnimationFrame(() => {
          router.push(`/chat/${result.newChatId}?regenerate=true`);
        });
      } catch (error) {
        console.error('Regenerate fork failed', error);
        toast({
          type: 'error',
          description: (error as Error).message || 'Failed to fork chat',
        });
        setIsForking(false);
      }
    },
    [isForking, queryClient, router]
  );

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      if (!currentMessageTreeRef.current) return;

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

      const parent = findParent(
        currentMessageTreeRef.current.branch,
        messageId
      );
      if (!parent || !parent.children) return;

      const currentIndex = parent.children.findIndex(
        (child) => child.id === messageId
      );
      if (currentIndex === -1) return;

      const newIndex =
        direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex < 0 || newIndex >= parent.children.length) return;

      const newSiblingNode = parent.children[newIndex];
      const newBranch = buildBranchFromNode(newSiblingNode);

      setMessages((currentMessages) => {
        const switchIndex = currentMessages.findIndex(
          (msg) => msg.id === messageId
        );
        if (switchIndex === -1) return currentMessages;

        const baseMessages = currentMessages.slice(0, switchIndex);
        return [...baseMessages, ...newBranch];
      });
    },
    [setMessages]
  );

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    chatError,
    clearChatError,
    handleDeleteMessage,
    handleDeleteMessageCascade,
    handleDeleteSelected,
    handleForkRegenerate,
    handleNavigate,
    isForking,
    isBulkDeleting,
  } as const;
}
