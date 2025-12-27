/**
 * Database Operations for Model and ModelProvider tables
 */

import { prisma, PrismaClient, Prisma } from '@virid/db';
import type {
  ModelCapabilities,
  ModelFormat,
  ModelPricing,
  ResolvedModelCapabilities,
  ManagedModelCapabilities,
} from './types';
import { DEFAULT_TIER_IDS } from './constants';
import {
  inferProviderFromCreator,
  type SdkProvider,
  getProviderDefaults,
} from '../registry';
import { getTier } from '../tiers';
import { parseModelId } from '../model-id';

// Type for accessing prisma client properties
type PrismaClientType = typeof prisma;

// ============================================================================
// Model CRUD Operations
// ============================================================================

/**
 * Get a model with all its provider associations
 */
export async function getModelWithProviders(
  modelId: string
): Promise<ModelCapabilities | null> {
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    include: { providers: true },
  });

  if (!model) return null;

  return {
    ...model,
    supportedFormats: model.supportedFormats as ModelFormat[],
    maxOutputTokens: model.maxOutputTokens,
    providers: model.providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      providerModelId: p.providerModelId,
      pricing: p.pricing as ModelPricing | null,
      isDefault: p.isDefault,
      enabled: p.enabled,
    })),
  };
}

/**
 * Get model capabilities resolved for a specific provider (for API calls)
 * If no provider specified, uses the default provider for the model
 */
export async function getModelCapabilities(
  modelId: string,
  preferredProvider?: string
): Promise<ResolvedModelCapabilities | null> {
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    include: {
      providers: {
        where: { enabled: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  if (!model) {
    // Fallback for models not in database
    return getModelCapabilitiesFallback(modelId);
  }

  // Find the provider to use
  let providerAssoc = model.providers[0]; // Default to first (default provider)

  if (preferredProvider) {
    const preferred = model.providers.find(
      (p) => p.providerId === preferredProvider
    );
    if (preferred) providerAssoc = preferred;
  }

  if (!providerAssoc) {
    // Model exists but has no provider associations - use fallback
    return getModelCapabilitiesFallback(modelId, model);
  }

  return {
    id: model.id,
    name: model.name,
    creator: model.creator,
    supportsTools: model.supportsTools,
    supportedFormats: model.supportedFormats as ModelFormat[],
    maxOutputTokens: model.maxOutputTokens,
    provider: providerAssoc.providerId,
    providerModelId: providerAssoc.providerModelId,
    pricing: providerAssoc.pricing as ModelPricing | null,
  };
}

/**
 * Fallback for models not fully configured in database
 */
async function getModelCapabilitiesFallback(
  modelId: string,
  partialModel?: {
    name: string;
    creator: string;
    supportsTools: boolean;
    supportedFormats: string[];
    maxOutputTokens?: number | null;
  }
): Promise<ResolvedModelCapabilities | null> {
  const parsed = parseModelId(modelId);
  if (!parsed) return null;

  const { creator, modelName } = parsed;

  // Use centralized registry to determine provider
  const { providerId, needsCreatorPrefix } = inferProviderFromCreator(creator);
  const providerModelId = needsCreatorPrefix
    ? `${creator}/${modelName}`
    : modelName;

  const defaults = getProviderDefaults(providerId);

  return {
    id: modelId,
    name: partialModel?.name ?? modelName,
    creator: partialModel?.creator ?? creator,
    supportsTools: partialModel?.supportsTools ?? defaults.supportsTools,
    supportedFormats:
      (partialModel?.supportedFormats as ModelFormat[]) ??
      defaults.supportedFormats,
    maxOutputTokens: partialModel?.maxOutputTokens ?? null,
    provider: providerId,
    providerModelId,
    pricing: null,
  };
}

/**
 * Create or update a model (without provider associations)
 */
export async function upsertModel(data: {
  id: string;
  name: string;
  creator: string;
  supportsTools?: boolean;
  supportedFormats?: ModelFormat[];
  maxOutputTokens?: number | null;
}): Promise<void> {
  await prisma.model.upsert({
    where: { id: data.id },
    create: {
      id: data.id,
      name: data.name,
      creator: data.creator,
      supportsTools: data.supportsTools ?? true,
      supportedFormats: data.supportedFormats ?? ['text'],
      maxOutputTokens: data.maxOutputTokens ?? null,
    },
    update: {
      name: data.name,
      creator: data.creator,
      supportsTools: data.supportsTools,
      supportedFormats: data.supportedFormats,
      maxOutputTokens: data.maxOutputTokens,
    },
  });
}

/**
 * Delete a model and all its provider associations
 */
export async function deleteModel(modelId: string): Promise<void> {
  await prisma.model.delete({ where: { id: modelId } });
}

/**
 * Get all models from database
 */
export async function getAllModels(): Promise<ModelCapabilities[]> {
  const models = await prisma.model.findMany({
    include: { providers: true },
    orderBy: [{ creator: 'asc' }, { name: 'asc' }],
  });

  return models.map((m) => ({
    ...m,
    supportedFormats: m.supportedFormats as ModelFormat[],
    maxOutputTokens: m.maxOutputTokens,
    providers: m.providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      providerModelId: p.providerModelId,
      pricing: p.pricing as ModelPricing | null,
      isDefault: p.isDefault,
      enabled: p.enabled,
    })),
  }));
}

// ============================================================================
// ModelProvider CRUD Operations
// ============================================================================

/**
 * Add or update a provider association for a model.
 *
 * @param modelId - The canonical model ID
 * @param data - Provider association data
 * @param data.customPlatformProviderId - Optional ID of a PlatformCustomProvider to route through.
 *   When set, the model will use this custom provider instead of the standard provider endpoint.
 *   This allows admins to change a model's backend provider without changing the model ID
 *   that users see or have in their settings.
 */
export async function upsertModelProvider(
  modelId: string,
  data: {
    providerId: string;
    providerModelId: string;
    pricing?: ModelPricing | null;
    isDefault?: boolean;
    enabled?: boolean;
    customPlatformProviderId?: string | null;
  }
): Promise<void> {
  const pricingData = data.pricing ? data.pricing : Prisma.JsonNull;

  // If setting as default, unset other defaults first
  if (data.isDefault) {
    await prisma.modelProvider.updateMany({
      where: { modelId, isDefault: true },
      data: { isDefault: false },
    });
  }

  await prisma.modelProvider.upsert({
    where: {
      modelId_providerId: { modelId, providerId: data.providerId },
    },
    create: {
      modelId,
      providerId: data.providerId,
      providerModelId: data.providerModelId,
      pricing: pricingData,
      isDefault: data.isDefault ?? false,
      enabled: data.enabled ?? true,
      customPlatformProviderId: data.customPlatformProviderId ?? null,
    },
    update: {
      providerModelId: data.providerModelId,
      pricing: pricingData,
      isDefault: data.isDefault,
      enabled: data.enabled,
      customPlatformProviderId: data.customPlatformProviderId,
    },
  });
}

/**
 * Remove a provider association from a model
 */
export async function removeModelProvider(
  modelId: string,
  providerId: string
): Promise<void> {
  await prisma.modelProvider.deleteMany({
    where: { modelId, providerId },
  });
}

// ============================================================================
// Tier Integration
// ============================================================================

/**
 * Collect the set of model ids referenced by all tiers (via TierModel join table)
 */
export async function getTierModelIds(): Promise<string[]> {
  // Get model IDs from the TierModel join table
  const tierModels = await prisma.tierModel.findMany({
    select: { modelId: true },
  });

  const modelIds = new Set<string>();
  for (const tm of tierModels) {
    modelIds.add(tm.modelId);
  }

  // Also check fallback tiers for model IDs (from env vars)
  const tiersInDb = await prisma.tier.findMany({ select: { id: true } });
  const tierIdsInDb = new Set(tiersInDb.map((t) => t.id));

  for (const fallbackTierId of DEFAULT_TIER_IDS) {
    if (tierIdsInDb.has(fallbackTierId)) continue;
    try {
      const fallbackTier = await getTier(fallbackTierId);
      fallbackTier.modelIds.forEach((id) => {
        if (id) modelIds.add(id);
      });
    } catch {
      // Ignore missing fallback tiers
    }
  }

  return Array.from(modelIds);
}

/**
 * Get managed model capabilities with tier coverage and provider metadata
 */
export async function getManagedModels(): Promise<ManagedModelCapabilities[]> {
  const [dbModels, tierModelIds] = await Promise.all([
    prisma.model.findMany({
      include: {
        providers: {
          include: {
            customPlatformProvider: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [{ creator: 'asc' }, { name: 'asc' }],
    }),
    getTierModelIds(),
  ]);

  const tierSet = new Set(tierModelIds);

  return dbModels.map((model) => ({
    ...model,
    supportedFormats: model.supportedFormats as ModelFormat[],
    maxOutputTokens: model.maxOutputTokens,
    providers: model.providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      providerModelId: p.providerModelId,
      pricing: p.pricing as ModelPricing | null,
      isDefault: p.isDefault,
      enabled: p.enabled,
      customPlatformProviderId: p.customPlatformProviderId,
      customProviderName: p.customPlatformProvider?.name,
    })),
    isPersisted: true,
    inUse: tierSet.has(model.id),
    // A model can be added to tiers only if it has at least one provider
    canBeInTier: model.providers.length > 0,
  }));
}

/**
 * Get all models that can be added to tiers (have at least one provider)
 */
export async function getModelsForTierSelection(): Promise<
  ManagedModelCapabilities[]
> {
  const models = await getManagedModels();
  return models.filter((m) => m.providers.length > 0);
}

/**
 * Get all models available for BYOK (all models in the registry, with or without providers)
 */
export async function getModelsForByok(): Promise<ManagedModelCapabilities[]> {
  return getManagedModels();
}

/**
 * Get model IDs accessible via BYOK for a list of provider IDs.
 * DEPRECATED: Use getUserByokModelIds from user-keys.ts instead.
 * This is kept for backward compatibility but returns empty since
 * BYOK model access is now explicit (stored per-user in UserApiKey.modelIds).
 */
export async function getByokAccessibleModelIds(
  providerIds: string[]
): Promise<string[]> {
  // BYOK access is now explicit per user - this function can't determine access
  // without a userId. Return empty array for safety.
  // Callers should migrate to getUserByokModelIds(userId) from user-keys.ts
  console.warn(
    'getByokAccessibleModelIds is deprecated. Use getUserByokModelIds(userId) instead.'
  );
  return [];
}

/**
 * Ensure model capabilities exist for all tier models
 * Creates placeholder entries for missing models
 */
export async function ensureModelCapabilities(): Promise<void> {
  const [tierModelIds, existingModels] = await Promise.all([
    getTierModelIds(),
    prisma.model.findMany({ select: { id: true } }),
  ]);

  const existingIds = new Set(existingModels.map((m) => m.id));

  for (const modelId of tierModelIds) {
    if (existingIds.has(modelId)) continue;

    const parsed = parseModelId(modelId);
    if (!parsed) continue;

    // Create a placeholder model
    await upsertModel({
      id: modelId,
      name: parsed.modelName,
      creator: parsed.creator,
      supportsTools: true,
      supportedFormats: ['text'],
    });

    // Use centralized registry to infer default provider association
    const { providerId, needsCreatorPrefix } = inferProviderFromCreator(
      parsed.creator
    );
    const providerModelId = needsCreatorPrefix
      ? `${parsed.creator}/${parsed.modelName}`
      : parsed.modelName;

    await upsertModelProvider(modelId, {
      providerId,
      providerModelId,
      isDefault: true,
      enabled: true,
    });
  }
}
