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
import { fetchEncryptionKey } from '@/lib/cache/encryption';
import {
  getEncryptedCacheManager,
  type CachedChatPayload,
} from '@/lib/cache/cache-manager';
import type {
  CacheMetadataPayload,
  CachedChatRecord,
  SyncRequest,
  SyncResponse,
} from '@/lib/cache/types';
import {
  initializeSyncManager,
  destroySyncManager,
  getSyncManager,
} from '@/lib/cache/sync-manager';
import {
  getSettingsSyncManager,
  type SettingsChangeEvent,
} from '@/lib/cache/settings-sync';
import { searchIndexService } from '@/lib/search/search-index-service';
import { useAppSession, SessionFetchError } from '@/hooks/use-app-session';
import type {
  ChatBootstrapResponse,
  NewChatBootstrap,
} from '@/types/chat-bootstrap';
import type { ChatHistory } from '@/types/chat-history';
import { deserializeChat } from '@/lib/chat/serialization';
import { generateUUID } from '@/lib/utils';
import { isModelIdAllowed } from '@/lib/ai/models';

const CACHE_METADATA_KEY = 'cache-metadata';
const CACHE_METADATA_VERSION = 1;
const SYNC_PAGE_SIZE = 100;
// Sync interval: how often to check for updates (5 minutes)
// Note: Incremental sync via /api/cache/sync already includes settings data
// in the metadata field, so we don't need a separate settings sync.
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const manager = getEncryptedCacheManager();

const CACHE_DEBUG_TAG = '[EncryptedCache]';
const IS_DEV = process.env.NODE_ENV === 'development';

function cacheDebug(...args: unknown[]): void {
  if (!IS_DEV) return;
  try {
    // eslint-disable-next-line no-console
    console.info(CACHE_DEBUG_TAG, ...args);
  } catch {
    // Swallow logging errors to avoid cascading failures in rendering.
  }
}

type MetadataRepairResult = {
  metadata: CacheMetadataPayload | null;
  repaired: boolean;
  shouldReset: boolean;
  reason?: string;
};

type ChatRepairResult = {
  sanitizedChats: CachedChatPayload<CachedChatRecord>[];
  updates: CachedChatPayload<CachedChatRecord>[];
  removals: string[];
  shouldReset: boolean;
};

function coerceIsoString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed).toISOString();
  }
  return null;
}

function repairMetadataPayload(
  metadata: CacheMetadataPayload | null
): MetadataRepairResult {
  if (!metadata) {
    return { metadata: null, repaired: false, shouldReset: false };
  }

  if (metadata.version !== CACHE_METADATA_VERSION) {
    return {
      metadata: null,
      repaired: false,
      shouldReset: true,
      reason: 'version-mismatch',
    };
  }

  let repaired = false;

  let generatedAt = metadata.generatedAt;
  const generatedIso = coerceIsoString(generatedAt);
  if (!generatedIso) {
    generatedAt = new Date().toISOString();
    repaired = true;
  } else if (generatedIso !== generatedAt) {
    generatedAt = generatedIso;
    repaired = true;
  }

  const marker = metadata.cacheCompletionMarker;
  if (!marker || typeof marker !== 'object') {
    return {
      metadata: null,
      repaired: false,
      shouldReset: true,
      reason: 'marker-missing',
    };
  }

  let hasOlderChats: boolean | null = null;
  if (typeof marker.hasOlderChats === 'boolean') {
    hasOlderChats = marker.hasOlderChats;
  } else if (typeof marker.hasOlderChats === 'string') {
    if (marker.hasOlderChats === 'true') {
      hasOlderChats = true;
      repaired = true;
    } else if (marker.hasOlderChats === 'false') {
      hasOlderChats = false;
      repaired = true;
    }
  }

  if (hasOlderChats === null) {
    return {
      metadata: null,
      repaired: false,
      shouldReset: true,
      reason: 'marker-invalid',
    };
  }

  const completeFromDate = coerceIsoString(marker.completeFromDate);
  if (marker.completeFromDate !== completeFromDate) {
    repaired = true;
  }

  const completeToDate = coerceIsoString(marker.completeToDate);
  if (marker.completeToDate !== completeToDate) {
    repaired = true;
  }

  let allowedModels: CacheMetadataPayload['allowedModels'] = [];
  if (Array.isArray(metadata.allowedModels)) {
    allowedModels = metadata.allowedModels.filter((model) => {
      return (
        !!model &&
        typeof model.id === 'string' &&
        typeof model.creator === 'string' &&
        typeof model.model === 'string'
      );
    });
    if (allowedModels.length !== metadata.allowedModels.length) {
      repaired = true;
    }
  } else {
    repaired = true;
  }

  // Validate and repair newChatDefaults
  let newChatDefaults: CacheMetadataPayload['newChatDefaults'];
  if (
    metadata.newChatDefaults &&
    typeof metadata.newChatDefaults === 'object' &&
    typeof metadata.newChatDefaults.defaultModelId === 'string' &&
    Array.isArray(metadata.newChatDefaults.allowedModelIds)
  ) {
    newChatDefaults = metadata.newChatDefaults;
  } else {
    // Derive from allowedModels if missing
    const allowedModelIds = allowedModels.map((m) => m.id);
    newChatDefaults = {
      defaultModelId: allowedModelIds[0] ?? '',
      allowedModelIds,
    };
    repaired = true;
  }

  const repairedMetadata: CacheMetadataPayload = {
    ...metadata,
    generatedAt,
    cacheCompletionMarker: {
      completeFromDate,
      completeToDate,
      hasOlderChats,
    },
    allowedModels,
    newChatDefaults,
  };

  return {
    metadata: repairedMetadata,
    repaired,
    shouldReset: false,
  };
}

function inspectAndRepairChatRecords(
  records: CachedChatPayload<CachedChatRecord>[]
): ChatRepairResult {
  const sanitizedChats: CachedChatPayload<CachedChatRecord>[] = [];
  const updates: CachedChatPayload<CachedChatRecord>[] = [];
  const removals: string[] = [];

  for (const entry of records) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.chatId !== 'string'
    ) {
      cacheDebug(
        'inspectAndRepairChatRecords: entry missing chatId, requiring reset'
      );
      return {
        sanitizedChats: [],
        updates: [],
        removals: [],
        shouldReset: true,
      };
    }

    const { chatId } = entry;
    const data = entry.data;

    if (!data || typeof data !== 'object') {
      cacheDebug(
        'inspectAndRepairChatRecords: entry missing data, removing chat',
        chatId
      );
      removals.push(chatId);
      continue;
    }

    if (typeof data.chatId !== 'string' || data.chatId !== chatId) {
      cacheDebug(
        'inspectAndRepairChatRecords: chatId mismatch, dropping chat',
        {
          chatId,
          storedChatId: data.chatId,
        }
      );
      removals.push(chatId);
      continue;
    }

    let mutated = false;
    const sanitizedData: CachedChatRecord = {
      ...data,
      chat: data.chat ? { ...data.chat } : data.chat,
      bootstrap: data.bootstrap,
    };

    const normalizedLastUpdated =
      typeof sanitizedData.lastUpdatedAt === 'number'
        ? coerceIsoString(sanitizedData.lastUpdatedAt)
        : coerceIsoString(sanitizedData.lastUpdatedAt);

    if (!normalizedLastUpdated) {
      cacheDebug(
        'inspectAndRepairChatRecords: invalid lastUpdatedAt, removing chat',
        {
          chatId,
          lastUpdatedAt: sanitizedData.lastUpdatedAt,
        }
      );
      removals.push(chatId);
      continue;
    }

    if (sanitizedData.lastUpdatedAt !== normalizedLastUpdated) {
      sanitizedData.lastUpdatedAt = normalizedLastUpdated;
      mutated = true;
    }

    if (!sanitizedData.bootstrap || sanitizedData.bootstrap.chatId !== chatId) {
      cacheDebug(
        'inspectAndRepairChatRecords: invalid bootstrap, removing chat',
        {
          chatId,
          bootstrapChatId: sanitizedData.bootstrap?.chatId,
        }
      );
      removals.push(chatId);
      continue;
    }

    const serializedChat = sanitizedData.chat;
    if (!serializedChat || typeof serializedChat !== 'object') {
      cacheDebug(
        'inspectAndRepairChatRecords: serialized chat missing, removing chat',
        { chatId }
      );
      removals.push(chatId);
      continue;
    }

    if (serializedChat.id !== chatId) {
      cacheDebug(
        'inspectAndRepairChatRecords: serialized chat id mismatch, removing chat',
        {
          chatId,
          serializedId: serializedChat.id,
        }
      );
      removals.push(chatId);
      continue;
    }

    const normalizedCreatedAt = coerceIsoString(serializedChat.createdAt);
    if (!normalizedCreatedAt) {
      cacheDebug(
        'inspectAndRepairChatRecords: invalid chat.createdAt, removing chat',
        {
          chatId,
          createdAt: serializedChat.createdAt,
        }
      );
      removals.push(chatId);
      continue;
    }

    if (serializedChat.createdAt !== normalizedCreatedAt) {
      sanitizedData.chat = {
        ...serializedChat,
        createdAt: normalizedCreatedAt,
      } as CachedChatRecord['chat'];
      mutated = true;
    }

    const normalizedPayloadLastUpdated = Number.isFinite(entry.lastUpdatedAt)
      ? entry.lastUpdatedAt
      : Date.parse(sanitizedData.lastUpdatedAt);
    const normalizedPayloadCachedAt = Number.isFinite(entry.cachedAt)
      ? entry.cachedAt
      : Date.now();

    const sanitizedEntry: CachedChatPayload<CachedChatRecord> = {
      ...entry,
      data: sanitizedData,
      lastUpdatedAt: Number.isFinite(normalizedPayloadLastUpdated)
        ? normalizedPayloadLastUpdated
        : Date.now(),
      cachedAt: normalizedPayloadCachedAt,
    };

    if (
      sanitizedEntry.lastUpdatedAt !== entry.lastUpdatedAt ||
      sanitizedEntry.cachedAt !== entry.cachedAt ||
      mutated
    ) {
      updates.push(sanitizedEntry);
      mutated = true;
    }

    sanitizedChats.push(sanitizedEntry);
  }

  return {
    sanitizedChats,
    updates,
    removals,
    shouldReset: false,
  };
}

async function repairCacheState(
  metadata: CacheMetadataPayload | null,
  cachedChats: CachedChatPayload<CachedChatRecord>[]
): Promise<{
  metadata: CacheMetadataPayload | null;
  cachedChats: CachedChatPayload<CachedChatRecord>[];
  shouldReset: boolean;
}> {
  const metadataResult = repairMetadataPayload(metadata);

  if (metadataResult.shouldReset) {
    cacheDebug('repairCacheState: metadata unrecoverable', {
      reason: metadataResult.reason,
    });
    return { metadata: null, cachedChats: [], shouldReset: true };
  }

  const chatResult = inspectAndRepairChatRecords(cachedChats);

  if (chatResult.shouldReset) {
    cacheDebug(
      'repairCacheState: chat payload unrecoverable; scheduling reset'
    );
    return {
      metadata: metadataResult.metadata,
      cachedChats: [],
      shouldReset: true,
    };
  }

  if (metadataResult.repaired && metadataResult.metadata) {
    await manager.storeMetadata(CACHE_METADATA_KEY, metadataResult.metadata);
  }

  if (chatResult.removals.length > 0) {
    const uniqueRemovals = Array.from(new Set(chatResult.removals));
    cacheDebug('repairCacheState: removing corrupted chats', {
      chatIds: uniqueRemovals,
    });
    for (const chatId of uniqueRemovals) {
      try {
        await manager.removeChat(chatId);
      } catch (error) {
        console.warn('Failed to remove corrupted chat from cache', {
          chatId,
          error,
        });
        return {
          metadata: metadataResult.metadata,
          cachedChats: [],
          shouldReset: true,
        };
      }
    }
  }

  if (chatResult.updates.length > 0) {
    cacheDebug('repairCacheState: re-writing sanitized chats', {
      count: chatResult.updates.length,
    });
    try {
      await manager.storeChats(
        chatResult.updates.map((entry) => ({
          chatId: entry.chatId,
          data: entry.data,
          lastUpdatedAt: (() => {
            const parsed = Date.parse(entry.data.lastUpdatedAt);
            return Number.isNaN(parsed) ? Date.now() : parsed;
          })(),
          optimisticState: entry.optimisticState,
        }))
      );
    } catch (error) {
      console.warn('Failed to rewrite sanitized chats, forcing reset', error);
      return {
        metadata: metadataResult.metadata,
        cachedChats: [],
        shouldReset: true,
      };
    }
  }

  const needsRefetch =
    metadataResult.repaired ||
    chatResult.removals.length > 0 ||
    chatResult.updates.length > 0;

  const finalChats = needsRefetch
    ? await manager.getChats<CachedChatRecord>()
    : chatResult.sanitizedChats;

  return {
    metadata: metadataResult.metadata,
    cachedChats: finalChats,
    shouldReset: false,
  };
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

  const newChatDefaultsValid =
    !!metadata.newChatDefaults &&
    typeof metadata.newChatDefaults.defaultModelId === 'string' &&
    Array.isArray(metadata.newChatDefaults.allowedModelIds);

  if (
    !markerIsValid ||
    !Array.isArray(metadata.allowedModels) ||
    !newChatDefaultsValid
  ) {
    cacheDebug('validateMetadata: invalid structure detected', {
      marker,
      hasAllowedModelsArray: Array.isArray(metadata.allowedModels),
      hasNewChatDefaults: newChatDefaultsValid,
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

// Optimistic state for immediate UI feedback
type OptimisticChat = {
  id: string;
  title: string;
  createdAt: Date;
};

type OptimisticState = {
  pendingChats: OptimisticChat[];
  deletedChatIds: Set<string>;
  titleUpdates: Map<string, string>;
};

type CacheContextValue = {
  status: CacheStatus;
  ready: boolean;
  error?: Error;
  metadata: CacheMetadataPayload | null;
  cachedChats: CachedChatPayload<CachedChatRecord>[];
  refreshCache: (options?: {
    force?: boolean;
    excludeChatIds?: Set<string>;
    settingsOnly?: boolean;
  }) => Promise<void>;
  upsertChatRecord: (
    record: CachedChatRecord,
    options?: { metadata?: CacheMetadataPayload | null }
  ) => Promise<void>;
  getCachedBootstrap: (chatId: string) => ChatBootstrapResponse | undefined;
  /**
   * Generates bootstrap data for a new chat from cache metadata.
   * Returns null if cache is not ready or metadata is unavailable.
   */
  generateNewChatBootstrap: () => ChatBootstrapResponse | null;
  // Optimistic operations for immediate UI feedback
  addOptimisticChat: (chat: { id: string; title: string }) => void;
  removeOptimisticChat: (chatId: string) => void;
  updateChatTitle: (chatId: string, newTitle: string) => void;
  // Sync manager integration
  /**
   * Set the active chat being viewed. This chat receives special sync protection.
   */
  setActiveChat: (chatId: string | null) => void;
  /**
   * Mark that generation has started on the active chat.
   * During generation, the active chat is protected from external sync updates.
   */
  markGenerationStarted: () => void;
  /**
   * Mark that generation has ended on the active chat.
   */
  markGenerationEnded: () => void;
  /**
   * Record a local change to a chat (for echo filtering).
   */
  recordLocalChange: (chatId: string) => void;
  /**
   * Check if this tab is the sync leader.
   */
  isSyncLeader: () => boolean;
  /**
   * Subscribe to message update events from other tabs.
   * Returns an unsubscribe function.
   */
  subscribeToMessageUpdates: (
    callback: (chatId: string, updatedAt: number) => void
  ) => () => void;
};

const EncryptedCacheContext = createContext<CacheContextValue>({
  status: 'disabled',
  ready: false,
  metadata: null,
  cachedChats: [],
  refreshCache: async () => {},
  upsertChatRecord: async () => {},
  getCachedBootstrap: () => undefined,
  generateNewChatBootstrap: () => null,
  addOptimisticChat: () => {},
  removeOptimisticChat: () => {},
  updateChatTitle: () => {},
  setActiveChat: () => {},
  markGenerationStarted: () => {},
  markGenerationEnded: () => {},
  recordLocalChange: () => {},
  isSyncLeader: () => true,
  subscribeToMessageUpdates: () => () => {},
});

export function useEncryptedCache(): CacheContextValue {
  return useContext(EncryptedCacheContext);
}

async function storeChatsInCache(chats: CachedChatRecord[]) {
  if (chats.length === 0) return;
  await manager.storeChats(
    chats.map((entry) => ({
      chatId: entry.chatId,
      data: entry,
      lastUpdatedAt: (() => {
        const parsed = Date.parse(entry.lastUpdatedAt);
        return Number.isNaN(parsed) ? Date.now() : parsed;
      })(),
    }))
  );
}

async function removeChatsFromCache(chatIds: string[]) {
  for (const chatId of chatIds) {
    try {
      await manager.removeChat(chatId);
    } catch (error) {
      console.warn('Failed to remove chat from cache', { chatId, error });
    }
  }
}

async function performIncrementalSync(
  lastSyncedAt: string | null,
  signal?: AbortSignal
): Promise<{
  upserts: CachedChatRecord[];
  deletions: string[];
  metadata: CacheMetadataPayload | null;
  serverTimestamp: string;
  totalChats: number;
}> {
  let allUpserts: CachedChatRecord[] = [];
  let allDeletions: string[] = [];
  let metadata: CacheMetadataPayload | null = null;
  let serverTimestamp = '';
  let totalChats = 0;
  let cursor: string | null = null;
  let hasMore = true;
  let isFirstPage = true;

  // Monitoring: Log sync type in dev environment
  if (IS_DEV) {
    const syncType = lastSyncedAt ? 'INCREMENTAL' : 'INITIAL';
    // eslint-disable-next-line no-console
    console.info(
      `[SYNC-MONITOR] Starting ${syncType} sync via /api/cache/sync`
    );
  }

  while (hasMore) {
    if (signal?.aborted) {
      throw new DOMException('Sync aborted', 'AbortError');
    }

    const requestBody: SyncRequest = {
      lastSyncedAt,
      pageSize: SYNC_PAGE_SIZE,
      cursor,
    };

    const response = await fetch('/api/cache/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      credentials: 'include',
      cache: 'no-store',
      signal,
    });

    if (!response.ok) {
      throw new Error(`Sync failed with status ${response.status}`);
    }

    const page: SyncResponse = await response.json();

    allUpserts = [...allUpserts, ...page.upserts];

    if (isFirstPage) {
      allDeletions = page.deletions;
      if (page.metadata) {
        metadata = page.metadata;
      }
    }

    serverTimestamp = page.serverTimestamp;
    totalChats = page.totalChats;
    hasMore = page.hasMore;
    cursor = page.nextCursor;
    isFirstPage = false;
  }

  return {
    upserts: allUpserts,
    deletions: allDeletions,
    metadata,
    serverTimestamp,
    totalChats,
  };
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
  metadata: CacheMetadataPayload | null,
  forceUpdate = false
) {
  if (!cachedChats.length) return;

  const existing = queryClient.getQueryData<InfiniteData<ChatHistory>>([
    'chat',
    'history',
  ]);

  const cachedChatList = [] as ReturnType<typeof deserializeChat>[];

  for (const entry of cachedChats) {
    try {
      cachedChatList.push(deserializeChat(entry.data.chat));
    } catch (error) {
      console.warn('Failed to deserialize cached chat, skipping entry', {
        chatId: entry.chatId,
        error,
      });
    }
  }

  if (!cachedChatList.length) return;

  // Sort by createdAt descending to match the expected order
  cachedChatList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Only skip update if there's existing data and forceUpdate is false
  if (!forceUpdate && existing) {
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
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  forceUpdate = false
) {
  cachedChats.forEach((entry) => {
    if (!entry.data.bootstrap) return;
    const key = ['chat', 'bootstrap', entry.chatId];
    const existing = queryClient.getQueryData<ChatBootstrapResponse>(key);
    if (!existing || forceUpdate) {
      queryClient.setQueryData(key, entry.data.bootstrap);
    }
  });
}

function removeDeletedChatsFromQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  deletedChatIds: string[]
) {
  if (deletedChatIds.length === 0) return;

  const deletedSet = new Set(deletedChatIds);

  // Remove from history query
  queryClient.setQueryData<InfiniteData<ChatHistory>>(
    ['chat', 'history'],
    (existing) => {
      if (!existing) return existing;
      return {
        ...existing,
        pages: existing.pages.map((page) => ({
          ...page,
          chats: page.chats.filter((chat) => !deletedSet.has(chat.id)),
        })),
      };
    }
  );

  // Remove bootstrap queries for deleted chats
  deletedChatIds.forEach((chatId) => {
    queryClient.removeQueries({ queryKey: ['chat', 'bootstrap', chatId] });
  });

  // Invalidate search queries since they may contain deleted chats
  queryClient.invalidateQueries({ queryKey: ['chat', 'search'] });
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
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const {
    data: sessionData,
    status: sessionStatus,
    error: sessionError,
  } = useAppSession();
  const [state, setState] = useState<CacheState>(initialState);

  // Use refs to hold state values that callbacks need without causing re-creation
  const stateRef = useRef(state);
  stateRef.current = state;

  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const encryptionKeyRef = useRef<CryptoKey | null>(null);
  const isInitializedRef = useRef(false);

  const sessionUserId = sessionData?.session?.user?.id ?? null;
  const isLoggedIn = Boolean(sessionUserId);
  const isLoggedInRef = useRef(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;

  // Optimistic state for immediate UI feedback
  const [optimisticState, setOptimisticState] = useState<OptimisticState>({
    pendingChats: [],
    deletedChatIds: new Set(),
    titleUpdates: new Map(),
  });

  // Add an optimistic chat for immediate sidebar display
  const addOptimisticChat = useCallback(
    (chat: { id: string; title: string }) => {
      setOptimisticState((prev) => ({
        ...prev,
        pendingChats: [
          { id: chat.id, title: chat.title, createdAt: new Date() },
          ...prev.pendingChats.filter((c) => c.id !== chat.id),
        ],
      }));
    },
    []
  );

  // Remove an optimistic chat (when real chat is synced or deleted)
  const removeOptimisticChat = useCallback((chatId: string) => {
    setOptimisticState((prev) => ({
      ...prev,
      pendingChats: prev.pendingChats.filter((c) => c.id !== chatId),
      deletedChatIds: new Set([...prev.deletedChatIds, chatId]),
    }));
  }, []);

  // Update chat title optimistically for immediate UI feedback
  const updateChatTitle = useCallback((chatId: string, newTitle: string) => {
    setOptimisticState((prev) => {
      const newTitleUpdates = new Map(prev.titleUpdates);
      newTitleUpdates.set(chatId, newTitle);
      return { ...prev, titleUpdates: newTitleUpdates };
    });
  }, []);

  // Clear optimistic state for chats that now exist in the real cache
  useEffect(() => {
    const realChatIds = new Set(state.cachedChats.map((c) => c.chatId));
    setOptimisticState((prev) => {
      const filteredPending = prev.pendingChats.filter(
        (c) => !realChatIds.has(c.id)
      );
      // Also clear deleted IDs that aren't in cache (already removed)
      const filteredDeleted = new Set(
        [...prev.deletedChatIds].filter((id) => realChatIds.has(id))
      );
      // Clear title updates for chats not in cache
      const filteredTitles = new Map(
        [...prev.titleUpdates].filter(([id]) => realChatIds.has(id))
      );
      if (
        filteredPending.length !== prev.pendingChats.length ||
        filteredDeleted.size !== prev.deletedChatIds.size ||
        filteredTitles.size !== prev.titleUpdates.size
      ) {
        return {
          pendingChats: filteredPending,
          deletedChatIds: filteredDeleted,
          titleUpdates: filteredTitles,
        };
      }
      return prev;
    });
  }, [state.cachedChats]);

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
  }, []); // No dependencies - uses refs only

  const loadFromCache = useCallback(
    async (options?: {
      forceUpdateQueries?: boolean;
    }): Promise<CacheMetadataPayload | null> => {
      const forceUpdate = options?.forceUpdateQueries ?? false;
      try {
        cacheDebug('loadFromCache: attempting to read cache state');
        const [rawCachedChats, metadataRecord] = await Promise.all([
          manager.getChats<CachedChatRecord>(),
          manager.readMetadata<CacheMetadataPayload>(CACHE_METADATA_KEY),
        ]);

        const rawMetadata = metadataRecord?.data ?? null;
        const hasStoredData =
          Boolean(metadataRecord) || rawCachedChats.length > 0;

        const repairOutcome = await repairCacheState(
          rawMetadata,
          rawCachedChats
        );

        if (repairOutcome.shouldReset) {
          cacheDebug('loadFromCache: repairs failed; resetting cache');
          if (hasStoredData) {
            try {
              await manager.reset();
            } catch (resetError) {
              console.error(
                'Failed to reset encrypted cache storage',
                resetError
              );
            }
          }

          try {
            cacheDebug(
              'loadFromCache: re-activating manager after forced reset'
            );
            await ensureManagerActivated();
          } catch (activationError) {
            console.error(
              'Failed to re-activate encrypted cache after forced reset',
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

        const metadataValidation = validateMetadata(repairOutcome.metadata);
        const chatValidation = validateChatRecords(repairOutcome.cachedChats);

        cacheDebug('loadFromCache: read complete', {
          chatCount: repairOutcome.cachedChats.length,
          hasMetadata: Boolean(repairOutcome.metadata),
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
                'loadFromCache: resetting manager due to invalid data after validation'
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
          cachedChats: repairOutcome.cachedChats,
          error: undefined,
          isIntegrityValid: true,
        }));

        const qc = queryClientRef.current;
        primeChatHistoryQuery(
          qc,
          repairOutcome.cachedChats,
          metadataValidation.metadata,
          forceUpdate
        );
        primeBootstrapQueries(qc, repairOutcome.cachedChats, forceUpdate);

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
    },
    [ensureManagerActivated]
  ); // Only depends on ensureManagerActivated (stable)

  /**
   * Refresh the cache by syncing with the server.
   *
   * Note: Settings data (allowedModels, newChatDefaults) are automatically
   * included in the metadata field of /api/cache/sync responses, so there's
   * no need for a separate settings sync endpoint call.
   *
   * @param options.force - Force a full sync even if cache is valid
   * @param options.excludeChatIds - Chat IDs to exclude from sync (for active chat protection)
   */
  const refreshCache = useCallback(
    (options?: {
      force?: boolean;
      excludeChatIds?: Set<string>;
    }): Promise<void> => {
      const currentState = stateRef.current;
      const currentIsLoggedIn = isLoggedInRef.current;

      if (!currentIsLoggedIn) {
        cacheDebug('refreshCache: skipped (user not logged in)');
        return Promise.resolve();
      }
      if (!options?.force && currentState.isIntegrityValid) {
        cacheDebug('refreshCache: skipped (cache integrity still valid)');
        return Promise.resolve();
      }
      if (syncPromiseRef.current) {
        cacheDebug('refreshCache: using in-flight sync promise');
        return syncPromiseRef.current;
      }

      const excludeChatIds = options?.excludeChatIds;

      const promise = (async () => {
        // Re-read state at start of async operation
        const state = stateRef.current;
        const qc = queryClientRef.current;

        try {
          // Note: /api/cache/sync returns both chat updates AND settings data
          // (allowedModels, newChatDefaults) in the metadata field, so we get
          // everything in one efficient incremental sync call.
          cacheDebug('refreshCache: starting incremental sync', {
            forced: Boolean(options?.force),
            priorStatus: state.status,
            hasExistingMetadata: Boolean(state.metadata),
            excludedChats: excludeChatIds ? Array.from(excludeChatIds) : [],
          });
          // Don't set status to initializing if we already have data
          // This prevents UI skeletons/blocking during background sync
          setState((prev) => ({
            ...prev,
            status: prev.status === 'ready' ? 'ready' : 'initializing',
            error: undefined,
          }));

          await ensureManagerActivated();

          // Determine if this is an initial sync or incremental
          const isInitialSync = !state.metadata?.lastSyncedAt || options?.force;
          const lastSyncedAt = isInitialSync
            ? null
            : (state.metadata?.lastSyncedAt ?? null);

          cacheDebug('refreshCache: performing sync', {
            isInitialSync,
            lastSyncedAt,
          });

          const syncResult = await performIncrementalSync(
            lastSyncedAt,
            abortControllerRef.current?.signal
          );

          cacheDebug('refreshCache: sync completed', {
            upsertsCount: syncResult.upserts.length,
            deletionsCount: syncResult.deletions.length,
            totalChats: syncResult.totalChats,
          });

          // Filter out excluded chats from upserts (protected chats)
          const filteredUpserts = excludeChatIds
            ? syncResult.upserts.filter((u) => !excludeChatIds.has(u.chatId))
            : syncResult.upserts;

          // Filter out excluded chats from deletions (protected chats)
          const filteredDeletions = excludeChatIds
            ? syncResult.deletions.filter((id) => !excludeChatIds.has(id))
            : syncResult.deletions;

          if (excludeChatIds && excludeChatIds.size > 0) {
            cacheDebug('refreshCache: filtered out protected chats', {
              originalUpserts: syncResult.upserts.length,
              filteredUpserts: filteredUpserts.length,
              originalDeletions: syncResult.deletions.length,
              filteredDeletions: filteredDeletions.length,
            });
          }

          // Handle deletions
          if (filteredDeletions.length > 0) {
            cacheDebug('refreshCache: removing deleted chats', {
              count: filteredDeletions.length,
            });
            await removeChatsFromCache(filteredDeletions);
            // Also remove from React Query cache
            removeDeletedChatsFromQueries(qc, filteredDeletions);
          }

          // Handle upserts
          if (filteredUpserts.length > 0) {
            cacheDebug('refreshCache: storing updated chats', {
              count: filteredUpserts.length,
            });
            await storeChatsInCache(filteredUpserts);
          }

          // Update metadata with sync timestamp
          const updatedMetadata: CacheMetadataPayload = {
            ...(syncResult.metadata ??
              state.metadata ?? {
                version: CACHE_METADATA_VERSION,
                generatedAt: syncResult.serverTimestamp,
                cacheCompletionMarker: {
                  completeFromDate: null,
                  completeToDate: null,
                  hasOlderChats: false,
                },
                allowedModels: [],
                newChatDefaults: {
                  defaultModelId: '',
                  allowedModelIds: [],
                },
              }),
            lastSyncedAt: syncResult.serverTimestamp,
            totalChats: syncResult.totalChats,
          };

          await manager.storeMetadata(CACHE_METADATA_KEY, updatedMetadata);

          cacheDebug('refreshCache: updating in-memory state incrementally');

          const nextChatsMap = new Map<
            string,
            CachedChatPayload<CachedChatRecord>
          >();

          // Start with existing chats
          for (const chat of state.cachedChats) {
            nextChatsMap.set(chat.chatId, chat);
          }

          // Remove deletions (use filtered list to preserve protected chats)
          for (const id of filteredDeletions) {
            nextChatsMap.delete(id);
          }

          // Apply upserts (use filtered list to preserve protected chats)
          const processingTime = Date.now();
          for (const record of filteredUpserts) {
            const parsedLastUpdated = Date.parse(record.lastUpdatedAt);
            const lastUpdatedAt = Number.isNaN(parsedLastUpdated)
              ? processingTime
              : parsedLastUpdated;

            const payload: CachedChatPayload<CachedChatRecord> = {
              chatId: record.chatId,
              data: record,
              lastUpdatedAt,
              cachedAt: processingTime,
              // Optimistic state is cleared on server update as the server is the source of truth
              optimisticState: undefined,
            };
            nextChatsMap.set(record.chatId, payload);
          }

          // Convert to array and sort
          const nextCachedChats = Array.from(nextChatsMap.values()).sort(
            (a, b) => b.lastUpdatedAt - a.lastUpdatedAt
          );

          setState((prev) => ({
            ...prev,
            status: 'ready',
            metadata: updatedMetadata,
            cachedChats: nextCachedChats,
            error: undefined,
            isIntegrityValid: true,
          }));

          // 5. Update React Query
          // We use the exact same logic as loadFromCache
          primeChatHistoryQuery(qc, nextCachedChats, updatedMetadata, true);
          primeBootstrapQueries(qc, nextCachedChats, true);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            cacheDebug('refreshCache: sync aborted');
            return;
          }
          cacheDebug('refreshCache: failed to sync cache', error);
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
    [ensureManagerActivated, loadFromCache] // Stable dependencies only - uses refs for state
  );

  useEffect(() => {
    if (sessionStatus === 'pending') {
      cacheDebug('CacheProvider effect: session pending, deferring init');
      return;
    }

    if (sessionStatus === 'error') {
      const isAuthFailure =
        sessionError instanceof SessionFetchError &&
        (sessionError.status === 401 || sessionError.status === 403);

      if (!isAuthFailure) {
        cacheDebug(
          'CacheProvider effect: session check failed (network/server error), preserving cache',
          sessionError
        );
        return;
      }
    }

    if (!isLoggedIn) {
      cacheDebug('CacheProvider effect: user logged out, clearing cache');
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      syncPromiseRef.current = null;
      isInitializedRef.current = false;
      manager.deactivate();
      void manager.reset();
      setState(initialState);
      queryClientRef.current.removeQueries({ queryKey: ['chat', 'history'] });
      queryClientRef.current.removeQueries({ queryKey: ['chat', 'bootstrap'] });
      encryptionKeyRef.current = null;
      return;
    }

    // Prevent re-initialization if already initialized
    if (isInitializedRef.current) {
      cacheDebug('CacheProvider effect: already initialized, skipping');
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
        const { cryptoKey: key, base64Key } = await fetchEncryptionKey(
          abortController.signal
        );

        if (cancelled) return;

        encryptionKeyRef.current = key;
        await manager.activate(key);

        // Initialize the search index worker with the encryption key
        // so it can handle its own persistence without blocking the main thread
        await searchIndexService.initializeWorker(base64Key);

        if (cancelled) return;

        isInitializedRef.current = true;

        cacheDebug('CacheProvider effect: loading cache from storage');
        const metadata = await loadFromCache();

        if (cancelled) return;

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
  }, [isLoggedIn, sessionStatus]); // Only re-run on login state changes

  // Store refreshCache in a ref for stable SyncManager callback
  const refreshCacheRef = useRef(refreshCache);
  refreshCacheRef.current = refreshCache;

  // Message update subscribers - for cross-tab real-time sync
  const messageUpdateSubscribersRef = useRef<
    Set<(chatId: string, updatedAt: number) => void>
  >(new Set());

  // Initialize the SyncManager
  useEffect(() => {
    if (!isLoggedIn || state.status !== 'ready') {
      destroySyncManager();
      return;
    }

    const syncManager = initializeSyncManager({
      onSync: async ({ force, excludeChatIds }) => {
        await refreshCacheRef.current({ force, excludeChatIds });
      },
      onCacheReload: async () => {
        // This is called when another tab completes a sync
        // Reload cache from storage to pick up changes
        cacheDebug('Reloading cache from storage (triggered by another tab)');
        await loadFromCache({ forceUpdateQueries: true });
      },
      onMessagesUpdated: (chatId, updatedAt) => {
        // Forward message update events to all subscribers
        cacheDebug('Message update received from another tab:', chatId);
        messageUpdateSubscribersRef.current.forEach((callback) => {
          try {
            callback(chatId, updatedAt);
          } catch (error) {
            console.warn('Error in message update subscriber:', error);
          }
        });
      },
      debounceMs: 500,
      postGenerationProtectionMs: 2000,
      debug: IS_DEV,
    });

    cacheDebug('SyncManager initialized');

    return () => {
      destroySyncManager();
    };
  }, [isLoggedIn, state.status, loadFromCache]);

  /**
   * Periodic sync effect - coordinates with SyncManager for tab leadership.
   *
   * CRITICAL DESIGN DECISIONS:
   *
   * 1. Why wait for election?
   *    We MUST wait for tab leader election to complete before starting the
   *    periodic sync interval. Without this, all tabs would try to sync during
   *    the ~100ms election window, causing a burst of API calls.
   *
   * 2. Why not check isLeader() before calling requestSync()?
   *    The requestSync() method already handles leadership internally - if not
   *    leader, it delegates to the leader tab via BroadcastChannel. Checking
   *    isLeader() here would be redundant and could introduce race conditions
   *    during leadership transitions.
   *
   * 3. Why is settings sync consolidated here?
   *    The /api/cache/sync endpoint returns settings data (allowedModels,
   *    newChatDefaults) in the metadata field of every response, so there's
   *    no need for a separate /api/cache/settings call. This reduces API load
   *    compared to having separate sync intervals.
   *
   * 4. How does this work with realtime?
   *    Realtime events (WebSocket) trigger immediate syncs via requestSync(),
   *    which get debounced and coalesced. This periodic sync is just a fallback
   *    for when realtime is unavailable or to catch any missed events.
   */
  useEffect(() => {
    if (!isLoggedIn || state.status !== 'ready') {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    // Wait for leader election before starting periodic syncs
    const startPeriodicSync = async () => {
      const syncManager = getSyncManager();
      if (!syncManager) return;

      try {
        cacheDebug('Waiting for tab leader election to complete...');
        await syncManager.waitForElection();

        if (cancelled) return;

        cacheDebug(
          'Tab leader election complete, starting periodic sync interval'
        );

        intervalId = setInterval(() => {
          cacheDebug('Periodic sync: requesting through SyncManager');
          const sm = getSyncManager();
          sm?.requestSync('periodic');
        }, SYNC_INTERVAL_MS);
      } catch (error) {
        console.warn('Error waiting for tab leader election:', error);
      }
    };

    void startPeriodicSync();

    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isLoggedIn, state.status]); // Only re-setup interval when login or ready state changes

  // Sync manager method wrappers
  const setActiveChat = useCallback((chatId: string | null) => {
    const syncManager = getSyncManager();
    syncManager?.setActiveChat(chatId);
  }, []);

  const markGenerationStarted = useCallback(() => {
    const syncManager = getSyncManager();
    syncManager?.markGenerationStarted();
  }, []);

  const markGenerationEnded = useCallback(() => {
    const syncManager = getSyncManager();
    syncManager?.markGenerationEnded();
  }, []);

  const recordLocalChange = useCallback((chatId: string) => {
    const syncManager = getSyncManager();
    syncManager?.recordLocalChange(chatId);
  }, []);

  const isSyncLeader = useCallback(() => {
    const syncManager = getSyncManager();
    return syncManager?.isLeader() ?? true;
  }, []);

  // Subscribe to message update events from other tabs
  const subscribeToMessageUpdates = useCallback(
    (callback: (chatId: string, updatedAt: number) => void): (() => void) => {
      messageUpdateSubscribersRef.current.add(callback);
      return () => {
        messageUpdateSubscribersRef.current.delete(callback);
      };
    },
    []
  );

  const getCachedBootstrap = useCallback(
    (chatId: string) => {
      return state.cachedChats.find((entry) => entry.chatId === chatId)?.data
        .bootstrap;
    },
    [state.cachedChats]
  );

  /**
   * Generates bootstrap data for a new chat from cache metadata.
   * Uses stored user preferences (model, reasoning) from cookies client-side.
   */
  const generateNewChatBootstrap = useCallback((): NewChatBootstrap | null => {
    const metadata = state.metadata;
    if (!metadata || !metadata.newChatDefaults) {
      return null;
    }

    const { newChatDefaults, allowedModels } = metadata;
    const { defaultModelId, allowedModelIds } = newChatDefaults;

    // Read user preferences from cookies (client-side)
    const getCookie = (name: string): string | undefined => {
      if (typeof document === 'undefined') return undefined;
      const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
      return match ? decodeURIComponent(match[2]) : undefined;
    };

    const cookieModelId = getCookie('chat-model');
    const cookieReasoning = getCookie('chat-reasoning') as
      | 'low'
      | 'medium'
      | 'high'
      | undefined;

    // Determine initial model: prefer cookie if allowed, otherwise use default
    let initialChatModel = defaultModelId;
    if (cookieModelId && isModelIdAllowed(cookieModelId, allowedModelIds)) {
      initialChatModel = cookieModelId;
    }

    // Build initial settings if we have reasoning preference
    const initialSettings =
      cookieReasoning && ['low', 'medium', 'high'].includes(cookieReasoning)
        ? { reasoningEffort: cookieReasoning }
        : null;

    return {
      kind: 'new',
      chatId: generateUUID(),
      autoResume: false,
      isReadonly: false,
      initialVisibilityType: 'private',
      initialChatModel,
      allowedModels,
      initialSettings,
      initialAgent: null,
      initialBranchState: { rootMessageIndex: null },
    };
  }, [state.metadata]);

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

      await loadFromCache({ forceUpdateQueries: true });

      const syncManager = getSyncManager();
      syncManager?.notifySyncComplete(new Date().toISOString());
    },
    [loadFromCache]
  );

  // Merge optimistic state with real cached chats for UI
  const mergedCachedChats = useMemo(() => {
    // Filter out deleted chats and apply title updates
    const filteredChats = state.cachedChats
      .filter((c) => !optimisticState.deletedChatIds.has(c.chatId))
      .map((entry) => {
        const titleUpdate = optimisticState.titleUpdates.get(entry.chatId);
        if (titleUpdate && entry.data.chat) {
          return {
            ...entry,
            data: {
              ...entry.data,
              chat: { ...entry.data.chat, title: titleUpdate },
            },
          };
        }
        return entry;
      });

    // Add pending optimistic chats that aren't in real cache
    const realChatIds = new Set(filteredChats.map((c) => c.chatId));
    const pendingEntries = optimisticState.pendingChats
      .filter(
        (c) =>
          !realChatIds.has(c.id) && !optimisticState.deletedChatIds.has(c.id)
      )
      .map((c) => ({
        chatId: c.id,
        data: {
          chatId: c.id,
          lastUpdatedAt: c.createdAt.toISOString(),
          chat: {
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.createdAt,
            userId: '',
            visibility: 'private' as const,
            lastContext: null,
            settings: null,
            agent: null,
            agentId: null,
            parentChatId: null,
            forkedFromMessageId: null,
            forkDepth: 0,
            rootMessageIndex: 0,
          },
          bootstrap: undefined,
        },
        lastUpdatedAt: c.createdAt.getTime(),
        cachedAt: c.createdAt.getTime(),
      })) as unknown as CachedChatPayload<CachedChatRecord>[];

    return [...pendingEntries, ...filteredChats];
  }, [state.cachedChats, optimisticState]);

  const value = useMemo<CacheContextValue>(
    () => ({
      status: state.status,
      // Keep the cache "ready" while we have hydrated data, even if a
      // background incremental sync temporarily switches status away from
      // ready. This prevents UI skeletons from flashing during syncs.
      ready: state.status === 'ready' || mergedCachedChats.length > 0,
      error: state.error,
      metadata: state.metadata,
      cachedChats: mergedCachedChats,
      refreshCache,
      upsertChatRecord,
      getCachedBootstrap,
      generateNewChatBootstrap,
      addOptimisticChat,
      removeOptimisticChat,
      updateChatTitle,
      setActiveChat,
      markGenerationStarted,
      markGenerationEnded,
      recordLocalChange,
      isSyncLeader,
      subscribeToMessageUpdates,
    }),
    [
      state.status,
      state.error,
      state.metadata,
      mergedCachedChats,
      refreshCache,
      getCachedBootstrap,
      generateNewChatBootstrap,
      upsertChatRecord,
      addOptimisticChat,
      removeOptimisticChat,
      updateChatTitle,
      setActiveChat,
      markGenerationStarted,
      markGenerationEnded,
      recordLocalChange,
      isSyncLeader,
      subscribeToMessageUpdates,
    ]
  );

  return (
    <EncryptedCacheContext.Provider value={value}>
      {children}
    </EncryptedCacheContext.Provider>
  );
}
