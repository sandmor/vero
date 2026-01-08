/**
 * Tab Leader Election Module
 *
 * Provides cross-tab coordination for cache sync operations using a lease-based
 * leader election system. This ensures only one tab performs sync operations
 * at a time, preventing conflicts and unnecessary network requests.
 *
 * Key concepts:
 * - Leader Lease: A time-limited lock that grants a tab exclusive sync rights
 * - Heartbeat: Regular lease renewals to maintain leadership
 * - Graceful handoff: When a leader tab closes, another tab can acquire the lease
 * - BroadcastChannel: For real-time cross-tab communication
 *
 * Design principles:
 * - Lease-based leadership prevents split-brain scenarios
 * - Heartbeats ensure stale leaders are detected
 * - Non-blocking for follower tabs (they can still read from cache)
 * - Graceful degradation if BroadcastChannel not available
 */

'use client';

const TAB_LEADER_CHANNEL = 'virid-tab-leader';
const LEASE_STORAGE_KEY = 'virid-cache-leader-lease';
const LEADER_LEASE_DURATION_MS = 10_000; // 10 seconds
const HEARTBEAT_INTERVAL_MS = 3_000; // 3 seconds
const ELECTION_DELAY_MS = 100; // Small delay to allow other tabs to respond

type LeaderState = 'leader' | 'follower' | 'electing' | 'disabled';

type LeaseRecord = {
  tabId: string;
  expiresAt: number;
  acquiredAt: number;
};

type BroadcastMessage =
  | { type: 'leader-heartbeat'; tabId: string; expiresAt: number }
  | { type: 'leader-resigning'; tabId: string }
  | { type: 'sync-complete'; tabId: string; timestamp: string }
  | { type: 'settings-updated'; tabId: string; timestamp: string }
  | { type: 'request-sync'; tabId: string; reason: string }
  | { type: 'election-started'; tabId: string }
  | {
      type: 'messages-updated';
      tabId: string;
      chatId: string;
      updatedAt: number;
    };

type TabLeaderOptions = {
  /** Callback when this tab becomes the leader */
  onBecomeLeader?: () => void;
  /** Callback when this tab loses leadership */
  onLoseLeadership?: () => void;
  /** Callback when another tab completes a sync */
  onSyncComplete?: (timestamp: string) => void;
  /** Callback when settings are updated in another tab */
  onSettingsUpdated?: (timestamp: string) => void;
  /** Callback when another tab requests a sync */
  onSyncRequested?: (reason: string) => void;
  /** Callback when messages are updated in another tab */
  onMessagesUpdated?: (chatId: string, updatedAt: number) => void;
  /** Enable debug logging */
  debug?: boolean;
};

const TAG = '[TabLeader]';

export class TabLeaderElection {
  private tabId: string;
  private state: LeaderState = 'follower';
  private channel: BroadcastChannel | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private leaseCheckInterval: ReturnType<typeof setInterval> | null = null;
  private options: TabLeaderOptions;
  private destroyed = false;

  constructor(options: TabLeaderOptions = {}) {
    this.tabId = crypto.randomUUID();
    this.options = options;

    // Initialize BroadcastChannel if available
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(TAB_LEADER_CHANNEL);
        this.channel.addEventListener('message', this.handleMessage);
      } catch (error) {
        this.log('BroadcastChannel not available:', error);
        // Fallback: single-tab mode, always leader
        this.state = 'disabled';
      }
    } else {
      this.state = 'disabled';
    }
  }

  private log(...args: unknown[]): void {
    if (!this.options.debug) return;
    // eslint-disable-next-line no-console
    console.info(TAG, `[${this.tabId.slice(0, 8)}]`, ...args);
  }

  /**
   * Start the leader election process.
   * Should be called when the cache system initializes.
   */
  async start(): Promise<void> {
    if (this.destroyed) return;

    // In disabled mode, act as if we're always the leader
    if (this.state === 'disabled') {
      this.log('BroadcastChannel disabled, acting as leader');
      this.becomeLeader();
      return;
    }

    // Check if there's an existing valid lease
    const existingLease = this.readLease();
    const now = Date.now();

    if (existingLease && existingLease.expiresAt > now) {
      // Another tab has a valid lease
      if (existingLease.tabId === this.tabId) {
        // We have the lease (e.g., page refresh)
        this.log('Reclaiming existing lease');
        this.becomeLeader();
      } else {
        this.log(
          'Another tab holds the lease:',
          existingLease.tabId.slice(0, 8)
        );
        this.state = 'follower';
        this.startLeaseCheck();
      }
    } else {
      // No valid lease, start election
      await this.startElection();
    }
  }

  /**
   * Attempt to acquire leadership.
   */
  private async startElection(): Promise<void> {
    if (this.destroyed || this.state === 'leader') return;

    this.state = 'electing';
    this.log('Starting election');

    // Broadcast election intent
    this.broadcast({ type: 'election-started', tabId: this.tabId });

    // Small delay to allow other tabs to respond with their lease status
    await new Promise((resolve) => setTimeout(resolve, ELECTION_DELAY_MS));

    if (this.destroyed) return;

    // Re-check lease after delay
    const currentLease = this.readLease();
    const now = Date.now();

    if (currentLease && currentLease.expiresAt > now) {
      // Someone else acquired the lease during our election delay
      this.log('Lost election to:', currentLease.tabId.slice(0, 8));
      this.state = 'follower';
      this.startLeaseCheck();
      return;
    }

    // Try to acquire the lease
    const acquired = this.tryAcquireLease();
    if (acquired) {
      this.becomeLeader();
    } else {
      this.state = 'follower';
      this.startLeaseCheck();
    }
  }

  /**
   * Attempt to acquire the lease using localStorage as a lock.
   */
  private tryAcquireLease(): boolean {
    const now = Date.now();
    const currentLease = this.readLease();

    // If there's a valid lease from another tab, we can't acquire
    if (
      currentLease &&
      currentLease.tabId !== this.tabId &&
      currentLease.expiresAt > now
    ) {
      return false;
    }

    // Write our lease
    const newLease: LeaseRecord = {
      tabId: this.tabId,
      expiresAt: now + LEADER_LEASE_DURATION_MS,
      acquiredAt: now,
    };

    this.writeLease(newLease);

    // Verify we got the lease (check for race conditions)
    const verifyLease = this.readLease();
    return verifyLease?.tabId === this.tabId;
  }

  /**
   * Transition to leader state.
   */
  private becomeLeader(): void {
    if (this.state === 'leader') return;

    this.log('Became leader');
    this.state = 'leader';

    // Start heartbeat to maintain lease
    this.startHeartbeat();

    // Stop checking for lease expiry
    this.stopLeaseCheck();

    // Notify listeners
    this.options.onBecomeLeader?.();
  }

  /**
   * Resign leadership and allow another tab to take over.
   */
  resign(): void {
    if (this.state !== 'leader') return;

    this.log('Resigning leadership');
    this.broadcast({ type: 'leader-resigning', tabId: this.tabId });

    // Clear the lease
    this.clearLease();

    this.state = 'follower';
    this.stopHeartbeat();
    this.startLeaseCheck();

    this.options.onLoseLeadership?.();
  }

  /**
   * Start the heartbeat interval to maintain leadership.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    const sendHeartbeat = () => {
      if (this.state !== 'leader' || this.destroyed) return;

      const now = Date.now();
      const newExpiry = now + LEADER_LEASE_DURATION_MS;

      // Renew the lease
      const lease: LeaseRecord = {
        tabId: this.tabId,
        expiresAt: newExpiry,
        acquiredAt: this.readLease()?.acquiredAt ?? now,
      };
      this.writeLease(lease);

      // Broadcast heartbeat to other tabs
      this.broadcast({
        type: 'leader-heartbeat',
        tabId: this.tabId,
        expiresAt: newExpiry,
      });
    };

    // Send initial heartbeat
    sendHeartbeat();

    // Schedule regular heartbeats
    this.heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Start checking for lease expiry (for follower tabs).
   */
  private startLeaseCheck(): void {
    if (this.leaseCheckInterval) return;

    this.leaseCheckInterval = setInterval(() => {
      if (this.state === 'leader' || this.destroyed) return;

      const lease = this.readLease();
      const now = Date.now();

      if (!lease || lease.expiresAt <= now) {
        // Lease expired, try to become leader
        this.log('Lease expired, attempting to acquire');
        void this.startElection();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopLeaseCheck(): void {
    if (this.leaseCheckInterval) {
      clearInterval(this.leaseCheckInterval);
      this.leaseCheckInterval = null;
    }
  }

  /**
   * Handle messages from other tabs.
   */
  private handleMessage = (event: MessageEvent<BroadcastMessage>): void => {
    if (this.destroyed) return;

    const message = event.data;
    this.log(
      'Received message:',
      message.type,
      'from:',
      message.tabId.slice(0, 8)
    );

    switch (message.type) {
      case 'leader-heartbeat':
        if (this.state === 'electing' || this.state === 'follower') {
          // Another tab is the leader
          this.state = 'follower';
        }
        break;

      case 'leader-resigning':
        if (message.tabId !== this.tabId) {
          // Leader resigned, try to become the new leader
          this.log('Leader resigned, starting election');
          void this.startElection();
        }
        break;

      case 'sync-complete':
        if (message.tabId !== this.tabId) {
          this.options.onSyncComplete?.(message.timestamp);
        }
        break;

      case 'settings-updated':
        if (message.tabId !== this.tabId) {
          this.options.onSettingsUpdated?.(message.timestamp);
        }
        break;

      case 'request-sync':
        if (message.tabId !== this.tabId && this.state === 'leader') {
          this.options.onSyncRequested?.(message.reason);
        }
        break;

      case 'election-started':
        // If we're already the leader, send a heartbeat to assert leadership
        if (this.state === 'leader') {
          this.broadcast({
            type: 'leader-heartbeat',
            tabId: this.tabId,
            expiresAt:
              this.readLease()?.expiresAt ??
              Date.now() + LEADER_LEASE_DURATION_MS,
          });
        }
        break;

      case 'messages-updated':
        if (message.tabId !== this.tabId) {
          this.options.onMessagesUpdated?.(message.chatId, message.updatedAt);
        }
        break;
    }
  };

  /**
   * Broadcast that a sync has completed.
   */
  notifySyncComplete(timestamp: string): void {
    this.broadcast({ type: 'sync-complete', tabId: this.tabId, timestamp });
  }

  /**
   * Broadcast that settings have been updated.
   */
  notifySettingsUpdated(timestamp: string): void {
    this.broadcast({ type: 'settings-updated', tabId: this.tabId, timestamp });
  }

  /**
   * Broadcast that messages have been updated for a specific chat.
   * This notifies other tabs to refresh their message state.
   */
  notifyMessagesUpdated(chatId: string): void {
    this.broadcast({
      type: 'messages-updated',
      tabId: this.tabId,
      chatId,
      updatedAt: Date.now(),
    });
  }

  /**
   * Request the leader tab to perform a sync.
   */
  requestSync(reason: string): void {
    if (this.state === 'leader') {
      // We're the leader, handle it locally
      this.options.onSyncRequested?.(reason);
    } else {
      // Request the leader to sync
      this.broadcast({ type: 'request-sync', tabId: this.tabId, reason });
    }
  }

  private broadcast(message: BroadcastMessage): void {
    if (this.channel && !this.destroyed) {
      try {
        this.channel.postMessage(message);
      } catch (error) {
        this.log('Failed to broadcast:', error);
      }
    }
  }

  private readLease(): LeaseRecord | null {
    try {
      const stored = localStorage.getItem(LEASE_STORAGE_KEY);
      if (!stored) return null;
      return JSON.parse(stored) as LeaseRecord;
    } catch {
      return null;
    }
  }

  private writeLease(lease: LeaseRecord): void {
    try {
      localStorage.setItem(LEASE_STORAGE_KEY, JSON.stringify(lease));
    } catch {
      // Storage quota exceeded or other error
    }
  }

  private clearLease(): void {
    try {
      const currentLease = this.readLease();
      // Only clear if we own the lease
      if (currentLease?.tabId === this.tabId) {
        localStorage.removeItem(LEASE_STORAGE_KEY);
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Check if this tab is the current leader.
   */
  isLeader(): boolean {
    return this.state === 'leader' || this.state === 'disabled';
  }

  /**
   * Get the current state.
   */
  getState(): LeaderState {
    return this.state;
  }

  /**
   * Get this tab's ID.
   */
  getTabId(): string {
    return this.tabId;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.log('Destroying');

    // Resign if we're the leader
    if (this.state === 'leader') {
      this.resign();
    }

    this.stopHeartbeat();
    this.stopLeaseCheck();

    if (this.channel) {
      this.channel.removeEventListener('message', this.handleMessage);
      this.channel.close();
      this.channel = null;
    }
  }
}

// Singleton instance for app-wide coordination
let globalTabLeader: TabLeaderElection | null = null;

export function getTabLeader(): TabLeaderElection | null {
  return globalTabLeader;
}

export function initializeTabLeader(
  options: TabLeaderOptions
): TabLeaderElection {
  if (globalTabLeader) {
    globalTabLeader.destroy();
  }
  globalTabLeader = new TabLeaderElection(options);
  return globalTabLeader;
}

export function destroyTabLeader(): void {
  if (globalTabLeader) {
    globalTabLeader.destroy();
    globalTabLeader = null;
  }
}
