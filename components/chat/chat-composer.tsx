'use client';

import { useEffect, useRef } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Chat } from '@/components/chat';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import type {
  BranchSelectionSnapshot,
  ChatBootstrapResponse,
} from '@/types/chat-bootstrap';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { computeChatLastUpdatedAt } from '@/lib/chat/bootstrap-helpers';

async function fetchChatBootstrap(
  chatId?: string
): Promise<ChatBootstrapResponse> {
  const params = chatId ? `?chatId=${encodeURIComponent(chatId)}` : '';
  const response = await fetch(`/api/chat/bootstrap${params}`, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const error: Error & { status?: number } = new Error(
      'Failed to load chat bootstrap data'
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export function ChatComposer({ chatId }: { chatId?: string }) {
  const {
    getCachedBootstrap,
    refreshCache,
    upsertChatRecord,
    ready: isCacheReady,
  } = useEncryptedCache();
  const hasRequestedSyncRef = useRef(false);
  const cachedBootstrap = chatId ? getCachedBootstrap(chatId) : undefined;
  const { data } = useSuspenseQuery({
    queryKey: chatId
      ? ['chat', 'bootstrap', chatId]
      : ['chat', 'bootstrap', 'new'],
    queryFn: () => fetchChatBootstrap(chatId),
    staleTime: 0,
    initialData: cachedBootstrap,
  });

  useEffect(() => {
    hasRequestedSyncRef.current = false;
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    if (!isCacheReady) return;
    if (cachedBootstrap) return;
    if (hasRequestedSyncRef.current) return;

    hasRequestedSyncRef.current = true;
    refreshCache().catch(() => {
      // cache provider surfaces sync errors; component stays optimistic
    });
  }, [chatId, cachedBootstrap, isCacheReady, refreshCache]);

  useEffect(() => {
    if (!chatId) return;
    if (!isCacheReady) return;
    if (data.kind !== 'existing') return;
    if (!data.prefetchedChat) return;

    const cachedMessageIds =
      cachedBootstrap?.kind === 'existing'
        ? (cachedBootstrap.initialMessages ?? []).map((message) => message.id)
        : [];
    const incomingMessageIds = data.initialMessages.map(
      (message) => message.id
    );

    const hasMessageMismatch =
      cachedMessageIds.length !== incomingMessageIds.length ||
      cachedMessageIds.some(
        (messageId, index) => messageId !== incomingMessageIds[index]
      );

    const cachedRootIndex =
      cachedBootstrap?.kind === 'existing'
        ? (cachedBootstrap.initialBranchState.rootMessageIndex ?? null)
        : null;
    const incomingRootIndex = data.initialBranchState.rootMessageIndex ?? null;

    const shouldPersistUpdate =
      !cachedBootstrap ||
      hasMessageMismatch ||
      cachedRootIndex !== incomingRootIndex;

    if (!shouldPersistUpdate) {
      return;
    }

    const lastUpdatedAt = computeChatLastUpdatedAt({
      chat: { createdAt: new Date(data.prefetchedChat.createdAt) },
      messages: data.initialMessages ?? [],
      branchState: data.initialBranchState,
    });

    upsertChatRecord({
      chatId: data.chatId,
      lastUpdatedAt,
      bootstrap: data,
      chat: data.prefetchedChat,
    }).catch(() => {
      // cache provider surfaces errors; safe to ignore here
    });
  }, [chatId, cachedBootstrap, data, isCacheReady, upsertChatRecord]);

  const initialBranchState: BranchSelectionSnapshot =
    data.kind === 'existing'
      ? data.initialBranchState
      : (data.initialBranchState ?? { rootMessageIndex: null });

  const commonProps = {
    id: data.chatId,
    initialChatModel: data.initialChatModel,
    initialVisibilityType: data.initialVisibilityType,
    isReadonly: data.isReadonly,
    autoResume: data.autoResume,
    allowedModels: data.allowedModels,
    initialSettings: data.initialSettings ?? null,
    initialAgent: data.initialAgent ?? null,
    initialMessages: data.initialMessages ?? [],
    initialBranchState,
  } as const;

  const chatElement =
    data.kind === 'existing' ? (
      <Chat
        key={data.chatId}
        {...commonProps}
        agentId={data.agentId ?? undefined}
        initialLastContext={data.initialLastContext ?? undefined}
      />
    ) : (
      <Chat key={data.chatId} {...commonProps} />
    );

  return (
    <>
      {data.shouldSetLastChatUrl ? <SetLastChatUrl /> : null}
      {chatElement}
    </>
  );
}
