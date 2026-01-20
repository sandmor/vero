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
 * - sync-models-dev.ts: Models.dev sync (replaces TokenLens)
 * - models-dev-types.ts: Models.dev API type definitions
 */

// Types
export type {
  CatalogEntry,
  ManagedModelCapabilities,
  ModelCapabilities,
  ModelFormat,
  ModelPricing,
  ModelProviderAssociation,
  ResolvedModelCapabilities,
} from './types';

// Constants
export { DEFAULT_TIER_IDS, FORMAT_PRIORITY } from './constants';

// Utilities
export {
  generateFriendlyModelName,
  mapModalityToFormat,
  sortFormats,
} from './utils';

// Database operations
export {
  countEnabledProviders,
  deleteModel,
  ensureDefaultProvider,
  ensureModelCapabilities,
  getAllModels,
  getByokAccessibleModelIds,
  getManagedModels,
  getModelCapabilities,
  getModelWithProviders,
  getTierIdsForModel,
  getTierModelIds,
  removeModelFromTiers,
  removeModelProvider,
  upsertModel,
  upsertModelProvider,
} from './db';

// Catalog operations
export {
  clearCatalogForProvider,
  createModelFromCatalog,
  deleteCatalogEntriesForProvider,
  getAllCatalogEntries,
  getProviderCatalog,
  linkModelToCatalog,
  upsertCatalogEntry,
} from './catalog';

// OpenRouter sync
export {
  fetchOpenRouterModels,
  parseOpenRouterCapabilities,
  syncOpenRouterCatalog,
} from './sync-openrouter';
export type {
  OpenRouterModel,
  OpenRouterModelsResponse,
} from './sync-openrouter';

// Models.dev sync (replacement for TokenLens)
export {
  clearModelsDevCache,
  fetchModelsDevCatalog,
  fetchModelsDevProvider,
  parseModelsDevModel,
  syncAllModelsDevProviders,
  syncModelsDevProvider,
} from './sync-models-dev';
export type {
  ModelsDevCatalog,
  ModelsDevModel,
  ModelsDevProvider,
} from './sync-models-dev';

// Re-export provider functions from registry for convenience
export {
  getInternalProviderId,
  getModelsDevProviderId,
  isModelsDevProvider,
  MODELS_DEV_PROVIDERS,
} from '../registry';

// Re-export buildModelId and parseModelId from model-id.ts for backwards compatibility
export { buildModelId, parseModelId } from '../model-id';

// ============================================================================
// Legacy Compatibility (deprecated)
// ============================================================================

import { upsertModel, upsertModelProvider } from './db';
import { syncModelsDevProvider } from './sync-models-dev';
import { syncOpenRouterCatalog } from './sync-openrouter';
import type { ModelFormat, ModelPricing } from './types';

/**
 * @deprecated Use syncOpenRouterCatalog instead - syncs only update catalog, not models
 */
export async function syncOpenRouterModels(_options?: {
  modelIds?: string[];
  allowCreate?: boolean;
}): Promise<{ synced: number; errors: string[] }> {
  return syncOpenRouterCatalog();
}

/**
 * @deprecated Use syncModelsDevProvider instead
 */
export const syncTokenLensCatalog = async (providerId: string) => {
  const result = await syncModelsDevProvider(providerId);
  return { synced: result.synced, errors: result.errors };
};

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
