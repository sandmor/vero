/**
 * Search Tab Coordination
 *
 * Handles cross-tab communication for the search index using BroadcastChannel.
 * This ensures that when one tab updates the search index, other tabs can
 * reload from IndexedDB to stay in sync.
 *
 * The coordination follows a simple model:
 * - Any tab can read from the shared IndexedDB
 * - When a tab updates the index, it broadcasts 'index-updated'
 * - Other tabs receive the broadcast and reload their in-memory index
 *
 * This is simpler than the cache's leader election because:
 * - Search index writes are idempotent (same chats → same index)
 * - No network requests involved, just local IndexedDB
 * - Race conditions result in eventual consistency, not data loss
 */

const SEARCH_CHANNEL = 'virid-search-sync';

type SearchBroadcastMessage =
    | { type: 'index-updated'; tabId: string; timestamp: number; chatCount: number }
    | { type: 'request-reload'; tabId: string }
    | { type: 'index-cleared'; tabId: string };

export type SearchCoordinatorOptions = {
    /** Called when another tab updates the index */
    onIndexUpdated?: (timestamp: number, chatCount: number) => void;
    /** Called when another tab requests all tabs to reload */
    onReloadRequested?: () => void;
    /** Called when another tab clears the index */
    onIndexCleared?: () => void;
    /** Enable debug logging */
    debug?: boolean;
};

const TAG = '[SearchCoordinator]';

export class SearchTabCoordinator {
    private tabId: string;
    private channel: BroadcastChannel | null = null;
    private options: SearchCoordinatorOptions;
    private destroyed = false;

    constructor(options: SearchCoordinatorOptions = {}) {
        this.tabId = crypto.randomUUID();
        this.options = options;

        // Initialize BroadcastChannel if available
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel(SEARCH_CHANNEL);
                this.channel.addEventListener('message', this.handleMessage);
            } catch (error) {
                this.log('BroadcastChannel not available:', error);
            }
        }
    }

    private log(...args: unknown[]): void {
        if (!this.options.debug) return;
        // eslint-disable-next-line no-console
        console.info(TAG, `[${this.tabId.slice(0, 8)}]`, ...args);
    }

    private handleMessage = (event: MessageEvent<SearchBroadcastMessage>): void => {
        if (this.destroyed) return;

        const message = event.data;

        // Ignore our own messages
        if (message.tabId === this.tabId) return;

        this.log('Received:', message.type, 'from:', message.tabId.slice(0, 8));

        switch (message.type) {
            case 'index-updated':
                this.options.onIndexUpdated?.(message.timestamp, message.chatCount);
                break;

            case 'request-reload':
                this.options.onReloadRequested?.();
                break;

            case 'index-cleared':
                this.options.onIndexCleared?.();
                break;
        }
    };

    /**
     * Notify other tabs that the index has been updated
     */
    notifyIndexUpdated(chatCount: number): void {
        this.broadcast({
            type: 'index-updated',
            tabId: this.tabId,
            timestamp: Date.now(),
            chatCount,
        });
    }

    /**
     * Request all tabs to reload their index from storage
     */
    requestReload(): void {
        this.broadcast({
            type: 'request-reload',
            tabId: this.tabId,
        });
    }

    /**
     * Notify other tabs that the index has been cleared
     */
    notifyIndexCleared(): void {
        this.broadcast({
            type: 'index-cleared',
            tabId: this.tabId,
        });
    }

    private broadcast(message: SearchBroadcastMessage): void {
        if (this.channel && !this.destroyed) {
            try {
                this.channel.postMessage(message);
            } catch (error) {
                this.log('Failed to broadcast:', error);
            }
        }
    }

    /**
     * Get this tab's ID
     */
    getTabId(): string {
        return this.tabId;
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        this.log('Destroying');

        if (this.channel) {
            this.channel.removeEventListener('message', this.handleMessage);
            this.channel.close();
            this.channel = null;
        }
    }
}

// Factory function for use in worker
export function createSearchCoordinator(
    options: SearchCoordinatorOptions
): SearchTabCoordinator {
    return new SearchTabCoordinator(options);
}
