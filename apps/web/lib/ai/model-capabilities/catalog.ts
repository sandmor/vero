/**
 * Provider Catalog Operations (Sync Cache)
 */

import { prisma } from '@virid/db';
import { Prisma } from '@virid/db';
import type { CatalogEntry, ModelFormat, ModelPricing } from './types';
import { upsertModel, upsertModelProvider } from './db';
import { parseModelId } from '../model-id';

// ============================================================================
// Catalog Cleanup Operations
// ============================================================================

/**
 * Delete catalog entries for a provider that are NOT in the given set of model IDs.
 * This is used to clean up stale entries after a sync.
 *
 * @param providerId - The provider ID to clean up
 * @param keepModelIds - Set of providerModelIds to keep (all others will be deleted)
 * @returns The number of entries deleted
 */
export async function deleteCatalogEntriesForProvider(
  providerId: string,
  keepModelIds: Set<string>
): Promise<number> {
  if (keepModelIds.size === 0) {
    return 0;
  }

  const result = await prisma.providerCatalog.deleteMany({
    where: {
      providerId,
      providerModelId: {
        notIn: Array.from(keepModelIds),
      },
    },
  });

  return result.count;
}

/**
 * Delete all catalog entries for a provider
 *
 * @param providerId - The provider ID to clear
 * @returns The number of entries deleted
 */
export async function clearCatalogForProvider(
  providerId: string
): Promise<number> {
  const result = await prisma.providerCatalog.deleteMany({
    where: { providerId },
  });

  return result.count;
}

/**
 * Get all catalog entries for a provider
 */
export async function getProviderCatalog(
  providerId: string
): Promise<CatalogEntry[]> {
  const entries = await prisma.providerCatalog.findMany({
    where: { providerId },
    orderBy: { suggestedModelId: 'asc' },
  });

  return entries.map((e) => ({
    id: e.id,
    providerId: e.providerId,
    providerModelId: e.providerModelId,
    suggestedModelId: e.suggestedModelId,
    suggestedName: e.suggestedName,
    suggestedCreator: e.suggestedCreator,
    supportsTools: e.supportsTools,
    supportedFormats: e.supportedFormats as ModelFormat[],
    pricing: e.pricing as ModelPricing | null,
    lastSynced: e.lastSynced,
  }));
}

/**
 * Get all catalog entries
 */
export async function getAllCatalogEntries(): Promise<CatalogEntry[]> {
  const entries = await prisma.providerCatalog.findMany({
    orderBy: [{ providerId: 'asc' }, { suggestedModelId: 'asc' }],
  });

  return entries.map((e) => ({
    id: e.id,
    providerId: e.providerId,
    providerModelId: e.providerModelId,
    suggestedModelId: e.suggestedModelId,
    suggestedName: e.suggestedName,
    suggestedCreator: e.suggestedCreator,
    supportsTools: e.supportsTools,
    supportedFormats: e.supportedFormats as ModelFormat[],
    pricing: e.pricing as ModelPricing | null,
    lastSynced: e.lastSynced,
  }));
}

/**
 * Upsert a catalog entry (from sync)
 */
export async function upsertCatalogEntry(
  entry: Omit<CatalogEntry, 'id' | 'lastSynced'>
): Promise<void> {
  const pricingData = entry.pricing ? entry.pricing : Prisma.JsonNull;

  await prisma.providerCatalog.upsert({
    where: {
      providerId_providerModelId: {
        providerId: entry.providerId,
        providerModelId: entry.providerModelId,
      },
    },
    create: {
      providerId: entry.providerId,
      providerModelId: entry.providerModelId,
      suggestedModelId: entry.suggestedModelId,
      suggestedName: entry.suggestedName,
      suggestedCreator: entry.suggestedCreator,
      supportsTools: entry.supportsTools,
      supportedFormats: entry.supportedFormats,
      pricing: pricingData,
      lastSynced: new Date(),
    },
    update: {
      suggestedModelId: entry.suggestedModelId,
      suggestedName: entry.suggestedName,
      suggestedCreator: entry.suggestedCreator,
      supportsTools: entry.supportsTools,
      supportedFormats: entry.supportedFormats,
      pricing: pricingData,
      lastSynced: new Date(),
    },
  });
}

// ============================================================================
// Model Creation from Catalog
// ============================================================================

/**
 * Create a model from a catalog entry and link it to the provider
 */
export async function createModelFromCatalog(
  catalogEntryId: string,
  overrides?: {
    modelId?: string;
    name?: string;
    supportsTools?: boolean;
    supportedFormats?: ModelFormat[];
    isDefault?: boolean;
  }
): Promise<void> {
  const entry = await prisma.providerCatalog.findUnique({
    where: { id: catalogEntryId },
  });

  if (!entry) {
    throw new Error('Catalog entry not found');
  }

  const modelId = overrides?.modelId ?? entry.suggestedModelId;
  if (!modelId) {
    throw new Error('No model ID provided or suggested');
  }

  const parsed = parseModelId(modelId);
  if (!parsed) {
    throw new Error('Invalid model ID format');
  }

  // Create or update the model
  await upsertModel({
    id: modelId,
    name: overrides?.name ?? entry.suggestedName ?? parsed.modelName,
    creator: entry.suggestedCreator ?? parsed.creator,
    supportsTools: overrides?.supportsTools ?? entry.supportsTools,
    supportedFormats:
      overrides?.supportedFormats ?? (entry.supportedFormats as ModelFormat[]),
  });

  // Link to the provider
  await upsertModelProvider(modelId, {
    providerId: entry.providerId,
    providerModelId: entry.providerModelId,
    pricing: entry.pricing as ModelPricing | null,
    isDefault: overrides?.isDefault ?? true,
    enabled: true,
  });
}

/**
 * Link an existing model to a catalog entry (add provider)
 */
export async function linkModelToCatalog(
  modelId: string,
  catalogEntryId: string,
  options?: { isDefault?: boolean }
): Promise<void> {
  const [model, entry] = await Promise.all([
    prisma.model.findUnique({ where: { id: modelId } }),
    prisma.providerCatalog.findUnique({ where: { id: catalogEntryId } }),
  ]);

  if (!model) {
    throw new Error('Model not found');
  }
  if (!entry) {
    throw new Error('Catalog entry not found');
  }

  await upsertModelProvider(modelId, {
    providerId: entry.providerId,
    providerModelId: entry.providerModelId,
    pricing: entry.pricing as ModelPricing | null,
    isDefault: options?.isDefault ?? false,
    enabled: true,
  });
}
