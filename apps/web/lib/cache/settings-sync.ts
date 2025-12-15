/**
 * Settings Sync Module
 *
 * Handles synchronization of user settings data that can change independently
 * of chat data. This includes:
 * - Available models (based on user tier and BYOK configuration)
 * - Agents configuration
 * - New chat defaults
 *
 * Unlike chat data which uses incremental sync, settings are lightweight
 * enough to fetch fresh on each sync and compare for changes.
 *
 * Design principles:
 * - Settings are fetched independently of chat sync
 * - Changes are detected and propagated to UI
 * - Works in conjunction with tab leader to avoid redundant fetches
 * - Caches settings in metadata to persist across sessions
 */

'use client';

import type { CacheMetadataPayload, NewChatDefaults } from '@/lib/cache/types';
import type { ChatModelOption } from '@/lib/ai/models';

const TAG = '[SettingsSync]';
const IS_DEV = process.env.NODE_ENV === 'development';

function settingsDebug(...args: unknown[]): void {
    if (!IS_DEV) return;
    try {
        // eslint-disable-next-line no-console
        console.info(TAG, ...args);
    } catch {
        // Swallow logging errors
    }
}

export type SettingsData = {
    allowedModels: ChatModelOption[];
    newChatDefaults: NewChatDefaults;
    timestamp: string;
};

export type SettingsChangeEvent = {
    previous: SettingsData | null;
    current: SettingsData;
    changes: SettingsChangeType[];
};

export type SettingsChangeType =
    | 'models-added'
    | 'models-removed'
    | 'models-updated'
    | 'defaults-changed';

type FetchSettingsResponse = {
    allowedModels: ChatModelOption[];
    newChatDefaults: NewChatDefaults;
    serverTimestamp: string;
};

/**
 * Fetch current settings from the server.
 * This is a lightweight endpoint that only returns settings data.
 */
export async function fetchSettings(
    signal?: AbortSignal
): Promise<FetchSettingsResponse> {
    const response = await fetch('/api/cache/settings', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal,
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.status}`);
    }

    return response.json();
}

/**
 * Compare two sets of allowed models to detect changes.
 */
export function compareModels(
    previous: ChatModelOption[],
    current: ChatModelOption[]
): SettingsChangeType[] {
    const changes: SettingsChangeType[] = [];

    const prevIds = new Set(previous.map((m) => m.id));
    const currIds = new Set(current.map((m) => m.id));

    // Check for additions
    const added = current.filter((m) => !prevIds.has(m.id));
    if (added.length > 0) {
        settingsDebug('Models added:', added.map((m) => m.id));
        changes.push('models-added');
    }

    // Check for removals
    const removed = previous.filter((m) => !currIds.has(m.id));
    if (removed.length > 0) {
        settingsDebug('Models removed:', removed.map((m) => m.id));
        changes.push('models-removed');
    }

    // Check for updates (same ID but different properties)
    const prevMap = new Map(previous.map((m) => [m.id, m]));
    for (const currModel of current) {
        const prevModel = prevMap.get(currModel.id);
        if (prevModel) {
            // Compare relevant properties
            if (
                prevModel.provider !== currModel.provider ||
                prevModel.model !== currModel.model ||
                prevModel.name !== currModel.name ||
                prevModel.isBYOK !== currModel.isBYOK
            ) {
                settingsDebug('Model updated:', currModel.id);
                if (!changes.includes('models-updated')) {
                    changes.push('models-updated');
                }
            }
        }
    }

    return changes;
}

/**
 * Compare new chat defaults to detect changes.
 */
export function compareDefaults(
    previous: NewChatDefaults,
    current: NewChatDefaults
): boolean {
    if (previous.defaultModelId !== current.defaultModelId) {
        settingsDebug('Default model changed:', previous.defaultModelId, '->', current.defaultModelId);
        return true;
    }

    const prevAllowed = new Set(previous.allowedModelIds);
    const currAllowed = new Set(current.allowedModelIds);

    if (prevAllowed.size !== currAllowed.size) {
        return true;
    }

    for (const id of currAllowed) {
        if (!prevAllowed.has(id)) {
            return true;
        }
    }

    return false;
}

/**
 * Extract settings data from cache metadata.
 */
export function extractSettingsFromMetadata(
    metadata: CacheMetadataPayload | null
): SettingsData | null {
    if (!metadata) return null;

    return {
        allowedModels: metadata.allowedModels ?? [],
        newChatDefaults: metadata.newChatDefaults ?? {
            defaultModelId: '',
            allowedModelIds: [],
        },
        timestamp: metadata.lastSyncedAt ?? metadata.generatedAt,
    };
}

/**
 * Apply settings to metadata, returning updated metadata if changes detected.
 */
export function applySettingsToMetadata(
    metadata: CacheMetadataPayload | null,
    settings: FetchSettingsResponse
): {
    updatedMetadata: CacheMetadataPayload;
    hasChanges: boolean;
    changes: SettingsChangeType[];
} {
    const previousSettings = extractSettingsFromMetadata(metadata);
    const changes: SettingsChangeType[] = [];

    if (previousSettings) {
        // Compare models
        const modelChanges = compareModels(
            previousSettings.allowedModels,
            settings.allowedModels
        );
        changes.push(...modelChanges);

        // Compare defaults
        if (compareDefaults(previousSettings.newChatDefaults, settings.newChatDefaults)) {
            changes.push('defaults-changed');
        }
    } else {
        // No previous settings, treat as new
        if (settings.allowedModels.length > 0) {
            changes.push('models-added');
        }
        changes.push('defaults-changed');
    }

    const hasChanges = changes.length > 0;

    settingsDebug('Settings comparison:', {
        hasChanges,
        changes,
        prevModelCount: previousSettings?.allowedModels.length ?? 0,
        currModelCount: settings.allowedModels.length,
    });

    // Create updated metadata
    const updatedMetadata: CacheMetadataPayload = {
        ...(metadata ?? {
            version: 1,
            generatedAt: settings.serverTimestamp,
            cacheCompletionMarker: {
                completeFromDate: null,
                completeToDate: null,
                hasOlderChats: false,
            },
        }),
        allowedModels: settings.allowedModels,
        newChatDefaults: settings.newChatDefaults,
        // Update timestamp only if there were changes
        ...(hasChanges ? { settingsSyncedAt: settings.serverTimestamp } : {}),
    };

    return {
        updatedMetadata,
        hasChanges,
        changes,
    };
}

/**
 * Determine if a settings refresh is needed based on time elapsed.
 */
export function shouldRefreshSettings(
    metadata: CacheMetadataPayload | null,
    minIntervalMs: number = 5 * 60 * 1000 // 5 minutes default
): boolean {
    if (!metadata) return true;

    // Check dedicated settings sync timestamp first
    const lastSettingsSync = (metadata as any).settingsSyncedAt as string | undefined;
    const lastSync = lastSettingsSync ?? metadata.lastSyncedAt;

    if (!lastSync) return true;

    const lastSyncTime = Date.parse(lastSync);
    if (Number.isNaN(lastSyncTime)) return true;

    const timeSinceSync = Date.now() - lastSyncTime;
    return timeSinceSync >= minIntervalMs;
}

/**
 * Settings sync manager that coordinates settings updates.
 */
export class SettingsSyncManager {
    private syncPromise: Promise<void> | null = null;
    private lastSyncAttempt: number = 0;
    private minRetryIntervalMs: number = 30_000; // 30 seconds minimum between retries

    /**
     * Perform a settings sync, updating metadata if changes are detected.
     * Returns the result of the sync attempt.
     */
    async sync(options: {
        currentMetadata: CacheMetadataPayload | null;
        signal?: AbortSignal;
        onMetadataUpdate?: (metadata: CacheMetadataPayload) => Promise<void>;
        onSettingsChanged?: (event: SettingsChangeEvent) => void;
    }): Promise<{
        success: boolean;
        hasChanges: boolean;
        changes: SettingsChangeType[];
        metadata: CacheMetadataPayload | null;
    }> {
        // Deduplicate concurrent syncs
        if (this.syncPromise) {
            settingsDebug('Settings sync already in progress, waiting...');
            await this.syncPromise;
            return {
                success: true,
                hasChanges: false,
                changes: [],
                metadata: options.currentMetadata,
            };
        }

        // Rate limit sync attempts
        const now = Date.now();
        if (now - this.lastSyncAttempt < this.minRetryIntervalMs) {
            settingsDebug('Settings sync rate limited');
            return {
                success: false,
                hasChanges: false,
                changes: [],
                metadata: options.currentMetadata,
            };
        }

        this.lastSyncAttempt = now;

        const runSync = async () => {
            try {
                settingsDebug('Starting settings sync');
                const settings = await fetchSettings(options.signal);

                const { updatedMetadata, hasChanges, changes } = applySettingsToMetadata(
                    options.currentMetadata,
                    settings
                );

                if (hasChanges && options.onMetadataUpdate) {
                    settingsDebug('Settings changed, updating metadata');
                    await options.onMetadataUpdate(updatedMetadata);
                }

                if (hasChanges && options.onSettingsChanged) {
                    options.onSettingsChanged({
                        previous: extractSettingsFromMetadata(options.currentMetadata),
                        current: {
                            allowedModels: settings.allowedModels,
                            newChatDefaults: settings.newChatDefaults,
                            timestamp: settings.serverTimestamp,
                        },
                        changes,
                    });
                }

                return {
                    success: true,
                    hasChanges,
                    changes,
                    metadata: updatedMetadata,
                };
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') {
                    settingsDebug('Settings sync aborted');
                } else {
                    console.warn('Failed to sync settings:', error);
                }
                return {
                    success: false,
                    hasChanges: false,
                    changes: [] as SettingsChangeType[],
                    metadata: options.currentMetadata,
                };
            }
        };

        this.syncPromise = runSync().then(() => { }).finally(() => {
            this.syncPromise = null;
        });

        // Run and return the result
        const result = await runSync();
        return result;
    }

    /**
     * Reset rate limiting state.
     */
    resetRateLimit(): void {
        this.lastSyncAttempt = 0;
    }
}

// Singleton instance
let settingsSyncManager: SettingsSyncManager | null = null;

export function getSettingsSyncManager(): SettingsSyncManager {
    if (!settingsSyncManager) {
        settingsSyncManager = new SettingsSyncManager();
    }
    return settingsSyncManager;
}
