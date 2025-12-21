/**
 * Model Capabilities Module
 *
 * This module provides functionality for managing model capabilities,
 * provider associations, and syncing with external provider catalogs.
 *
 * Module structure:
 * - types.ts: Type definitions
 * - constants.ts: Configuration constants
 * - utils.ts: Utility functions
 * - db.ts: Database operations for Model/ModelProvider
 * - catalog.ts: Provider catalog operations
 * - sync-openrouter.ts: OpenRouter sync
 * - sync-tokenlens.ts: TokenLens sync
 */

// Types
export type {
    ModelFormat,
    ModelPricing,
    ModelProviderAssociation,
    ModelCapabilities,
    ResolvedModelCapabilities,
    ManagedModelCapabilities,
    CatalogEntry,
} from './types';

// Constants
export { DEFAULT_TIER_IDS, FORMAT_PRIORITY, PROVIDER_DEFAULTS } from './constants';

// Utilities
export {
    generateFriendlyModelName,
    mapModalityToFormat,
    sortFormats,
} from './utils';

// Database operations
export {
    getModelWithProviders,
    getModelCapabilities,
    upsertModel,
    deleteModel,
    getAllModels,
    upsertModelProvider,
    removeModelProvider,
    getTierModelIds,
    getManagedModels,
    ensureModelCapabilities,
    getByokAccessibleModelIds,
} from './db';

// Catalog operations
export {
    getProviderCatalog,
    getAllCatalogEntries,
    upsertCatalogEntry,
    createModelFromCatalog,
    linkModelToCatalog,
} from './catalog';

// OpenRouter sync
export {
    fetchOpenRouterModels,
    parseOpenRouterCapabilities,
    syncOpenRouterCatalog,
} from './sync-openrouter';
export type { OpenRouterModel, OpenRouterModelsResponse } from './sync-openrouter';

// TokenLens sync
export { syncTokenLensCatalog } from './sync-tokenlens';

// Re-export buildModelId and parseModelId from model-id.ts for backwards compatibility
export { buildModelId, parseModelId } from '../model-id';

// ============================================================================
// Legacy Compatibility (deprecated)
// ============================================================================

import { syncOpenRouterCatalog } from './sync-openrouter';
import { syncTokenLensCatalog } from './sync-tokenlens';
import { upsertModel, upsertModelProvider } from './db';
import type { ModelFormat, ModelPricing } from './types';

/**
 * @deprecated Use syncOpenRouterCatalog instead - syncs only update catalog, not models
 */
export async function syncOpenRouterModels(
    _options?: { modelIds?: string[]; allowCreate?: boolean }
): Promise<{ synced: number; errors: string[] }> {
    return syncOpenRouterCatalog();
}

/**
 * @deprecated Use syncTokenLensCatalog instead - syncs only update catalog, not models
 */
export async function syncTokenLensModels(
    options: { provider?: string; modelIds?: string[]; allowCreate?: boolean } = {}
): Promise<{ synced: number; errors: string[] }> {
    const providerId = options.provider ?? 'openai';
    return syncTokenLensCatalog(providerId);
}

/**
 * @deprecated Use upsertModel + upsertModelProvider instead
 */
export async function upsertModelCapabilities(capabilities: {
    id: string;
    name: string;
    provider: string;
    providerModelId: string;
    creator: string;
    supportsTools: boolean;
    supportedFormats: ModelFormat[];
    pricing?: ModelPricing | null;
}): Promise<void> {
    await upsertModel({
        id: capabilities.id,
        name: capabilities.name,
        creator: capabilities.creator,
        supportsTools: capabilities.supportsTools,
        supportedFormats: capabilities.supportedFormats,
    });

    await upsertModelProvider(capabilities.id, {
        providerId: capabilities.provider,
        providerModelId: capabilities.providerModelId,
        pricing: capabilities.pricing,
        isDefault: true,
        enabled: true,
    });
}
