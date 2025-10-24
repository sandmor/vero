'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/toast';
import { fetchWithErrorHandlers } from '@/lib/utils';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';

export function useChatActions({
  id,
  messages,
  setMessages,
  isReadonly,
}: {
  id: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  isReadonly: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const selectedMessageIdsRef = useRef<string[]>(selectedMessageIds);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const chatDeletedRef = useRef(false);
  const [isForking, setIsForking] = useState(false);

  const handleChatDeleted = useCallback(() => {
    if (chatDeletedRef.current) {
      return;
    }

    chatDeletedRef.current = true;
    setSelectedMessageIds([]);
    router.replace('/chat');
    queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
  }, [queryClient, router]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      let previousMessages: ChatMessage[] = [];
      let previousSelection: string[] = [];
      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => message.id !== messageId);
      });
      setSelectedMessageIds((current) => {
        previousSelection = [...current];
        if (!current.length) return current;
        return current.filter((id) => id !== messageId);
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${id}/messages/${messageId}`,
          {
            method: 'DELETE',
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messages.length === 1) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        setSelectedMessageIds(previousSelection);
        throw error;
      }
    },
    [handleChatDeleted, id, messages.length, setMessages]
  );

  const handleDeleteMessageCascade = useCallback(
    async (messageId: string) => {
      if (isReadonly) {
        return { chatDeleted: false } as const;
      }

      const startIndex = messages.findIndex(
        (message) => message.id === messageId
      );

      if (startIndex === -1) {
        return { chatDeleted: false } as const;
      }

      const idsToDelete = messages
        .slice(startIndex)
        .map((message) => message.id);

      if (idsToDelete.length <= 1) {
        return handleDeleteMessage(messageId);
      }

      let previousMessages: ChatMessage[] = [];
      let previousSelection: string[] = [];

      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => !idsToDelete.includes(message.id));
      });

      setSelectedMessageIds((current) => {
        previousSelection = [...current];
        if (!current.length) return current;
        return current.filter((id) => !idsToDelete.includes(id));
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${id}/messages`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: idsToDelete }),
          }
        );
        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messages.length === idsToDelete.length) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        setSelectedMessageIds(previousSelection);
        throw error;
      }
    },
    [
      handleChatDeleted,
      handleDeleteMessage,
      id,
      isReadonly,
      messages,
      setMessages,
    ]
  );

  const handleToggleSelectMessage = useCallback(
    (messageId: string) => {
      if (isReadonly) return;
      setSelectedMessageIds((current) => {
        if (current.includes(messageId)) {
          return current.filter((id) => id !== messageId);
        }
        return [...current, messageId];
      });
    },
    [isReadonly]
  );

  const handleClearSelection = useCallback(() => {
    setSelectedMessageIds([]);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (isReadonly) return;
    const ids = selectedMessageIdsRef.current;
    if (!ids.length) return;

    setIsBulkDeleting(true);
    let previousMessages: ChatMessage[] = [];
    setMessages((current) => {
      previousMessages = [...current];
      return current.filter((message) => !ids.includes(message.id));
    });

    try {
      const response = await fetchWithErrorHandlers(
        `/api/chat/${id}/messages`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: ids }),
        }
      );

      const payload = await response.json().catch(() => null);
      const chatDeleted = Boolean(payload?.chatDeleted);

      setSelectedMessageIds([]);

      if (chatDeleted || messages.length === ids.length) {
        toast({ type: 'success', description: 'Chat deleted.' });
        handleChatDeleted();
      } else {
        toast({ type: 'success', description: 'Messages deleted.' });
      }
    } catch (error) {
      setMessages(previousMessages);
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      } else {
        toast({ type: 'error', description: 'Failed to delete messages.' });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  }, [handleChatDeleted, id, isReadonly, messages.length, setMessages]);

  const handleForkRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (isForking) return; // guard against double clicks
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
      } catch (e) {
        console.error('Regenerate fork failed', e);
        toast({
          type: 'error',
          description: (e as Error).message || 'Failed to fork chat',
        });
        setIsForking(false);
      }
    },
    [isForking, queryClient, router]
  );

  return {
    selectedMessageIds,
    isBulkDeleting,
    isForking,
    handleDeleteMessage,
    handleDeleteMessageCascade,
    handleToggleSelectMessage,
    handleClearSelection,
    handleDeleteSelected,
    handleForkRegenerate,
  };
}
