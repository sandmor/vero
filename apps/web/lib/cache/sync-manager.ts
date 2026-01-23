/**
 * SyncManager - Coordinates all cache synchronization operations
 *
 * ## Design Principles
 *
 * - **Single point of coordination**: All sync operations flow through here
 * - **Active chat protection**: Prevents external syncs from overwriting
 *   in-flight changes during message generation
 * - **Debouncing and coalescing**: Multiple sync requests within a window
 *   are coalesced into a single operation
 * - **Sovereignty**: The active chat's local state is authoritative during generation
 * - **Tab coordination**: Only tabs with a valid leader lease perform syncs;
 *   followers delegate requests to the leader and reload from IndexedDB
 *
 * ## Sync Timestamp Architecture
 *
 * The `lastSyncedAt` timestamp is managed ONLY by the sync system:
 *
 * 1. **Who sets it**: Only `refreshCache()` in EncryptedCacheProvider updates
 *    `lastSyncedAt` after a successful sync from `/api/cache/sync`.
 *
 * 2. **Who reads it**: The sync endpoint uses it to return only changes since
 *    that timestamp (with a 5-second skew window for safety).
 *
 * 3. **Realtime does NOT modify it**: The realtime gateway only triggers syncs
 *    and React Query invalidations. It never directly modifies the cache or
 *    timestamp. This ensures incremental sync always catches all changes.
 *
 * ## Leadership & Coordination Model
 *
 * - A tab is allowed to execute syncs only if it **owns a valid lease**
 *   (localStorage-backed). This prevents split-brain leadership when
 *   BroadcastChannel is unreliable.
 * - Followers never execute syncs directly; they delegate requests to the
 *   current leader via BroadcastChannel and listen for completion events.
 * - When leadership is unclear, tabs trigger elections but do **not**
 *   self-promote without a lease.
 *
 * ## Race Condition Prevention
 *
 * - **Echo filtering**: Own changes are tracked for 5 seconds to ignore
 *   realtime notifications that echo back our own changes.
 * - **Generation protection**: Active chats being edited are excluded from
 *   sync updates during generation and for 2 seconds after.
 * - **Debouncing**: Multiple rapid events are coalesced into single sync.
 * - **Sync serialization**: Only one sync runs at a time; new requests queue.
 *
 * @see useRealtimeConnection for realtime integration
 * @see EncryptedCacheProvider for cache and timestamp management
 */

import {
  TabLeaderElection,
  destroyTabLeader,
  initializeTabLeader,
} from './tab-leader';

type SyncCallback = (options: {
  force: boolean;
  excludeChatIds?: Set<string>;
  source: SyncRequest['source'];
}) => Promise<void>;

type SyncRequest = {
  source:
    | 'realtime'
    | 'periodic'
    | 'manual'
    | 'cache-miss'
    | 'settings-change' // Legacy: kept for backwards compatibility, treated as regular sync
    | 'tab-request';
  chatId?: string;
  force?: boolean;
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

/**
 * Options for initializing the SyncManager.
 *
 * Design Note: Settings sync is consolidated with regular sync.
 * The /api/cache/sync endpoint returns settings data (allowedModels, newChatDefaults)
 * in the metadata field, so there's no need for separate settings-only syncs.
 */
type SyncManagerOptions = {
  /** Callback to execute the actual sync operation */
  onSync: SyncCallback;
  /** Callback when cache should be reloaded from storage (for follower tabs) */
  onCacheReload?: () => Promise<void>;
  /** Callback when messages are updated in another tab */
  onMessagesUpdated?: (chatId: string, updatedAt: number) => void;
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
  private onCacheReload?: () => Promise<void>;
  private onMessagesUpdated?: (chatId: string, updatedAt: number) => void;
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

  // Tab leader coordination
  private tabLeader: TabLeaderElection | null = null;
  private electionPromise: Promise<void> | null = null;

  constructor(options: SyncManagerOptions) {
    this.onSync = options.onSync;
    this.onCacheReload = options.onCacheReload;
    this.onMessagesUpdated = options.onMessagesUpdated;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.postGenerationProtectionMs =
      options.postGenerationProtectionMs ??
      DEFAULT_POST_GENERATION_PROTECTION_MS;
    this.debug = options.debug ?? false;

    // Initialize tab leader election
    this.initializeTabLeader();
  }

  private log(...args: unknown[]): void {
    if (!this.debug) return;
    // eslint-disable-next-line no-console
    console.info(SYNC_MANAGER_TAG, ...args);
  }

  /**
   * Initialize tab leader election and register callbacks.
   *
   * IMPORTANT: The election promise resolves AFTER leadership is established.
   * This allows other code to wait via waitForElection() before starting periodic
   * operations, preventing burst API calls during the ~100ms election window.
   *
   * When a tab becomes leader, it immediately requests a manual sync to ensure
   * it has the latest data. This sync is debounced with any other pending syncs.
   */
  private initializeTabLeader(): void {
    this.tabLeader = initializeTabLeader({
      onBecomeLeader: () => {
        this.log('This tab became the sync leader');
        // Trigger an immediate sync when becoming leader to ensure freshness
        this.requestSync('manual');
      },
      onLoseLeadership: () => {
        this.log('This tab lost sync leadership');
        // Cancel any pending sync operations
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        this.pendingRequests = [];
      },
      onSyncComplete: (timestamp) => {
        this.log('Another tab completed sync at:', timestamp);
        // Reload cache from storage to pick up changes
        this.onCacheReload?.();
      },
      onSettingsUpdated: (timestamp) => {
        this.log('Settings updated by another tab at:', timestamp);
        // Reload cache to pick up settings changes
        this.onCacheReload?.();
      },
      onSyncRequested: (reason, options) => {
        this.log('Sync requested by another tab:', reason);
        // Handle the sync request
        this.requestSync('tab-request', options?.chatId, {
          force: options?.force,
        });
      },
      onMessagesUpdated: (chatId, updatedAt) => {
        this.log('Messages updated by another tab for chat:', chatId);
        // Forward to the registered callback
        this.onMessagesUpdated?.(chatId, updatedAt);
      },
      onFollowerJoined: () => {
        this.log(
          'New follower tab joined, triggering sync to share latest data'
        );
        // When a new tab joins as a follower, sync so it gets fresh data
        // This ensures new clients see changes made by other clients
        this.requestSync('tab-request');
      },
      debug: this.debug,
    });

    // Start the leader election and store the promise
    this.electionPromise = this.tabLeader.start();
  }

  /**
   * Check if this tab is allowed to execute syncs.
   *
   * IMPORTANT: We only allow syncs if we are the leader AND have a valid
   * lease, or if coordination is disabled (single-tab fallback). This avoids
   * split-brain behavior during BroadcastChannel outages.
   */
  isLeader(): boolean {
    if (!this.tabLeader) {
      return false;
    }

    const state = this.tabLeader.getState();
    if (state === 'disabled') return true;

    return state === 'leader' && this.tabLeader.hasValidLease();
  }

  /**
   * Wait for the initial tab leader election to complete.
   *
   * CRITICAL: Always call this before starting periodic sync intervals!
   * This prevents multiple tabs from making API calls during the election window,
   * which would cause a burst of requests before the leader is determined.
   *
   * After this resolves, the tab is either a leader or follower, and the
   * requestSync() method will correctly delegate to the leader tab if needed.
   */
  async waitForElection(): Promise<void> {
    if (this.electionPromise) {
      await this.electionPromise;
    }
  }

  /**
   * Notify other tabs that a sync has completed.
   */
  notifySyncComplete(timestamp: string): void {
    this.tabLeader?.notifySyncComplete(timestamp);
  }

  /**
   * Notify other tabs that settings have been updated.
   */
  notifySettingsUpdated(timestamp: string): void {
    this.tabLeader?.notifySettingsUpdated(timestamp);
  }

  /**
   * Notify other tabs that messages have been updated for a specific chat.
   * This is used for real-time cross-tab message sync.
   */
  notifyMessagesUpdated(chatId: string): void {
    this.tabLeader?.notifyMessagesUpdated(chatId);
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
   * Only the leader tab will execute the sync.
   *
   * Design Notes:
   * - Settings data is included in every sync via the metadata field,
   *   so there's no need for separate settings-only syncs.
   * - Realtime events trigger syncs with echo filtering to avoid
   *   syncing changes that originated from this tab.
   * - Non-leader tabs delegate sync requests to the leader via BroadcastChannel.
   * - Active chats are protected from external updates during generation.
   *
   * @param source - What triggered the sync request
   * @param chatId - Optional chat ID that triggered the sync (for realtime)
   */
  requestSync(
    source: SyncRequest['source'],
    chatId?: string,
    options?: { force?: boolean }
  ): void {
    this.log('Sync requested:', { source, chatId });

    // Filter out realtime echoes for own changes
    if (source === 'realtime' && chatId && this.isRealtimeEcho(chatId)) {
      return;
    }

    // If not the leader, request the leader to sync
    if (!this.isLeader()) {
      this.log('Not leader, delegating sync request to leader tab');
      this.tabLeader?.requestSync(source, {
        force: options?.force,
        chatId,
      });
      return;
    }

    this.pendingRequests.push({
      source,
      chatId,
      force: options?.force,
      timestamp: Date.now(),
    });

    this.scheduleSync();
  }

  /**
   * Request a full, forced resync (used for cache recovery scenarios).
   * Non-leader tabs will delegate to the current leader.
   */
  requestFullResync(chatId?: string): void {
    this.requestSync('manual', chatId, { force: true });
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

    // Double-check leadership before executing
    if (!this.isLeader()) {
      this.log('Lost leadership, skipping sync execution');
      this.pendingRequests = [];
      return;
    }

    // Collect and clear pending requests
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    const requestedForce = force || requests.some((request) => request.force);

    if (requests.length === 0 && !force) {
      this.log('No pending requests, skipping sync');
      return;
    }

    const sources = requests.map((r) => r.source);
    const primarySource = sources.includes('realtime')
      ? 'realtime'
      : sources.includes('periodic')
        ? 'periodic'
        : (sources[0] ?? 'manual');

    this.log('Executing sync:', {
      requestCount: requests.length,
      force: requestedForce,
      primarySource,
    });

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
    const syncStartTime = new Date().toISOString();

    // Monitoring: Log sync execution in dev environment
    if (this.debug) {
      const tabRole = this.isLeader() ? 'LEADER' : 'FOLLOWER';
      const excludedCount = excludeChatIds.size;
      // eslint-disable-next-line no-console
      console.info(
        `[SYNC-MONITOR] Incremental sync triggered by ${tabRole} tab`,
        { requestCount: requests.length, excludedChats: excludedCount, force }
      );
    }

    this.syncPromise = this.onSync({
      force: requestedForce,
      excludeChatIds: excludeChatIds.size > 0 ? excludeChatIds : undefined,
      source: primarySource,
    })
      .then(() => {
        // Notify other tabs about the completed sync
        this.notifySyncComplete(syncStartTime);
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

    // Clean up tab leader
    if (this.tabLeader) {
      this.tabLeader.destroy();
      this.tabLeader = null;
    }
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
  // Also destroy the tab leader
  destroyTabLeader();
}
