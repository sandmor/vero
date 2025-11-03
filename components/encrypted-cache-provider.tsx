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

const CACHE_DEBUG_TAG = '[EncryptedCache]';

function cacheDebug(...args: unknown[]): void {
  try {
    // eslint-disable-next-line no-console
    console.info(CACHE_DEBUG_TAG, ...args);
  } catch {
    // Swallow logging errors to avoid cascading failures in rendering.
  }
}

type MetadataValidationResult =
  | { ok: true; metadata: CacheMetadataPayload }
  | {
      ok: false;
      reason: 'missing' | 'version-mismatch' | 'invalid-structure';
    };

type ChatValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-structure' };

function validateMetadata(
  metadata: CacheMetadataPayload | null
): MetadataValidationResult {
  if (!metadata) {
    cacheDebug('validateMetadata: no metadata found');
    return { ok: false, reason: 'missing' };
  }

  if (metadata.version !== CACHE_METADATA_VERSION) {
    cacheDebug('validateMetadata: version mismatch', {
      expected: CACHE_METADATA_VERSION,
      received: metadata.version,
    });
    return { ok: false, reason: 'version-mismatch' };
  }

  const marker = metadata.cacheCompletionMarker;
  const markerIsValid =
    !!marker &&
    typeof marker.hasOlderChats === 'boolean' &&
    (marker.completeFromDate === null ||
      typeof marker.completeFromDate === 'string') &&
    (marker.completeToDate === null ||
      typeof marker.completeToDate === 'string');

  if (!markerIsValid || !Array.isArray(metadata.allowedModels)) {
    cacheDebug('validateMetadata: invalid structure detected', {
      marker,
      hasAllowedModelsArray: Array.isArray(metadata.allowedModels),
    });
    return { ok: false, reason: 'invalid-structure' };
  }

  return { ok: true, metadata };
}

function validateChatRecords(
  records: CachedChatPayload<CachedChatRecord>[]
): ChatValidationResult {
  for (const entry of records) {
    if (!entry || typeof entry !== 'object') {
      cacheDebug('validateChatRecords: entry missing or invalid object', entry);
      return { ok: false, reason: 'invalid-structure' };
    }

    const { chatId, data, lastUpdatedAt, cachedAt } = entry;
    if (!data || data.chatId !== chatId) {
      cacheDebug('validateChatRecords: chatId mismatch', {
        chatId,
        dataChatId: data?.chatId,
      });
      return { ok: false, reason: 'invalid-structure' };
    }

    if (!data.bootstrap || data.bootstrap.chatId !== chatId) {
      cacheDebug('validateChatRecords: bootstrap missing or mismatched', {
        chatId,
        bootstrapChatId: data.bootstrap?.chatId,
      });
      return { ok: false, reason: 'invalid-structure' };
    }

    if (!data.chat || data.chat.id !== chatId) {
      cacheDebug('validateChatRecords: serialized chat missing or mismatched', {
        chatId,
        serializedChatId: data.chat?.id,
      });
      return { ok: false, reason: 'invalid-structure' };
    }

    if (
      typeof data.chat.createdAt !== 'string' ||
      Number.isNaN(Date.parse(data.chat.createdAt))
    ) {
      cacheDebug('validateChatRecords: chat createdAt invalid', {
        chatId,
        createdAt: data.chat.createdAt,
      });
      return { ok: false, reason: 'invalid-structure' };
    }

    if (
      typeof data.lastUpdatedAt !== 'string' ||
      Number.isNaN(Date.parse(data.lastUpdatedAt))
    ) {
      cacheDebug('validateChatRecords: lastUpdatedAt invalid', {
        chatId,
        lastUpdatedAt: data.lastUpdatedAt,
      });
      return { ok: false, reason: 'invalid-structure' };
    }

    if (!Number.isFinite(lastUpdatedAt) || !Number.isFinite(cachedAt)) {
      cacheDebug('validateChatRecords: timestamp fields invalid', {
        chatId,
        lastUpdatedAt,
        cachedAt,
      });
      return { ok: false, reason: 'invalid-structure' };
    }
  }

  cacheDebug('validateChatRecords: records valid', { count: records.length });

  return { ok: true };
}

type CacheStatus = 'disabled' | 'idle' | 'initializing' | 'ready' | 'error';

type CacheContextValue = {
  status: CacheStatus;
  ready: boolean;
  error?: Error;
  metadata: CacheMetadataPayload | null;
  cachedChats: CachedChatPayload<CachedChatRecord>[];
  refreshCache: (options?: { force?: boolean }) => Promise<void>;
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
  isIntegrityValid: boolean;
};

const initialState: CacheState = {
  status: 'disabled',
  metadata: null,
  cachedChats: [],
  isIntegrityValid: false,
};

export function EncryptedCacheProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: sessionData, status: sessionStatus } = useAppSession();
  const [state, setState] = useState<CacheState>(initialState);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const encryptionKeyRef = useRef<CryptoKey | null>(null);

  const sessionUserId = sessionData?.session?.user?.id ?? null;
  const isLoggedIn = Boolean(sessionUserId);

  const ensureManagerActivated = useCallback(async () => {
    if (manager.isInitialized()) {
      cacheDebug('ensureManagerActivated: manager already active');
      return;
    }

    const key = encryptionKeyRef.current;
    if (!key) {
      cacheDebug('ensureManagerActivated: missing encryption key');
      throw new Error('Cache encryption key is unavailable for activation.');
    }

    cacheDebug('ensureManagerActivated: activating manager with existing key');
    await manager.activate(key);
  }, []);

  const loadFromCache =
    useCallback(async (): Promise<CacheMetadataPayload | null> => {
      try {
        cacheDebug('loadFromCache: attempting to read cache state');
        const [cachedChats, metadataRecord] = await Promise.all([
          manager.getChats<CachedChatRecord>(),
          manager.readMetadata<CacheMetadataPayload>(CACHE_METADATA_KEY),
        ]);

        const rawMetadata = metadataRecord?.data ?? null;
        const metadataValidation = validateMetadata(rawMetadata);
        const chatValidation = validateChatRecords(cachedChats);
        const hasStoredData = Boolean(metadataRecord) || cachedChats.length > 0;

        cacheDebug('loadFromCache: read complete', {
          chatCount: cachedChats.length,
          hasMetadata: Boolean(rawMetadata),
          metadataValidation,
          chatValidation,
        });

        if (!metadataValidation.ok || !chatValidation.ok) {
          if (!metadataValidation.ok) {
            console.warn(
              'Encrypted cache metadata invalid; scheduling refresh',
              metadataValidation.reason
            );
          } else if (!chatValidation.ok) {
            console.warn(
              'Encrypted cache chat records invalid; scheduling refresh',
              chatValidation.reason
            );
          }

          if (hasStoredData) {
            try {
              cacheDebug(
                'loadFromCache: resetting manager due to invalid data'
              );
              await manager.reset();
            } catch (resetError) {
              console.error(
                'Failed to reset encrypted cache storage',
                resetError
              );
            }
          }

          try {
            cacheDebug('loadFromCache: re-activating manager after reset');
            await ensureManagerActivated();
          } catch (activationError) {
            console.error(
              'Failed to re-activate encrypted cache after reset',
              activationError
            );
          }

          setState((prev) => ({
            ...prev,
            status: 'initializing',
            metadata: null,
            cachedChats: [],
            error: undefined,
            isIntegrityValid: false,
          }));

          return null;
        }

        cacheDebug('loadFromCache: cache integrity confirmed');
        setState((prev) => ({
          ...prev,
          status: 'ready',
          metadata: metadataValidation.metadata,
          cachedChats,
          error: undefined,
          isIntegrityValid: true,
        }));

        primeChatHistoryQuery(
          queryClient,
          cachedChats,
          metadataValidation.metadata
        );
        primeBootstrapQueries(queryClient, cachedChats);

        return metadataValidation.metadata;
      } catch (error) {
        console.warn(
          'Failed to read encrypted cache, will request refresh',
          error
        );
        cacheDebug('loadFromCache: error encountered', error);
        setState((prev) => ({
          ...prev,
          status: 'initializing',
          metadata: null,
          cachedChats: [],
          error:
            error instanceof Error ? error : new Error('Cache load failed'),
          isIntegrityValid: false,
        }));

        try {
          await manager.reset();
        } catch (resetError) {
          console.error('Failed to reset encrypted cache storage', resetError);
        }

        try {
          cacheDebug('loadFromCache: re-activating manager after read failure');
          await ensureManagerActivated();
        } catch (activationError) {
          console.error(
            'Failed to re-activate encrypted cache after read failure',
            activationError
          );
        }

        return null;
      }
    }, [ensureManagerActivated, queryClient]);

  const refreshCache = useCallback(
    (options?: { force?: boolean }): Promise<void> => {
      if (!isLoggedIn) {
        cacheDebug('refreshCache: skipped (user not logged in)');
        return Promise.resolve();
      }
      if (!options?.force && state.isIntegrityValid) {
        cacheDebug('refreshCache: skipped (cache integrity still valid)');
        return Promise.resolve();
      }
      if (syncPromiseRef.current) {
        cacheDebug('refreshCache: using in-flight sync promise');
        return syncPromiseRef.current;
      }

      const promise = (async () => {
        try {
          cacheDebug('refreshCache: starting full refresh', {
            forced: Boolean(options?.force),
            priorStatus: state.status,
          });
          setState((prev) => ({
            ...prev,
            status: 'initializing',
            error: undefined,
          }));

          await ensureManagerActivated();

          const response = await fetch('/api/cache/data-dump', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit: CACHE_CHAT_LIMIT }),
            credentials: 'include',
            cache: 'no-store',
          });

          if (!response.ok) {
            cacheDebug('refreshCache: server responded with failure', {
              status: response.status,
            });
            throw new Error('Failed to refresh cache from server');
          }

          cacheDebug('refreshCache: received new dump payload');
          const payload = (await response.json()) as {
            metadata: CacheMetadataPayload;
            chats: CachedChatRecord[];
          };

          try {
            cacheDebug('refreshCache: resetting manager before seeding');
            await manager.reset();
          } catch (resetError) {
            console.error(
              'Failed to reset encrypted cache before seeding',
              resetError
            );
          }

          await ensureManagerActivated();
          await storeDumpInCache(payload);
          cacheDebug('refreshCache: cache seeded from payload', {
            chatCount: payload.chats.length,
          });
          await loadFromCache();
        } catch (error) {
          cacheDebug('refreshCache: failed to refresh cache', error);
          setState((prev) => ({
            ...prev,
            status: prev.status === 'ready' ? prev.status : 'error',
            error:
              error instanceof Error ? error : new Error('Cache sync failed'),
            isIntegrityValid: false,
          }));
        } finally {
          cacheDebug('refreshCache: finished (clearing sync promise)');
          syncPromiseRef.current = null;
        }
      })();

      syncPromiseRef.current = promise;
      return promise;
    },
    [ensureManagerActivated, isLoggedIn, loadFromCache, state.isIntegrityValid]
  );

  useEffect(() => {
    if (sessionStatus === 'pending') {
      cacheDebug('CacheProvider effect: session pending, deferring init');
      return;
    }

    if (!isLoggedIn) {
      cacheDebug('CacheProvider effect: user logged out, clearing cache');
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      syncPromiseRef.current = null;
      manager.deactivate();
      void manager.reset();
      setState(initialState);
      queryClient.removeQueries({ queryKey: ['chat', 'history'] });
      queryClient.removeQueries({ queryKey: ['chat', 'bootstrap'] });
      encryptionKeyRef.current = null;
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
        cacheDebug('CacheProvider effect: fetching encryption key');
        const key = await fetchAndImportEncryptionKey(abortController.signal);
        encryptionKeyRef.current = key;
        await manager.activate(key);

        cacheDebug('CacheProvider effect: loading cache from storage');
        const metadata = await loadFromCache();

        if (shouldRefreshFromServer(metadata)) {
          cacheDebug(
            'CacheProvider effect: metadata stale, triggering refresh'
          );
          await refreshCache();
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          cacheDebug('CacheProvider effect: aborted during initialization');
          return;
        }
        cacheDebug('CacheProvider effect: initialization error', error);
        setState({
          status: 'error',
          metadata: null,
          cachedChats: [],
          error:
            error instanceof Error ? error : new Error('Cache init failed'),
          isIntegrityValid: false,
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

      cacheDebug('upsertChatRecord: writing chat to cache', {
        chatId: record.chatId,
        hasMetadataUpdate: Boolean(options?.metadata),
      });

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
        cacheDebug('upsertChatRecord: updating metadata');
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
