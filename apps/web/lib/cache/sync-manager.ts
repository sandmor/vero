/**
 * SyncManager - Coordinates all cache synchronization operations
 *
 * Design principles:
 * - Single point of coordination for all sync operations
 * - Active chat protection: prevents external syncs from overwriting
 *   in-flight changes during message generation
 * - Debouncing and coalescing: multiple sync requests within a window
 *   are coalesced into a single operation
 * - Sovereignty: the active chat's local state is authoritative during generation
 */

type SyncCallback = (options: {
  force: boolean;
  excludeChatIds?: Set<string>;
}) => Promise<void>;

type SyncRequest = {
  source: 'realtime' | 'periodic' | 'manual' | 'cache-miss';
  chatId?: string;
  timestamp: number;
};

interface ActiveChatState {
  chatId: string;
  isGenerating: boolean;
  /** Timestamp when generation started - used to determine sovereignty window */
  generationStartedAt: number | null;
  /** Timestamp of last local update - used to defer syncs */
  lastLocalUpdateAt: number;
}

type SyncManagerOptions = {
  /** Callback to execute the actual sync operation */
  onSync: SyncCallback;
  /** Debounce window in ms for coalescing sync requests */
  debounceMs?: number;
  /** How long after generation ends to protect the active chat (ms) */
  postGenerationProtectionMs?: number;
  /** Enable debug logging */
  debug?: boolean;
};

const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_POST_GENERATION_PROTECTION_MS = 2000;
const SYNC_MANAGER_TAG = '[SyncManager]';

export class SyncManager {
  private onSync: SyncCallback;
  private debounceMs: number;
  private postGenerationProtectionMs: number;
  private debug: boolean;

  // Sync state
  private pendingRequests: SyncRequest[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private syncPromise: Promise<void> | null = null;

  // Active chat tracking
  private activeChat: ActiveChatState | null = null;

  // Track recent own changes to filter out realtime echoes
  private recentOwnChanges = new Map<string, number>();
  private readonly ownChangeWindowMs = 5000; // 5 second window to ignore echoes

  constructor(options: SyncManagerOptions) {
    this.onSync = options.onSync;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.postGenerationProtectionMs =
      options.postGenerationProtectionMs ??
      DEFAULT_POST_GENERATION_PROTECTION_MS;
    this.debug = options.debug ?? false;
  }

  private log(...args: unknown[]): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.info(SYNC_MANAGER_TAG, ...args);
  }

  /**
   * Set the active chat being viewed/edited by the user.
   * This chat receives special protection during syncs.
   */
  setActiveChat(chatId: string | null): void {
    if (chatId === null) {
      this.log('Clearing active chat');
      this.activeChat = null;
      return;
    }

    if (this.activeChat?.chatId === chatId) {
      return;
    }

    this.log('Setting active chat:', chatId);
    this.activeChat = {
      chatId,
      isGenerating: false,
      generationStartedAt: null,
      lastLocalUpdateAt: Date.now(),
    };
  }

  /**
   * Mark that the active chat has started generating a response.
   * During generation, the active chat is protected from external sync updates.
   */
  markGenerationStarted(): void {
    if (!this.activeChat) {
      this.log('Warning: markGenerationStarted called with no active chat');
      return;
    }

    this.log('Generation started for chat:', this.activeChat.chatId);
    this.activeChat.isGenerating = true;
    this.activeChat.generationStartedAt = Date.now();
  }

  /**
   * Mark that the active chat has finished generating.
   * A protection window remains to prevent race conditions with server-side saves.
   */
  markGenerationEnded(): void {
    if (!this.activeChat) {
      this.log('Warning: markGenerationEnded called with no active chat');
      return;
    }

    this.log('Generation ended for chat:', this.activeChat.chatId);
    this.activeChat.isGenerating = false;
    // Keep generationStartedAt to calculate protection window
  }

  /**
   * Record that the user made a local change to the active chat.
   * This updates the protection timestamp and marks it as a recent own change.
   */
  recordLocalChange(chatId: string): void {
    const now = Date.now();

    // Track in recent own changes to filter realtime echoes
    this.recentOwnChanges.set(chatId, now);

    // Clean up old entries
    this.cleanupOwnChanges();

    if (this.activeChat?.chatId === chatId) {
      this.activeChat.lastLocalUpdateAt = now;
      this.log('Recorded local change for active chat:', chatId);
    }
  }

  private cleanupOwnChanges(): void {
    const cutoff = Date.now() - this.ownChangeWindowMs;
    for (const [chatId, timestamp] of this.recentOwnChanges) {
      if (timestamp < cutoff) {
        this.recentOwnChanges.delete(chatId);
      }
    }
  }

  /**
   * Check if a chat is currently protected from external sync updates.
   */
  private isChatProtected(chatId: string): boolean {
    if (!this.activeChat || this.activeChat.chatId !== chatId) {
      return false;
    }

    const now = Date.now();

    // Protected during active generation
    if (this.activeChat.isGenerating) {
      return true;
    }

    // Protected during post-generation window
    if (this.activeChat.generationStartedAt !== null) {
      const timeSinceGeneration = now - this.activeChat.generationStartedAt;
      if (timeSinceGeneration < this.postGenerationProtectionMs) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a realtime notification should be ignored as an echo of own change.
   */
  private isRealtimeEcho(chatId: string): boolean {
    const ownChangeTime = this.recentOwnChanges.get(chatId);
    if (!ownChangeTime) {
      return false;
    }

    const timeSinceOwnChange = Date.now() - ownChangeTime;
    const isEcho = timeSinceOwnChange < this.ownChangeWindowMs;

    if (isEcho) {
      this.log('Ignoring realtime echo for chat:', chatId);
    }

    return isEcho;
  }

  /**
   * Request a cache sync. Requests are debounced and coalesced.
   *
   * @param source - What triggered the sync request
   * @param chatId - Optional chat ID that triggered the sync (for realtime)
   */
  requestSync(source: SyncRequest['source'], chatId?: string): void {
    this.log('Sync requested:', { source, chatId });

    // Filter out realtime echoes for own changes
    if (source === 'realtime' && chatId && this.isRealtimeEcho(chatId)) {
      return;
    }

    this.pendingRequests.push({
      source,
      chatId,
      timestamp: Date.now(),
    });

    this.scheduleSync();
  }

  /**
   * Force an immediate sync, bypassing debounce.
   * Still respects active chat protection.
   */
  async forceSync(): Promise<void> {
    this.log('Force sync requested');

    // Cancel pending debounced sync
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Wait for any in-flight sync to complete
    if (this.syncPromise) {
      await this.syncPromise;
    }

    // Execute immediately
    await this.executeSync(true);
  }

  /**
   * Wait for any pending or in-flight sync to complete.
   */
  async waitForSync(): Promise<void> {
    if (this.syncPromise) {
      await this.syncPromise;
    }
  }

  private scheduleSync(): void {
    // If already scheduled, let the existing timer handle it
    if (this.debounceTimer) {
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.executeSync(false);
    }, this.debounceMs);
  }

  private async executeSync(force: boolean): Promise<void> {
    // If already syncing, the pending requests will be picked up after
    if (this.isSyncing) {
      this.log('Sync already in progress, deferring');
      return;
    }

    // Collect and clear pending requests
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    if (requests.length === 0 && !force) {
      this.log('No pending requests, skipping sync');
      return;
    }

    this.log('Executing sync:', { requestCount: requests.length, force });

    // Determine which chats to exclude from sync (protected chats)
    const excludeChatIds = new Set<string>();

    // Check if any requests are for the protected active chat
    for (const request of requests) {
      if (request.chatId && this.isChatProtected(request.chatId)) {
        excludeChatIds.add(request.chatId);
        this.log('Excluding protected chat from sync:', request.chatId);
      }
    }

    // If active chat is protected, always exclude it
    if (this.activeChat && this.isChatProtected(this.activeChat.chatId)) {
      excludeChatIds.add(this.activeChat.chatId);
    }

    this.isSyncing = true;
    this.syncPromise = this.onSync({
      force,
      excludeChatIds: excludeChatIds.size > 0 ? excludeChatIds : undefined,
    })
      .catch((error) => {
        this.log('Sync failed:', error);
        // Re-queue failed requests for retry
        this.pendingRequests.push(...requests);
      })
      .finally(() => {
        this.isSyncing = false;
        this.syncPromise = null;

        // If more requests came in during sync, schedule another
        if (this.pendingRequests.length > 0) {
          this.scheduleSync();
        }
      });

    await this.syncPromise;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingRequests = [];
    this.recentOwnChanges.clear();
    this.activeChat = null;
  }
}

// Singleton instance for app-wide coordination
let globalSyncManager: SyncManager | null = null;

export function getSyncManager(): SyncManager | null {
  return globalSyncManager;
}

export function initializeSyncManager(
  options: SyncManagerOptions
): SyncManager {
  if (globalSyncManager) {
    globalSyncManager.destroy();
  }
  globalSyncManager = new SyncManager(options);
  return globalSyncManager;
}

export function destroySyncManager(): void {
  if (globalSyncManager) {
    globalSyncManager.destroy();
    globalSyncManager = null;
  }
}
