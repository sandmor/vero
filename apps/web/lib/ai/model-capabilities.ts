import { prisma } from '../db/prisma';
import type { ProviderInfo, ProviderModel } from 'tokenlens/core';
import type { SupportedProvider } from './registry';
import { getTier } from './tiers';
import { Prisma } from '../../generated/prisma-client/client';

export type ModelFormat = 'text' | 'image' | 'file' | 'audio' | 'video';

export type ModelPricing = {
  prompt?: number; // Cost per million input tokens
  completion?: number; // Cost per million output tokens
  image?: number; // Cost per image generated
  reasoning?: number; // Cost per million reasoning tokens
  cacheRead?: number; // Cost per million cache read tokens
  cacheWrite?: number; // Cost per million cache write tokens
};

export type ModelCapabilities = {
  id: string; // composite id (provider:model)
  name: string;
  provider: string;
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  pricing?: ModelPricing | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ManagedModelCapabilities = ModelCapabilities & {
  isPersisted: boolean;
  inUse: boolean;
};

const DEFAULT_TIER_IDS = ['guest', 'regular'];

// Default capabilities by provider - these are safe defaults
const PROVIDER_DEFAULTS: Record<
  SupportedProvider,
  Omit<
    ModelCapabilities,
    'id' | 'name' | 'provider' | 'createdAt' | 'updatedAt'
  >
> = {
  openai: {
    supportsTools: true,
    supportedFormats: ['text', 'image', 'file', 'audio'],
  },
  google: {
    supportsTools: true,
    supportedFormats: ['text', 'image', 'file', 'audio', 'video'],
  },
  openrouter: {
    // Conservative default - will be overridden by OpenRouter API sync
    supportsTools: false,
    supportedFormats: ['text'],
  },
};

const FORMAT_PRIORITY: ModelFormat[] = [
  'text',
  'image',
  'file',
  'audio',
  'video',
];

// OpenRouter API response types
export type OpenRouterModel = {
  id: string;
  name: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: {
    prompt?: string | number; // Cost per million tokens (can be string or number)
    completion?: string | number; // Cost per million tokens
    image?: string | number; // Cost per image
    request?: string | number; // Cost per request
  };
};

export type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

/**
 * Map OpenRouter modalities to our format types
 */
function mapModalityToFormat(modality: string): ModelFormat | null {
  const normalized = modality.toLowerCase();

  if (
    normalized.includes('text') ||
    normalized.includes('chat') ||
    normalized.includes('language') ||
    normalized.includes('code') ||
    normalized.includes('json')
  ) {
    return 'text';
  }

  if (
    normalized.includes('image') ||
    normalized.includes('vision') ||
    normalized.includes('visual') ||
    normalized.includes('graphic') ||
    normalized.includes('picture')
  ) {
    return 'image';
  }

  if (
    normalized.includes('file') ||
    normalized.includes('document') ||
    normalized.includes('doc') ||
    normalized.includes('pdf') ||
    normalized.includes('attachment')
  ) {
    return 'file';
  }

  if (
    normalized.includes('audio') ||
    normalized.includes('speech') ||
    normalized.includes('voice') ||
    normalized.includes('sound')
  ) {
    return 'audio';
  }

  if (
    normalized.includes('video') ||
    normalized.includes('animation') ||
    normalized.includes('frame')
  ) {
    return 'video';
  }

  return null;
}

type CompositeModelId = {
  providerId: string;
  modelKey: string;
};

function parseCompositeModelId(modelId: string): CompositeModelId | null {
  if (!modelId) return null;
  const [providerId, ...rest] = modelId.split(':');
  if (!providerId || rest.length === 0) return null;
  const modelKey = rest.join(':');
  if (!modelKey) return null;
  return { providerId, modelKey };
}

function sortFormats(formats: Set<ModelFormat>): ModelFormat[] {
  return Array.from(formats).sort(
    (a, b) => FORMAT_PRIORITY.indexOf(a) - FORMAT_PRIORITY.indexOf(b)
  );
}

function normalizeTokenLensPricing(model: ProviderModel): ModelPricing | null {
  const pricing: ModelPricing = {};
  const { cost } = model;

  if (cost) {
    if (typeof cost.input === 'number' && Number.isFinite(cost.input)) {
      pricing.prompt = cost.input;
    }
    if (typeof cost.output === 'number' && Number.isFinite(cost.output)) {
      pricing.completion = cost.output;
    }
    if (typeof cost.reasoning === 'number' && Number.isFinite(cost.reasoning)) {
      pricing.reasoning = cost.reasoning;
    }
    if (
      typeof cost.cache_read === 'number' &&
      Number.isFinite(cost.cache_read)
    ) {
      pricing.cacheRead = cost.cache_read;
    }
    if (
      typeof cost.cache_write === 'number' &&
      Number.isFinite(cost.cache_write)
    ) {
      pricing.cacheWrite = cost.cache_write;
    }
  }

  return Object.keys(pricing).length > 0 ? pricing : null;
}

function deriveTokenLensFormats(model: ProviderModel): Set<ModelFormat> {
  const formats = new Set<ModelFormat>();
  const addModalities = (values?: readonly string[]) => {
    if (!values) return;
    for (const value of values) {
      if (!value) continue;
      const format = mapModalityToFormat(value);
      if (format) formats.add(format);
    }
  };

  addModalities(model.modalities?.input);
  addModalities(model.modalities?.output);

  if (model.attachment) {
    formats.add('file');
  }

  if (formats.size === 0) {
    formats.add('text');
  }

  return formats;
}

function buildTokenLensCapabilities(
  provider: ProviderInfo,
  modelKey: string,
  model: ProviderModel
): Omit<ModelCapabilities, 'createdAt' | 'updatedAt'> {
  return {
    id: `${provider.id}:${modelKey}`,
    name: model.name ?? modelKey,
    provider: provider.id,
    supportsTools: Boolean(model.tool_call),
    supportedFormats: sortFormats(deriveTokenLensFormats(model)),
    pricing: normalizeTokenLensPricing(model),
  };
}

/**
 * Parse OpenRouter model data to our capabilities format
 */
export function parseOpenRouterCapabilities(
  model: OpenRouterModel,
  provider: string = 'openrouter'
): Omit<ModelCapabilities, 'createdAt' | 'updatedAt'> {
  const supportsTools =
    model.supported_parameters?.some(
      (param) =>
        param === 'tools' || param === 'tool_choice' || param === 'functions'
    ) ?? false;

  const formats = new Set<ModelFormat>(['text']); // Always support text at minimum

  if (model.architecture?.input_modalities) {
    for (const modality of model.architecture.input_modalities) {
      const format = mapModalityToFormat(modality);
      if (format) formats.add(format);
    }
  }

  // Parse pricing information from OpenRouter
  const pricing: ModelPricing | null = model.pricing
    ? {
        prompt:
          typeof model.pricing.prompt === 'string'
            ? Number.parseFloat(model.pricing.prompt) * 1_000_000
            : typeof model.pricing.prompt === 'number'
              ? model.pricing.prompt * 1_000_000
              : undefined,
        completion:
          typeof model.pricing.completion === 'string'
            ? Number.parseFloat(model.pricing.completion) * 1_000_000
            : typeof model.pricing.completion === 'number'
              ? model.pricing.completion * 1_000_000
              : undefined,
        image:
          typeof model.pricing.image === 'string'
            ? Number.parseFloat(model.pricing.image)
            : typeof model.pricing.image === 'number'
              ? model.pricing.image
              : undefined,
      }
    : null;

  return {
    id: `${provider}:${model.id}`,
    name: model.name,
    provider,
    supportsTools,
    supportedFormats: Array.from(formats),
    pricing,
  };
}

/**
 * Fetch models from OpenRouter API
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models');
  if (!response.ok) {
    throw new Error(
      `OpenRouter API error: ${response.status} ${response.statusText}`
    );
  }
  const data: OpenRouterModelsResponse = await response.json();
  return data.data;
}

/**
 * Get model capabilities from database, with fallback to provider defaults
 */
export async function getModelCapabilities(
  modelId: string
): Promise<ModelCapabilities | null> {
  try {
    const model = await prisma.model.findUnique({
      where: { id: modelId },
    });

    if (model) {
      return {
        ...model,
        supportedFormats: model.supportedFormats as ModelFormat[],
        pricing: model.pricing as ModelPricing | null,
      };
    }

    // Fallback to provider defaults
    const [provider] = modelId.split(':');
    if (provider in PROVIDER_DEFAULTS) {
      const defaults = PROVIDER_DEFAULTS[provider as SupportedProvider];
      return {
        id: modelId,
        name: modelId.split(':').slice(1).join(':'),
        provider,
        ...defaults,
        pricing: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching model capabilities:', error);
    return null;
  }
}

/**
 * Upsert model capabilities to database
 */
export async function upsertModelCapabilities(
  capabilities: Omit<ModelCapabilities, 'createdAt' | 'updatedAt'>
): Promise<ModelCapabilities> {
  const pricingData = capabilities.pricing
    ? capabilities.pricing
    : Prisma.JsonNull;
  const model = await prisma.model.upsert({
    where: { id: capabilities.id },
    create: {
      id: capabilities.id,
      name: capabilities.name,
      provider: capabilities.provider,
      supportsTools: capabilities.supportsTools,
      supportedFormats: capabilities.supportedFormats,
      pricing: pricingData,
    },
    update: {
      name: capabilities.name,
      supportsTools: capabilities.supportsTools,
      supportedFormats: capabilities.supportedFormats,
      pricing: pricingData,
    },
  });

  return {
    ...model,
    supportedFormats: model.supportedFormats as ModelFormat[],
    pricing: model.pricing as ModelPricing | null,
  };
}

/**
 * Sync OpenRouter models to database
 */
export async function syncOpenRouterModels(
  options: {
    modelIds?: string[];
    allowCreate?: boolean;
  } = {}
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  const { modelIds, allowCreate = false } = options;

  try {
    const existing = await prisma.model.findMany({
      where: { provider: 'openrouter' },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((m) => m.id));

    let targets: string[];
    if (modelIds && modelIds.length > 0) {
      targets = allowCreate
        ? modelIds
        : modelIds.filter((id) => existingIds.has(id));
    } else {
      targets = Array.from(existingIds);
    }

    if (targets.length === 0) {
      return { synced, errors };
    }

    const openRouterModels = await fetchOpenRouterModels();
    const catalog = new Map(openRouterModels.map((model) => [model.id, model]));

    for (const compositeId of targets) {
      const slug = compositeId.startsWith('openrouter:')
        ? compositeId.slice('openrouter:'.length)
        : compositeId;
      const orModel = catalog.get(slug);
      if (!orModel) {
        errors.push(`${slug}: not found in OpenRouter catalog`);
        continue;
      }
      try {
        const capabilities = parseOpenRouterCapabilities(orModel);
        if (!allowCreate && !existingIds.has(capabilities.id)) {
          // Skip creation when creation not allowed
          continue;
        }
        await upsertModelCapabilities(capabilities);
        synced++;
      } catch (error) {
        errors.push(
          `${slug}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return { synced, errors };
  } catch (error) {
    errors.push(
      `OpenRouter API: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return { synced, errors };
  }
}

export async function syncTokenLensModels(
  options: {
    provider?: string;
    modelIds?: string[];
    allowCreate?: boolean;
  } = {}
): Promise<{ synced: number; errors: string[] }> {
  const { provider, modelIds, allowCreate = false } = options;

  const errors: string[] = [];
  let synced = 0;

  // Determine existing models scoped by provider/modelIds for filtering
  const whereClause = provider
    ? { provider }
    : modelIds && modelIds.length > 0
      ? { id: { in: modelIds } }
      : undefined;

  const existing = await prisma.model.findMany({
    ...(whereClause ? { where: whereClause } : {}),
    select: { id: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));

  let targets: string[];
  if (modelIds && modelIds.length > 0) {
    targets = allowCreate
      ? modelIds
      : modelIds.filter((id) => existingIds.has(id));
  } else {
    targets = Array.from(existingIds);
  }

  if (targets.length === 0) {
    return { synced, errors };
  }

  const normalizedTargets = Array.from(new Set(targets));
  const targetEntries = normalizedTargets.map((id) => ({
    id,
    parts: parseCompositeModelId(id),
  }));

  const providerIds = new Set<string>();
  for (const entry of targetEntries) {
    if (!entry.parts) {
      errors.push(`${entry.id}: invalid model id format`);
      continue;
    }
    providerIds.add(entry.parts.providerId);
  }

  const { fetchModels } = await import('tokenlens/fetch');
  const providerCatalog = new Map<string, ProviderInfo | null>();

  for (const providerId of providerIds) {
    if (providerCatalog.has(providerId)) continue;
    try {
      const info = await fetchModels(providerId);
      if (!info) {
        errors.push(`${providerId}: provider not found in TokenLens catalog`);
        providerCatalog.set(providerId, null);
      } else {
        providerCatalog.set(providerId, info);
      }
    } catch (error) {
      errors.push(
        `${providerId}: ${error instanceof Error ? error.message : 'Failed to load TokenLens provider data'}`
      );
      providerCatalog.set(providerId, null);
    }
  }

  for (const entry of targetEntries) {
    const parts = entry.parts;
    if (!parts) continue; // Already recorded as invalid

    const providerInfo = providerCatalog.get(parts.providerId);
    if (!providerInfo) {
      continue; // Provider fetch failed (error logged above)
    }

    const providerModel = providerInfo.models?.[parts.modelKey];
    if (!providerModel) {
      errors.push(`${entry.id}: not found in TokenLens provider catalog`);
      continue;
    }

    try {
      const capabilities = buildTokenLensCapabilities(
        providerInfo,
        parts.modelKey,
        providerModel
      );

      if (!allowCreate && !existingIds.has(capabilities.id)) {
        continue;
      }

      await upsertModelCapabilities(capabilities);
      existingIds.add(capabilities.id);
      synced++;
    } catch (error) {
      errors.push(
        `${entry.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return { synced, errors };
}

/**
 * Get all models from database
 */
export async function getAllModels(): Promise<ModelCapabilities[]> {
  const models = await prisma.model.findMany({
    orderBy: [{ provider: 'asc' }, { name: 'asc' }],
  });

  return models.map((m) => ({
    ...m,
    supportedFormats: m.supportedFormats as ModelFormat[],
    pricing: m.pricing as ModelPricing | null,
  }));
}

/**
 * Collect the set of model ids referenced by all tiers (including fallbacks)
 */
export async function getTierModelIds(): Promise<string[]> {
  const tiers = await prisma.tier.findMany({
    select: { id: true, modelIds: true },
  });

  const tierIdsInDb = new Set(tiers.map((tier) => tier.id));
  const modelIds = new Set<string>();

  for (const tier of tiers) {
    for (const id of tier.modelIds) {
      if (id) modelIds.add(id);
    }
  }

  for (const fallbackTierId of DEFAULT_TIER_IDS) {
    if (tierIdsInDb.has(fallbackTierId)) continue;
    try {
      const fallbackTier = await getTier(fallbackTierId);
      fallbackTier.modelIds.forEach((id) => {
        if (id) modelIds.add(id);
      });
    } catch (error) {
      console.warn(
        `[model-capabilities] Failed to load fallback tier '${fallbackTierId}'`,
        error
      );
    }
  }

  return Array.from(modelIds);
}

/**
 * Get managed model capabilities ensuring tier coverage metadata
 */
export async function getManagedModels(): Promise<ManagedModelCapabilities[]> {
  const [dbModels, tierModelIds] = await Promise.all([
    prisma.model.findMany({
      orderBy: [{ provider: 'asc' }, { name: 'asc' }],
    }),
    getTierModelIds(),
  ]);

  const tierSet = new Set(tierModelIds);
  const managed: ManagedModelCapabilities[] = [];
  const persistedIds = new Set<string>();

  for (const model of dbModels) {
    const normalized: ManagedModelCapabilities = {
      ...model,
      supportedFormats: model.supportedFormats as ModelFormat[],
      pricing: model.pricing as ModelPricing | null,
      isPersisted: true,
      inUse: tierSet.has(model.id),
    };
    managed.push(normalized);
    persistedIds.add(model.id);
  }

  const missingIds = tierModelIds.filter((id) => !persistedIds.has(id));
  if (missingIds.length > 0) {
    const missingCapabilities = await Promise.all(
      missingIds.map((id) => getModelCapabilities(id))
    );
    for (const capabilities of missingCapabilities) {
      if (!capabilities) continue;
      managed.push({
        ...capabilities,
        isPersisted: false,
        inUse: true,
      });
    }
  }

  managed.sort((a, b) => {
    if (a.provider === b.provider) {
      return a.name.localeCompare(b.name);
    }
    return a.provider.localeCompare(b.provider);
  });

  return managed;
}

/**
 * Sync pricing from TokenLens catalog for a specific model
 */
export async function syncPricingFromTokenLens(
  modelId: string
): Promise<ModelPricing | null> {
  const parts = parseCompositeModelId(modelId);
  if (!parts) {
    return null;
  }

  try {
    const { fetchModels } = await import('tokenlens/fetch');
    const providerInfo = await fetchModels(parts.providerId);
    if (!providerInfo) {
      return null;
    }

    const providerModel = providerInfo.models?.[parts.modelKey];
    if (!providerModel) {
      return null;
    }

    return normalizeTokenLensPricing(providerModel);
  } catch (error) {
    console.error('Failed to sync pricing from TokenLens:', error);
    return null;
  }
}

export async function syncProviderCatalog(
  providerId: string
): Promise<{ synced: number; errors: string[] }> {
  if (!providerId) {
    return { synced: 0, errors: ['provider is required'] };
  }

  if (providerId === 'openrouter') {
    try {
      const catalog = await fetchOpenRouterModels();
      const modelIds = catalog.map((model) => `openrouter:${model.id}`);

      if (modelIds.length === 0) {
        return {
          synced: 0,
          errors: ['openrouter: catalog did not return any models'],
        };
      }

      return syncOpenRouterModels({ modelIds, allowCreate: true });
    } catch (error) {
      return {
        synced: 0,
        errors: [
          `openrouter: ${error instanceof Error ? error.message : 'failed to fetch catalog'}`,
        ],
      };
    }
  }

  try {
    const { fetchModels } = await import('tokenlens/fetch');
    const providerInfo = await fetchModels(providerId);

    if (!providerInfo || !providerInfo.models) {
      return {
        synced: 0,
        errors: [`${providerId}: provider not found in TokenLens catalog`],
      };
    }

    const modelKeys = Object.keys(providerInfo.models);
    if (modelKeys.length === 0) {
      return {
        synced: 0,
        errors: [`${providerId}: no models available in TokenLens catalog`],
      };
    }

    const modelIds = modelKeys.map((key) => `${providerId}:${key}`);
    return syncTokenLensModels({ modelIds, allowCreate: true });
  } catch (error) {
    return {
      synced: 0,
      errors: [
        `${providerId}: ${error instanceof Error ? error.message : 'failed to fetch provider catalog'}`,
      ],
    };
  }
}

/**
 * Remove models that are not referenced by any tier
 */
export async function removeUnusedModels(): Promise<number> {
  const [dbModels, tierModelIds] = await Promise.all([
    prisma.model.findMany({ select: { id: true } }),
    getTierModelIds(),
  ]);

  const tierSet = new Set(tierModelIds);
  const toDelete = dbModels
    .map((model) => model.id)
    .filter((id) => !tierSet.has(id));

  if (toDelete.length === 0) {
    return 0;
  }

  const result = await prisma.model.deleteMany({
    where: {
      id: { in: toDelete },
    },
  });

  return result.count;
}

/**
 * Batch upsert default capabilities for known models
 */
export async function seedDefaultCapabilities(
  modelIds: string[]
): Promise<void> {
  for (const modelId of modelIds) {
    const [provider, ...modelParts] = modelId.split(':');
    const model = modelParts.join(':');

    if (provider in PROVIDER_DEFAULTS) {
      const defaults = PROVIDER_DEFAULTS[provider as SupportedProvider];
      await upsertModelCapabilities({
        id: modelId,
        name: model,
        provider,
        ...defaults,
      });
    }
  }
}

/**
 * Ensure the specified models exist in the database with capabilities.
 * Missing OpenRouter models are fetched from the OpenRouter catalog.
 * Other providers fall back to inferred/default capabilities.
 */
export async function ensureModelCapabilities(modelIds: string[]): Promise<{
  created: number;
  errors: string[];
}> {
  const uniqueIds = Array.from(new Set(modelIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { created: 0, errors: [] };
  }

  const existing = await prisma.model.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((m) => m.id));
  const missing = uniqueIds.filter((id) => !existingIds.has(id));

  if (missing.length === 0) {
    return { created: 0, errors: [] };
  }

  let created = 0;
  const errors: string[] = [];

  const openRouterIds: string[] = [];
  const otherIds: string[] = [];

  for (const id of missing) {
    const provider = id.split(':')[0];
    if (provider === 'openrouter') openRouterIds.push(id);
    else otherIds.push(id);
  }

  if (openRouterIds.length > 0) {
    const result = await syncOpenRouterModels({
      modelIds: openRouterIds,
      allowCreate: true,
    });
    created += result.synced;
    errors.push(
      ...result.errors.map((err) =>
        err.startsWith('openrouter:') ? err : `openrouter:${err}`
      )
    );
  }

  for (const id of otherIds) {
    try {
      const capabilities = await getModelCapabilities(id);
      if (!capabilities) {
        errors.push(`${id}: unsupported provider`);
        continue;
      }

      await upsertModelCapabilities({
        id: capabilities.id,
        name: capabilities.name,
        provider: capabilities.provider,
        supportsTools: capabilities.supportsTools,
        supportedFormats: capabilities.supportedFormats,
      });
      created++;
    } catch (error) {
      errors.push(
        `${id}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  return { created, errors };
}
