'use client';

import { useEffect, useRef } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { Chat } from '@/components/chat';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
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
    if (cachedBootstrap) return;
    if (data.kind !== 'existing') return;
    if (!data.prefetchedChat) return;

    const lastUpdatedAt = computeChatLastUpdatedAt({
      chat: { createdAt: new Date(data.prefetchedChat.createdAt) },
      messageTree: data.initialMessageTree,
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

  const commonProps = {
    id: data.chatId,
    initialChatModel: data.initialChatModel,
    initialVisibilityType: data.initialVisibilityType,
    isReadonly: data.isReadonly,
    autoResume: data.autoResume,
    allowedModels: data.allowedModels,
    initialSettings: data.initialSettings ?? null,
    initialAgent: data.initialAgent ?? null,
  } as const;

  const chatElement =
    data.kind === 'existing' ? (
      <Chat
        key={data.chatId}
        {...commonProps}
        agentId={data.agentId ?? undefined}
        initialMessageTree={data.initialMessageTree}
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
