'use client';

import { useEffect, useRef } from 'react';
import { Chat } from '@/components/chat';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import { toast } from '@/components/toast';
import type {
  BranchSelectionSnapshot,
  ChatBootstrapResponse,
} from '@/types/chat-bootstrap';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { useReactQueryWithCache } from '@/hooks/use-react-query-with-cache';

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
    ready: isCacheReady,
  } = useEncryptedCache();
  const hasRequestedSyncRef = useRef(false);
  const cachedBootstrap = chatId ? getCachedBootstrap(chatId) : undefined;

  const { data, isFetching, error } =
    useReactQueryWithCache<ChatBootstrapResponse>({
      queryKey: chatId
        ? ['chat', 'bootstrap', chatId]
        : ['chat', 'bootstrap', 'new'],
      queryFn: () => fetchChatBootstrap(chatId),
      chatId,
      enabled: true,
      staleTime: 0, // Always check for fresh data
      verifyCache: true,
      onError: (err) => {
        console.error('Failed to load chat bootstrap data:', err);
        toast({
          type: 'error',
          description: 'Failed to load chat. Please try again.',
        });
      },
    });

  useEffect(() => {
    hasRequestedSyncRef.current = false;
  }, [chatId]);

  // Show loading toast when fetching data
  useEffect(() => {
    if (isFetching && !data) {
      toast({
        type: 'info',
        description: 'Loading chat...',
      });
    }
  }, [isFetching, data]);

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

  // Show error state if there's an error
  if (error && !data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-sm text-red-500">
          Failed to load chat. Please try again.
        </span>
      </div>
    );
  }

  // Return null if no data (shouldn't happen with proper fallbacks)
  if (!data) {
    return null;
  }

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
