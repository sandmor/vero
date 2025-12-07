'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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
import { useAppSession } from '@/hooks/use-app-session';
import { buildLoginRedirectUrl } from '@/lib/auth/redirects';

async function fetchNewChatBootstrap(): Promise<ChatBootstrapResponse> {
  const response = await fetch('/api/chat/bootstrap', {
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

/**
 * Determines if a bootstrap response matches the requested chatId.
 * For new chats (chatId undefined), any "new" kind bootstrap is valid.
 * For existing chats, the bootstrap chatId must match exactly.
 */
function isBootstrapForChat(
  bootstrap: ChatBootstrapResponse | undefined | null,
  chatId: string | undefined
): bootstrap is ChatBootstrapResponse {
  if (!bootstrap) return false;
  if (!chatId) {
    // New chat: bootstrap should be for a new chat (kind === 'new')
    // or match the chatId if it's already been created
    return bootstrap.kind === 'new';
  }
  return bootstrap.chatId === chatId;
}

export function ChatComposer({ chatId }: { chatId?: string }) {
  const router = useRouter();
  const {
    getCachedBootstrap,
    refreshCache,
    ready: isCacheReady,
  } = useEncryptedCache();
  const [existingLoadState, setExistingLoadState] = useState<
    'idle' | 'syncing' | 'missing'
  >('idle');
  const isNewChat = !chatId;
  const hasRequestedSyncRef = useRef(false);
  const cachedBootstrap = chatId ? getCachedBootstrap(chatId) : undefined;
  const { data: sessionData, status: sessionStatus } = useAppSession();

  const { data: queryData, error } =
    useReactQueryWithCache<ChatBootstrapResponse>({
      queryKey: isNewChat
        ? ['chat', 'bootstrap', 'new']
        : ['chat', 'bootstrap', chatId ?? ''],
      queryFn: fetchNewChatBootstrap,
      chatId: isNewChat ? undefined : chatId,
      enabled: isNewChat,
      staleTime: 0,
      verifyCache: false,
      onError: (err) => {
        console.error('Failed to load chat bootstrap data:', err);
        toast({
          type: 'error',
          description: 'Failed to load chat. Please try again.',
        });
      },
    });

  useEffect(() => {
    if (isNewChat) return;
    if (!error) return;
    const status = (error as Error & { status?: number })?.status;
    if (!status || (status !== 404 && status !== 401)) return;
    if (sessionStatus !== 'success') return;
    const userType = sessionData?.session?.user?.type;
    if (userType === 'regular') return;

    const loginUrl = buildLoginRedirectUrl('/chat');
    router.replace(loginUrl);
  }, [error, isNewChat, router, sessionData, sessionStatus]);

  useEffect(() => {
    hasRequestedSyncRef.current = false;
    setExistingLoadState('idle');
  }, [chatId]);

  useEffect(() => {
    if (!cachedBootstrap) return;
    setExistingLoadState('idle');
  }, [cachedBootstrap]);

  useEffect(() => {
    if (!chatId) return;
    if (!isCacheReady) return;
    if (cachedBootstrap) return;
    if (hasRequestedSyncRef.current) return;

    hasRequestedSyncRef.current = true;
    setExistingLoadState('syncing');
    let cancelled = false;

    refreshCache({ force: true })
      .then(() => {
        if (cancelled) return;
        const refreshedBootstrap = getCachedBootstrap(chatId);
        setExistingLoadState(refreshedBootstrap ? 'idle' : 'missing');
      })
      .catch(() => {
        if (!cancelled) {
          setExistingLoadState('missing');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [cachedBootstrap, chatId, getCachedBootstrap, isCacheReady, refreshCache]);

  const bootstrap = useStableBootstrap({
    chatId,
    queryData: isNewChat ? queryData : undefined,
    cachedBootstrap,
  });

  // Only use bootstrap if it matches the current chatId
  const validBootstrap = isBootstrapForChat(bootstrap, chatId)
    ? bootstrap
    : null;

  const isMissingExistingChat =
    !isNewChat && existingLoadState === 'missing' && !validBootstrap;

  // Show error state if there's an error and no valid bootstrap
  if ((error && !validBootstrap) || isMissingExistingChat) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-sm text-red-500">
          {isMissingExistingChat
            ? 'Chat not found or no longer accessible.'
            : 'Failed to load chat. Please try again.'}
        </span>
      </div>
    );
  }

  if (!validBootstrap) {
    return <ChatLoadingSkeleton variant={chatId ? 'existing' : 'new'} />;
  }

  const initialBranchState: BranchSelectionSnapshot =
    validBootstrap.kind === 'existing'
      ? validBootstrap.initialBranchState
      : (validBootstrap.initialBranchState ?? { rootMessageIndex: null });

  const commonProps = {
    id: validBootstrap.chatId,
    initialChatModel: validBootstrap.initialChatModel,
    initialVisibilityType: validBootstrap.initialVisibilityType,
    isReadonly: validBootstrap.isReadonly,
    autoResume: validBootstrap.autoResume,
    allowedModels: validBootstrap.allowedModels,
    initialSettings: validBootstrap.initialSettings ?? null,
    initialAgent: validBootstrap.initialAgent ?? null,
    initialMessages: validBootstrap.initialMessages ?? [],
    initialBranchState,
  } as const;

  return (
    <>
      {validBootstrap.shouldSetLastChatUrl ? <SetLastChatUrl /> : null}
      {validBootstrap.kind === 'existing' ? (
        <Chat
          key={validBootstrap.chatId}
          {...commonProps}
          agentId={validBootstrap.agentId ?? undefined}
          initialLastContext={validBootstrap.initialLastContext ?? undefined}
        />
      ) : (
        <Chat key={validBootstrap.chatId} {...commonProps} />
      )}
    </>
  );
}

type StableBootstrapParams = {
  chatId?: string;
  queryData?: ChatBootstrapResponse;
  cachedBootstrap?: ChatBootstrapResponse;
};

/**
 * Hook that manages bootstrap state transitions during navigation.
 *
 * Key behaviors:
 * - Immediately clears stale bootstrap when chatId changes
 * - Uses cached data as initial value when available
 * - Updates state when fresh query data arrives
 * - Prevents stale data from persisting across navigations
 */
function useStableBootstrap({
  chatId,
  queryData,
  cachedBootstrap,
}: StableBootstrapParams): ChatBootstrapResponse | null {
  // Memoize cached bootstrap that matches the current chatId
  const validCachedBootstrap = useMemo(() => {
    if (!cachedBootstrap) return undefined;
    // For existing chats, ensure the cached bootstrap matches
    if (chatId && cachedBootstrap.chatId !== chatId) {
      return undefined;
    }
    return cachedBootstrap;
  }, [cachedBootstrap, chatId]);

  const [bootstrap, setBootstrap] = useState<ChatBootstrapResponse | null>(
    () => {
      // Initialize with query data or valid cached bootstrap
      return queryData ?? validCachedBootstrap ?? null;
    }
  );

  const previousChatIdRef = useRef<string | undefined>(chatId);

  // Handle chatId changes - this is the key to fixing the race condition
  useEffect(() => {
    const previousChatId = previousChatIdRef.current;

    if (previousChatId === chatId) {
      return;
    }

    previousChatIdRef.current = chatId;

    // chatId changed - clear bootstrap immediately if it doesn't match
    setBootstrap((current) => {
      // If we have fresh query data for the new chatId, use it
      if (queryData) {
        if (!chatId && queryData.kind === 'new') {
          return queryData;
        }
        if (chatId && queryData.chatId === chatId) {
          return queryData;
        }
      }

      // If we have valid cached bootstrap for the new chatId, use it
      if (validCachedBootstrap) {
        if (!chatId && validCachedBootstrap.kind === 'new') {
          return validCachedBootstrap;
        }
        if (chatId && validCachedBootstrap.chatId === chatId) {
          return validCachedBootstrap;
        }
      }

      // Otherwise clear the bootstrap to show loading state
      // This prevents showing stale data from the previous chat
      return null;
    });
  }, [chatId, queryData, validCachedBootstrap]);

  // Update bootstrap when query data changes
  useEffect(() => {
    if (!queryData) {
      return;
    }

    setBootstrap((current) => {
      // No current bootstrap - use the new data
      if (!current) {
        return queryData;
      }

      // Chat ID mismatch - use new data
      if (current.chatId !== queryData.chatId) {
        return queryData;
      }

      // Same chat, check if data changed
      if (!equal(current, queryData)) {
        return queryData;
      }

      // No change needed
      return current;
    });
  }, [queryData]);

  // Fill in cached bootstrap if we don't have any data yet
  useEffect(() => {
    if (bootstrap || !validCachedBootstrap) {
      return;
    }

    setBootstrap(validCachedBootstrap);
  }, [bootstrap, validCachedBootstrap]);

  return bootstrap;
}
