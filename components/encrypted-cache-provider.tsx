'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { fetchAndImportEncryptionKey } from '@/lib/cache/encryption';
import {
  getEncryptedCacheManager,
  type CachedChatPayload,
} from '@/lib/cache/cache-manager';
import type { CacheMetadataPayload, CachedChatRecord } from '@/lib/cache/types';
import { useAppSession } from '@/hooks/use-app-session';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import type { ChatHistory } from '@/types/chat-history';
import { deserializeChat } from '@/lib/chat/serialization';

const CACHE_METADATA_KEY = 'cache-metadata';
const CACHE_CHAT_LIMIT = 50;
const CACHE_METADATA_VERSION = 1;

const manager = getEncryptedCacheManager();

type CacheStatus = 'disabled' | 'idle' | 'initializing' | 'ready' | 'error';

type CacheContextValue = {
  status: CacheStatus;
  ready: boolean;
  error?: Error;
  metadata: CacheMetadataPayload | null;
  cachedChats: CachedChatPayload<CachedChatRecord>[];
  refreshCache: () => Promise<void>;
  upsertChatRecord: (
    record: CachedChatRecord,
    options?: { metadata?: CacheMetadataPayload | null }
  ) => Promise<void>;
  getCachedBootstrap: (chatId: string) => ChatBootstrapResponse | undefined;
};

const EncryptedCacheContext = createContext<CacheContextValue>({
  status: 'disabled',
  ready: false,
  metadata: null,
  cachedChats: [],
  refreshCache: async () => {},
  upsertChatRecord: async () => {},
  getCachedBootstrap: () => undefined,
});

export function useEncryptedCache(): CacheContextValue {
  return useContext(EncryptedCacheContext);
}

async function storeDumpInCache(payload: {
  metadata: CacheMetadataPayload;
  chats: CachedChatRecord[];
}) {
  await manager.storeChats(
    payload.chats.map((entry) => ({
      chatId: entry.chatId,
      data: entry,
      lastUpdatedAt: (() => {
        const parsed = Date.parse(entry.lastUpdatedAt);
        return Number.isNaN(parsed) ? Date.now() : parsed;
      })(),
    }))
  );
  await manager.storeMetadata(CACHE_METADATA_KEY, payload.metadata);
}

function shouldRefreshFromServer(
  metadata: CacheMetadataPayload | null
): boolean {
  if (!metadata) return true;
  return metadata.version !== CACHE_METADATA_VERSION;
}

function primeChatHistoryQuery(
  queryClient: ReturnType<typeof useQueryClient>,
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  metadata: CacheMetadataPayload | null
) {
  if (!cachedChats.length) return;

  const existing = queryClient.getQueryData<InfiniteData<ChatHistory>>([
    'chat',
    'history',
  ]);

  const cachedChatList = cachedChats.map((entry) => {
    return deserializeChat(entry.data.chat);
  });

  if (existing) {
    const hasChats = existing.pages.some((page) => page.chats.length > 0);
    if (hasChats) {
      return;
    }
  }

  const data: InfiniteData<ChatHistory> = {
    pageParams: [undefined],
    pages: [
      {
        chats: cachedChatList,
        hasMore: metadata?.cacheCompletionMarker.hasOlderChats ?? false,
      },
    ],
  };

  queryClient.setQueryData(['chat', 'history'], data);
}

function primeBootstrapQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  cachedChats: CachedChatPayload<CachedChatRecord>[]
) {
  cachedChats.forEach((entry) => {
    if (!entry.data.bootstrap) return;
    const key = ['chat', 'bootstrap', entry.chatId];
    const existing = queryClient.getQueryData<ChatBootstrapResponse>(key);
    if (!existing) {
      queryClient.setQueryData(key, entry.data.bootstrap);
    }
  });
}

type CacheState = {
  status: CacheStatus;
  metadata: CacheMetadataPayload | null;
  cachedChats: CachedChatPayload<CachedChatRecord>[];
  error?: Error;
};

const initialState: CacheState = {
  status: 'disabled',
  metadata: null,
  cachedChats: [],
};

export function EncryptedCacheProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: sessionData, status: sessionStatus } = useAppSession();
  const [state, setState] = useState<CacheState>(initialState);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sessionUserId = sessionData?.session?.user?.id ?? null;
  const isLoggedIn = Boolean(sessionUserId);

  const loadFromCache =
    useCallback(async (): Promise<CacheMetadataPayload | null> => {
      const [cachedChats, metadataRecord] = await Promise.all([
        manager.getChats<CachedChatRecord>(),
        manager.readMetadata<CacheMetadataPayload>(CACHE_METADATA_KEY),
      ]);

      const metadata = metadataRecord?.data ?? null;

      setState((prev) => ({
        ...prev,
        status: 'ready',
        metadata,
        cachedChats,
        error: undefined,
      }));

      primeChatHistoryQuery(queryClient, cachedChats, metadata);
      primeBootstrapQueries(queryClient, cachedChats);
      return metadata;
    }, [queryClient]);

  const refreshCache = useCallback((): Promise<void> => {
    if (!isLoggedIn) {
      return Promise.resolve();
    }
    if (syncPromiseRef.current) {
      return syncPromiseRef.current;
    }

    const promise = (async () => {
      try {
        const response = await fetch('/api/cache/data-dump', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: CACHE_CHAT_LIMIT }),
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('Failed to refresh cache from server');
        }

        const payload = (await response.json()) as {
          metadata: CacheMetadataPayload;
          chats: CachedChatRecord[];
        };

        await storeDumpInCache(payload);
        await loadFromCache();
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: prev.status === 'ready' ? prev.status : 'error',
          error:
            error instanceof Error ? error : new Error('Cache sync failed'),
        }));
      } finally {
        syncPromiseRef.current = null;
      }
    })();

    syncPromiseRef.current = promise;
    return promise;
  }, [isLoggedIn, loadFromCache]);

  useEffect(() => {
    if (!isLoggedIn) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      syncPromiseRef.current = null;
      manager.deactivate();
      void manager.reset();
      setState(initialState);
      queryClient.removeQueries({ queryKey: ['chat', 'history'] });
      queryClient.removeQueries({ queryKey: ['chat', 'bootstrap'] });
      return;
    }

    if (sessionStatus === 'pending') {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    (async () => {
      setState((prev) => ({
        ...prev,
        status: 'initializing',
        error: undefined,
      }));

      try {
        const key = await fetchAndImportEncryptionKey(abortController.signal);
        await manager.activate(key);

        const metadata = await loadFromCache();

        if (shouldRefreshFromServer(metadata)) {
          await refreshCache();
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState({
          status: 'error',
          metadata: null,
          cachedChats: [],
          error:
            error instanceof Error ? error : new Error('Cache init failed'),
        });
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      abortControllerRef.current = null;
    };
  }, [isLoggedIn, sessionStatus, loadFromCache, refreshCache, queryClient]);

  const getCachedBootstrap = useCallback(
    (chatId: string) => {
      return state.cachedChats.find((entry) => entry.chatId === chatId)?.data
        .bootstrap;
    },
    [state.cachedChats]
  );

  const upsertChatRecord = useCallback(
    async (
      record: CachedChatRecord,
      options?: { metadata?: CacheMetadataPayload | null }
    ) => {
      if (!manager.isInitialized()) return;

      await manager.storeChats([
        {
          chatId: record.chatId,
          data: record,
          lastUpdatedAt: (() => {
            const parsed = Date.parse(record.lastUpdatedAt);
            return Number.isNaN(parsed) ? Date.now() : parsed;
          })(),
        },
      ]);

      if (options?.metadata) {
        await manager.storeMetadata(CACHE_METADATA_KEY, options.metadata);
      }

      await loadFromCache();
    },
    [loadFromCache]
  );

  const value = useMemo<CacheContextValue>(
    () => ({
      status: state.status,
      ready: state.status === 'ready',
      error: state.error,
      metadata: state.metadata,
      cachedChats: state.cachedChats,
      refreshCache,
      upsertChatRecord,
      getCachedBootstrap,
    }),
    [state, refreshCache, getCachedBootstrap, upsertChatRecord]
  );

  return (
    <EncryptedCacheContext.Provider value={value}>
      {children}
    </EncryptedCacheContext.Provider>
  );
}
