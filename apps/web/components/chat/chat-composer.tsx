'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Chat } from '@/components/chat';
import type {
  BranchSelectionSnapshot,
  ChatBootstrapResponse,
} from '@/types/chat-bootstrap';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';
import { useAppSession } from '@/hooks/use-app-session';
import { buildLoginRedirectUrl } from '@/lib/auth/redirects';

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
    generateNewChatBootstrap,
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

  // For new chats, generate bootstrap from cache metadata
  const newChatBootstrap = useMemo(() => {
    if (!isNewChat || !isCacheReady) return null;
    return generateNewChatBootstrap();
  }, [isNewChat, isCacheReady, generateNewChatBootstrap]);

  // Track if user is not logged in (for redirecting guests)
  const [needsAuth, setNeedsAuth] = useState(false);

  useEffect(() => {
    if (isNewChat) return;
    if (existingLoadState !== 'missing') return;
    if (sessionStatus !== 'success') return;
    const userType = sessionData?.session?.user?.type;
    if (userType === 'regular') return;

    setNeedsAuth(true);
    const loginUrl = buildLoginRedirectUrl('/chat');
    router.replace(loginUrl);
  }, [existingLoadState, isNewChat, router, sessionData, sessionStatus]);

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
    newChatBootstrap: isNewChat ? newChatBootstrap : undefined,
    cachedBootstrap,
  });

  // Only use bootstrap if it matches the current chatId
  const validBootstrap = isBootstrapForChat(bootstrap, chatId)
    ? bootstrap
    : null;

  useEffect(() => {
    if (isNewChat) {
      document.title = 'New Chat';
      return;
    }

    let title: string | undefined;

    if (cachedBootstrap?.kind === 'existing') {
      title = cachedBootstrap.prefetchedChat?.title;
    } else if (validBootstrap?.kind === 'existing') {
      title = validBootstrap.prefetchedChat?.title;
    }

    if (title) {
      document.title = title;
    }
  }, [isNewChat, cachedBootstrap, validBootstrap]);

  const isMissingExistingChat =
    !isNewChat && existingLoadState === 'missing' && !validBootstrap;

  // Show error state for missing existing chat (not found or auth required)
  if (isMissingExistingChat && !needsAuth) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <span className="text-sm text-red-500">
          Chat not found or no longer accessible.
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
  newChatBootstrap?: ChatBootstrapResponse | null;
  cachedBootstrap?: ChatBootstrapResponse;
};

/**
 * Hook that manages bootstrap state transitions during navigation.
 *
 * Key behaviors:
 * - Immediately clears stale bootstrap when chatId changes
 * - Uses cached data as initial value when available
 * - For new chats, uses generated bootstrap from cache metadata
 * - Prevents stale data from persisting across navigations
 */
function useStableBootstrap({
  chatId,
  newChatBootstrap,
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
      // Initialize with new chat bootstrap or valid cached bootstrap
      return newChatBootstrap ?? validCachedBootstrap ?? null;
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
      // For new chats, use generated bootstrap from cache
      if (!chatId && newChatBootstrap) {
        return newChatBootstrap;
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
  }, [chatId, newChatBootstrap, validCachedBootstrap]);

  // Update bootstrap when newChatBootstrap becomes available (for new chats)
  useEffect(() => {
    if (!newChatBootstrap) {
      return;
    }

    setBootstrap((current) => {
      // No current bootstrap - use the new data
      if (!current) {
        return newChatBootstrap;
      }

      // If current is a new chat and we have fresh new chat bootstrap,
      // only update if it's different (to avoid infinite loops)
      if (current.kind === 'new' && newChatBootstrap.kind === 'new') {
        // Keep the same bootstrap if chatId matches (already have one)
        // This prevents regenerating a new UUID on every render
        return current;
      }

      return newChatBootstrap;
    });
  }, [newChatBootstrap]);

  // Fill in cached bootstrap if we don't have any data yet
  useEffect(() => {
    if (bootstrap || !validCachedBootstrap) {
      return;
    }

    setBootstrap(validCachedBootstrap);
  }, [bootstrap, validCachedBootstrap]);

  return bootstrap;
}
