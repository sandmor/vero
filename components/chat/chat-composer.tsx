'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chat } from '@/components/chat';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import { toast } from '@/components/toast';
import type {
  BranchSelectionSnapshot,
  ChatBootstrapResponse,
} from '@/types/chat-bootstrap';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { useReactQueryWithCache } from '@/hooks/use-react-query-with-cache';
import equal from 'fast-deep-equal';
import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';

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

  const { data: queryData, error } =
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

  const stableBootstrap = useStableBootstrap({
    chatId,
    queryData,
    cachedBootstrap,
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

  // Show error state if there's an error
  if (error && !stableBootstrap) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-sm text-red-500">
          Failed to load chat. Please try again.
        </span>
      </div>
    );
  }

  if (!stableBootstrap) {
    return <ChatLoadingSkeleton />;
  }

  const initialBranchState: BranchSelectionSnapshot =
    stableBootstrap.kind === 'existing'
      ? stableBootstrap.initialBranchState
      : (stableBootstrap.initialBranchState ?? { rootMessageIndex: null });

  const commonProps = useMemo(
    () =>
      ({
        id: stableBootstrap.chatId,
        initialChatModel: stableBootstrap.initialChatModel,
        initialVisibilityType: stableBootstrap.initialVisibilityType,
        isReadonly: stableBootstrap.isReadonly,
        autoResume: stableBootstrap.autoResume,
        allowedModels: stableBootstrap.allowedModels,
        initialSettings: stableBootstrap.initialSettings ?? null,
        initialAgent: stableBootstrap.initialAgent ?? null,
        initialMessages: stableBootstrap.initialMessages ?? [],
        initialBranchState,
      }) as const,
    [initialBranchState, stableBootstrap]
  );

  const chatElement =
    stableBootstrap.kind === 'existing' ? (
      <Chat
        key={stableBootstrap.chatId}
        {...commonProps}
        agentId={stableBootstrap.agentId ?? undefined}
        initialLastContext={stableBootstrap.initialLastContext ?? undefined}
      />
    ) : (
      <Chat key={stableBootstrap.chatId} {...commonProps} />
    );

  return (
    <>
      {stableBootstrap.shouldSetLastChatUrl ? <SetLastChatUrl /> : null}
      {chatElement}
    </>
  );
}

type StableBootstrapParams = {
  chatId?: string;
  queryData?: ChatBootstrapResponse;
  cachedBootstrap?: ChatBootstrapResponse;
};

function useStableBootstrap({
  chatId,
  queryData,
  cachedBootstrap,
}: StableBootstrapParams) {
  const cachedForChat = useMemo(() => {
    if (!cachedBootstrap) return undefined;
    if (chatId && cachedBootstrap.chatId !== chatId) {
      return undefined;
    }
    return cachedBootstrap;
  }, [cachedBootstrap, chatId]);

  const [bootstrap, setBootstrap] = useState<ChatBootstrapResponse | null>(
    () => queryData ?? cachedForChat ?? null
  );

  const previousChatIdRef = useRef<string | undefined>(chatId);

  useEffect(() => {
    if (!queryData) {
      return;
    }

    setBootstrap((current) => {
      if (!current) {
        return queryData;
      }

      if (current.chatId !== queryData.chatId) {
        return queryData;
      }

      if (!equal(current, queryData)) {
        return queryData;
      }

      return current;
    });
  }, [queryData]);

  useEffect(() => {
    if (bootstrap || !cachedForChat) {
      return;
    }

    setBootstrap(cachedForChat);
  }, [bootstrap, cachedForChat]);

  useEffect(() => {
    if (previousChatIdRef.current === chatId) {
      return;
    }

    previousChatIdRef.current = chatId;

    if (!chatId) {
      setBootstrap(queryData ?? cachedForChat ?? null);
      return;
    }

    setBootstrap((current) => {
      if (current && current.chatId === chatId) {
        return current;
      }
      if (queryData && queryData.chatId === chatId) {
        return queryData;
      }
      if (cachedForChat && cachedForChat.chatId === chatId) {
        return cachedForChat;
      }
      return null;
    });
  }, [cachedForChat, chatId, queryData]);

  return bootstrap;
}
