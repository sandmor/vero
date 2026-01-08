'use client';

import {
  getEncryptedCacheManager,
  type CachedChatPayload,
} from '@/lib/cache/cache-manager';
import type { CachedChatRecord } from '@/lib/cache/types';
import type {
  IndexableChat,
  WorkerChatResult,
  WorkerMessageResult,
  WorkerPayload,
  WorkerResponse,
  WorkerSearchOptions,
} from '@/lib/search/search-index.types';
import {
  createSearchCoordinator,
  type SearchTabCoordinator,
} from '@/lib/search/search-coordinator';

const WORKER_TIMEOUT_MS = 20000;
const WORKER_URL = new URL('./search-worker.ts', import.meta.url);

function toIndexableChat(
  entry: CachedChatPayload<CachedChatRecord>
): IndexableChat {
  const bootstrapMessages = entry.data.bootstrap?.initialMessages ?? [];

  return {
    chatId: entry.chatId,
    title: entry.data.chat.title ?? 'Untitled',
    createdAt: String(entry.data.chat.createdAt),
    updatedAt: String(entry.data.chat.updatedAt ?? entry.data.lastUpdatedAt),
    lastUpdatedAt: String(entry.data.lastUpdatedAt),
    messages: bootstrapMessages.map((message: any) => ({
      id: String(message.id ?? message.messageId ?? crypto.randomUUID()),
      createdAt: String(message.createdAt ?? entry.data.lastUpdatedAt),
      parts: message.parts,
    })),
  };
}

function isLoadedResponse(
  response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'loaded' }> {
  return response.type === 'loaded';
}

function isInitializedResponse(
  response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'initialized' }> {
  return response.type === 'initialized';
}

function isSyncedResponse(
  response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'synced' }> {
  return response.type === 'synced';
}

function isSearchResponse(
  response: WorkerResponse
): response is Extract<WorkerResponse, { type: 'searchResults' }> {
  return response.type === 'searchResults';
}

class SearchIndexService {
  private workerPromise: Promise<Worker> | null = null;

  private pendingRequests = new Map<
    string,
    {
      resolve: (value: WorkerResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private snapshotLoaded = false;

  private loadPromise: Promise<void> | null = null;

  private syncPromise: Promise<{ changed: boolean }> | null = null;

  private manager = getEncryptedCacheManager();

  private ready = false;

  private indexing = false;

  private workerInitialized = false;

  private initPromise: Promise<void> | null = null;

  private coordinator: SearchTabCoordinator | null = null;

  // Callback for cross-tab notifications
  private onIndexReloadNeeded: (() => void) | null = null;

  isReady(): boolean {
    return this.ready;
  }

  isIndexing(): boolean {
    return this.indexing || Boolean(this.syncPromise);
  }

  /**
   * Set a callback to be called when another tab updates the index.
   * This can be used to trigger a re-sync or re-search.
   */
  setOnIndexReloadNeeded(callback: (() => void) | null): void {
    this.onIndexReloadNeeded = callback;
  }

  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = Promise.resolve(
        new Worker(WORKER_URL, { type: 'module', name: 'search-index-worker' })
      );
      const worker = await this.workerPromise;
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          const { requestId } = event.data as WorkerResponse & {
            requestId: string;
          };
          const pending = this.pendingRequests.get(requestId);
          if (!pending) return;

          const refreshTimeout = () => {
            clearTimeout(pending.timeout);
            pending.timeout = setTimeout(() => {
              this.pendingRequests.delete(requestId);
              pending.reject(new Error('Search worker request timed out'));
            }, WORKER_TIMEOUT_MS);
          };

          if (event.data.type === 'keepalive') {
            refreshTimeout();
            return;
          }

          clearTimeout(pending.timeout);
          this.pendingRequests.delete(requestId);

          if (event.data.type === 'error') {
            pending.reject(new Error(event.data.message));
            return;
          }

          pending.resolve(event.data);
        }
      );
    }

    return this.workerPromise;
  }

  private async callWorker(payload: WorkerPayload): Promise<WorkerResponse> {
    const worker = await this.getWorker();
    const requestId = crypto.randomUUID();

    const message = { ...payload, requestId } as const;

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Search worker request timed out'));
      }, WORKER_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      worker.postMessage(message);
    });
  }

  /**
   * Initialize the worker with the encryption key.
   * Must be called before load/sync/search operations.
   */
  async initializeWorker(encryptionKeyBase64: string): Promise<void> {
    if (this.workerInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const response = await this.callWorker({
        type: 'init',
        encryptionKey: encryptionKeyBase64,
      });

      if (!isInitializedResponse(response)) {
        throw new Error('Unexpected worker response while initializing');
      }

      // Setup cross-tab coordinator (main thread side)
      // Worker handles its own coordinator for the persistence layer
      this.coordinator = createSearchCoordinator({
        onIndexUpdated: () => {
          // Another tab updated the index, notify callback if registered
          if (this.onIndexReloadNeeded) {
            this.onIndexReloadNeeded();
          }
        },
        onIndexCleared: () => {
          // Index cleared by another tab, reset local state
          this.snapshotLoaded = false;
          this.ready = false;
        },
        debug: false,
      });

      this.workerInitialized = true;
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  private async ensureSnapshotLoaded(): Promise<void> {
    if (this.snapshotLoaded) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      if (!this.manager.isInitialized()) {
        this.snapshotLoaded = true;
        return;
      }

      try {
        // Worker now handles loading from its own IndexedDB storage
        const response = await this.callWorker({
          type: 'load',
        });

        if (!isLoadedResponse(response)) {
          throw new Error('Unexpected worker response while loading index');
        }

        // Log whether we loaded from storage (instant search) or started fresh
        if (
          response.fromStorage &&
          response.chatCount &&
          response.chatCount > 0
        ) {
          console.info(
            `[SearchService] Loaded ${response.chatCount} chats from persistent storage (instant search ready)`
          );
        } else {
          console.info(
            '[SearchService] Starting with fresh index, will sync from cache'
          );
        }

        this.snapshotLoaded = true;
        this.ready = true;
      } catch (error) {
        // If legacy or corrupt snapshot, reset and continue with empty index
        console.warn(
          'Search index snapshot invalid, resetting to empty',
          error
        );
        await this.callWorker({ type: 'load' });
        this.snapshotLoaded = true;
        this.ready = true;
      }
    })().finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  async syncChats(
    cachedChats: CachedChatPayload<CachedChatRecord>[]
  ): Promise<{ changed: boolean }> {
    await this.ensureSnapshotLoaded();
    const payload: IndexableChat[] = cachedChats.map(toIndexableChat);

    const runSync = async () => {
      this.indexing = true;
      const response = await this.callWorker({ type: 'sync', chats: payload });

      if (!isSyncedResponse(response)) {
        throw new Error('Search worker returned an unexpected sync response');
      }

      return { changed: response.changed };
    };

    // Deduplicate concurrent syncs
    if (!this.syncPromise) {
      this.syncPromise = runSync().finally(() => {
        this.indexing = false;
        this.syncPromise = null;
      });
    }

    return this.syncPromise;
  }

  async search(
    query: string,
    options: WorkerSearchOptions,
    cachedChats: CachedChatPayload<CachedChatRecord>[]
  ): Promise<{
    chatResults: WorkerChatResult[];
    messageResults: WorkerMessageResult[];
  }> {
    await this.ensureSnapshotLoaded();
    // Note: We intentionally don't wait for syncPromise here.
    // This allows searches to proceed immediately with the current index state,
    // providing a responsive UX. Results will update when sync completes
    // and the component re-renders with fresh cachedChats.
    const knownChatIds = cachedChats.map((chat) => chat.chatId);

    const response = await this.callWorker({
      type: 'search',
      query,
      options,
      knownChatIds,
    });

    if (!isSearchResponse(response)) {
      throw new Error('Search worker returned an unexpected search response');
    }

    // Persistence is now handled by the worker in the background

    return {
      chatResults: response.chatResults,
      messageResults: response.messageResults,
    };
  }
}

export const searchIndexService = new SearchIndexService();
