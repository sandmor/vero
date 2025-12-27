/**
 * Models.dev Sync Operations
 *
 * This module handles fetching model information from models.dev and syncing
 * it to the local catalog. Models.dev is used for all providers except OpenRouter,
 * which has its own dedicated API that takes priority.
 */

import type { CatalogEntry, ModelFormat, ModelPricing } from './types';
import { upsertCatalogEntry, deleteCatalogEntriesForProvider } from './catalog';
import {
    mapModalityToFormat,
    sortFormats,
    generateFriendlyModelName,
} from './utils';
import { deriveCreator } from '../creators';
import {
    MODELS_DEV_PROVIDERS,
    isModelsDevProvider,
    getModelsDevProviderId,
    getInternalProviderId,
} from '../registry';
import type {
    ModelsDevCatalog,
    ModelsDevProvider,
    ModelsDevModel,
    ModelsDevCost,
    ModelsDevModalities,
} from './models-dev-types';

// ============================================================================
// API Client
// ============================================================================

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

// Cache the catalog in memory with a TTL
let cachedCatalog: ModelsDevCatalog | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch the full models.dev catalog
 * Results are cached in memory for 1 hour
 */
export async function fetchModelsDevCatalog(
    forceRefresh = false
): Promise<ModelsDevCatalog> {
    const now = Date.now();

    // Return cached result if available and not expired
    if (!forceRefresh && cachedCatalog && now - cacheTimestamp < CACHE_TTL_MS) {
        return cachedCatalog;
    }

    const response = await fetch(MODELS_DEV_API_URL, {
        headers: {
            Accept: 'application/json',
        },
        // Use next.js caching on server side
        next: { revalidate: 3600 },
    });

    if (!response.ok) {
        throw new Error(
            `Models.dev API error: ${response.status} ${response.statusText}`
        );
    }

    const catalog: ModelsDevCatalog = await response.json();

    // Update cache
    cachedCatalog = catalog;
    cacheTimestamp = now;

    return catalog;
}

/**
 * Get a specific provider from the models.dev catalog
 */
export async function fetchModelsDevProvider(
    providerId: string,
    forceRefresh = false
): Promise<ModelsDevProvider | null> {
    const modelsDevId = getModelsDevProviderId(providerId);
    if (!modelsDevId) {
        return null;
    }

    const catalog = await fetchModelsDevCatalog(forceRefresh);
    return catalog[modelsDevId] ?? null;
}

/**
 * Clear the in-memory catalog cache
 */
export function clearModelsDevCache(): void {
    cachedCatalog = null;
    cacheTimestamp = 0;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

/**
 * Normalize models.dev cost to our pricing format
 * Models.dev already uses per-million token pricing
 */
function normalizeModelsDevPricing(cost?: ModelsDevCost): ModelPricing | null {
    if (!cost) return null;

    const pricing: ModelPricing = {};

    if (typeof cost.input === 'number' && Number.isFinite(cost.input)) {
        pricing.prompt = cost.input;
    }
    if (typeof cost.output === 'number' && Number.isFinite(cost.output)) {
        pricing.completion = cost.output;
    }
    if (typeof cost.reasoning === 'number' && Number.isFinite(cost.reasoning)) {
        pricing.reasoning = cost.reasoning;
    }
    if (typeof cost.cache_read === 'number' && Number.isFinite(cost.cache_read)) {
        pricing.cacheRead = cost.cache_read;
    }
    if (typeof cost.cache_write === 'number' && Number.isFinite(cost.cache_write)) {
        pricing.cacheWrite = cost.cache_write;
    }

    return Object.keys(pricing).length > 0 ? pricing : null;
}

/**
 * Derive model formats from models.dev modalities
 */
function deriveModelsDevFormats(
    modalities: ModelsDevModalities,
    hasAttachment?: boolean
): Set<ModelFormat> {
    const formats = new Set<ModelFormat>();

    // Add input modalities
    for (const modality of modalities.input) {
        const format = mapModalityToFormat(modality);
        if (format) formats.add(format);
    }

    // Add output modalities
    for (const modality of modalities.output) {
        const format = mapModalityToFormat(modality);
        if (format) formats.add(format);
    }

    // Attachment support means file handling
    if (hasAttachment) {
        formats.add('file');
    }

    // Ensure at least text format
    if (formats.size === 0) {
        formats.add('text');
    }

    return formats;
}

/**
 * Parse a models.dev model to our catalog entry format
 */
export function parseModelsDevModel(
    model: ModelsDevModel,
    providerId: string,
    modelKey: string
): Omit<CatalogEntry, 'id' | 'lastSynced'> {
    const internalProviderId = getInternalProviderId(providerId);
    const creator = deriveCreator(internalProviderId, modelKey);
    const modelName = generateFriendlyModelName(model.id);
    const suggestedModelId = `${creator}:${modelName}`;

    return {
        providerId: internalProviderId,
        providerModelId: model.id,
        suggestedModelId,
        suggestedName: model.name,
        suggestedCreator: creator,
        supportsTools: Boolean(model.tool_call),
        supportedFormats: sortFormats(
            deriveModelsDevFormats(model.modalities, model.attachment)
        ),
        pricing: normalizeModelsDevPricing(model.cost),
    };
}

// ============================================================================
// Sync Functions
// ============================================================================

export type SyncResult = {
    synced: number;
    removed: number;
    errors: string[];
};

/**
 * Sync a single provider from models.dev to the catalog
 */
export async function syncModelsDevProvider(
    providerId: string,
    options: { forceRefresh?: boolean; cleanupStale?: boolean } = {}
): Promise<SyncResult> {
    const { forceRefresh = false, cleanupStale = true } = options;
    const errors: string[] = [];
    let synced = 0;
    let removed = 0;

    if (!isModelsDevProvider(providerId)) {
        errors.push(`Provider '${providerId}' is not configured for models.dev sync`);
        return { synced, removed, errors };
    }

    try {
        const provider = await fetchModelsDevProvider(providerId, forceRefresh);

        if (!provider) {
            errors.push(`Provider '${providerId}' not found in models.dev`);
            return { synced, removed, errors };
        }

        const models = provider.models ?? {};
        const syncedModelIds = new Set<string>();

        for (const [modelKey, model] of Object.entries(models)) {
            try {
                const entry = parseModelsDevModel(model, providerId, modelKey);
                await upsertCatalogEntry(entry);
                syncedModelIds.add(model.id);
                synced++;
            } catch (error) {
                errors.push(
                    `${modelKey}: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }

        // Remove stale catalog entries for this provider
        if (cleanupStale && syncedModelIds.size > 0) {
            const internalProviderId = getInternalProviderId(providerId);
            removed = await deleteCatalogEntriesForProvider(
                internalProviderId,
                syncedModelIds
            );
        }
    } catch (error) {
        errors.push(
            `models.dev: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    return { synced, removed, errors };
}

/**
 * Sync all models.dev-enabled providers to the catalog
 */
export async function syncAllModelsDevProviders(
    options: { forceRefresh?: boolean; cleanupStale?: boolean } = {}
): Promise<{
    results: Record<string, SyncResult>;
    totalSynced: number;
    totalRemoved: number;
    totalErrors: number;
}> {
    const results: Record<string, SyncResult> = {};
    let totalSynced = 0;
    let totalRemoved = 0;
    let totalErrors = 0;

    // Fetch catalog once for all providers
    if (options.forceRefresh) {
        clearModelsDevCache();
    }

    for (const providerId of MODELS_DEV_PROVIDERS) {
        const result = await syncModelsDevProvider(providerId, {
            ...options,
            // Don't force refresh each time - we already cleared cache if needed
            forceRefresh: false,
        });

        results[providerId] = result;
        totalSynced += result.synced;
        totalRemoved += result.removed;
        totalErrors += result.errors.length;
    }

    return { results, totalSynced, totalRemoved, totalErrors };
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
    isModelsDevProvider,
    MODELS_DEV_PROVIDERS,
    getInternalProviderId,
    getModelsDevProviderId,
} from '../registry';

export type { ModelsDevCatalog, ModelsDevProvider, ModelsDevModel } from './models-dev-types';
