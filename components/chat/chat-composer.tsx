'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { Chat } from '@/components/chat';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';

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
  const { data } = useSuspenseQuery({
    queryKey: chatId
      ? ['chat', 'bootstrap', chatId]
      : ['chat', 'bootstrap', 'new'],
    queryFn: () => fetchChatBootstrap(chatId),
    staleTime: 0,
  });

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
