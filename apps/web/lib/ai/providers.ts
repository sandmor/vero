import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { prisma } from '@virid/db';
import { isTestEnvironment } from '../constants';
import { parseModelId } from './model-id';
import { getProviderApiKey } from './provider-keys';
import {
  SDK_PROVIDERS,
  providerHasSdkSupport,
  inferProviderFromCreator,
} from './registry';
import { type ParsedByokModelId } from './byok';

// =============================================================================
// Provider Factory Caching
// =============================================================================

const PROVIDER_CACHE_TTL_MS = 60_000; // 1 minute
let providerVersion = 0;

type ProviderClientEntry = {
  factory: (model: string) => any;
  apiKey: string | undefined;
  fetchedAt: number;
};

const providerClientCache = new Map<string, ProviderClientEntry>();

/**
 * Build a provider factory for a known platform provider
 */
function buildProviderFactory(
  provider: string,
  apiKey?: string,
  baseUrl?: string
) {
  switch (provider) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: apiKey ?? '',
        extraBody: { include_reasoning: true },
      });
    case 'openai':
      return createOpenAI({ apiKey, baseURL: baseUrl });
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl });
    case 'xai':
      return createXai({ apiKey, baseURL: baseUrl });
    default:
      throw new Error(`Unsupported provider '${provider}'`);
  }
}

/**
 * Build an OpenAI-compatible provider factory for custom endpoints
 */
function buildCustomProviderFactory(
  name: string,
  apiKey: string,
  baseUrl: string
) {
  return createOpenAICompatible({
    name,
    apiKey: apiKey,
    baseURL: baseUrl,
    includeUsage: true,
  });
}

/**
 * Get or create a cached provider client factory
 */
async function getProviderClient(
  provider: string
): Promise<(model: string) => any> {
  const existing = providerClientCache.get(provider);
  const now = Date.now();
  if (existing && now - existing.fetchedAt < PROVIDER_CACHE_TTL_MS) {
    return existing.factory;
  }
  const apiKey = await getProviderApiKey(provider);
  const factory = buildProviderFactory(provider, apiKey);
  providerClientCache.set(provider, { factory, apiKey, fetchedAt: now });
  providerVersion++;
  return factory;
}

// =============================================================================
// Provider Info Resolution
// =============================================================================

/**
 * Resolution result for a built-in platform provider (openai, google, openrouter)
 */
type BuiltinProviderInfo = {
  type: 'builtin';
  provider: string;
  providerModelId: string;
};

/**
 * Resolution result for a platform custom provider (admin-defined OpenAI-compatible endpoint)
 */
type PlatformCustomProviderInfo = {
  type: 'platform-custom';
  providerModelId: string;
  customProvider: {
    slug: string;
    baseUrl: string;
    apiKey: string | null;
  };
};

type ProviderInfo = BuiltinProviderInfo | PlatformCustomProviderInfo;

/**
 * Resolve provider and providerModelId for a model ID.
 *
 * Resolution order:
 * 1. PlatformCustomModel - admin-defined custom models (e.g., "mycorp:custom-gpt")
 * 2. Model + ModelProvider - models with registered providers
 *    - If ModelProvider has customPlatformProviderId, route through that custom provider
 *    - Otherwise use the standard builtin provider
 * 3. Fallback parsing - for openai: and google: prefixed models not in DB
 */
async function resolveProviderInfo(modelId: string): Promise<ProviderInfo> {
  // 1. Check PlatformCustomModel first (admin-defined custom models)
  const platformCustomModel = await prisma.platformCustomModel.findUnique({
    where: { modelSlug: modelId },
    include: { provider: true },
  });

  if (platformCustomModel?.enabled && platformCustomModel.provider.enabled) {
    return {
      type: 'platform-custom',
      providerModelId: platformCustomModel.providerModelId,
      customProvider: {
        slug: platformCustomModel.provider.slug,
        baseUrl: platformCustomModel.provider.baseUrl,
        apiKey: platformCustomModel.provider.apiKey,
      },
    };
  }

  // 2. Look up from Model + ModelProvider tables
  const model = await prisma.model.findUnique({
    where: { id: modelId },
    include: {
      providers: {
        where: { enabled: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        take: 1,
        include: {
          customPlatformProvider: true,
        },
      },
    },
  });

  if (model && model.providers[0]) {
    const provider = model.providers[0];

    // Check if this provider routes through a custom platform provider
    if (provider.customPlatformProviderId && provider.customPlatformProvider) {
      const customProvider = provider.customPlatformProvider;
      if (customProvider.enabled) {
        return {
          type: 'platform-custom',
          providerModelId: provider.providerModelId,
          customProvider: {
            slug: customProvider.slug,
            baseUrl: customProvider.baseUrl,
            apiKey: customProvider.apiKey,
          },
        };
      }
    }

    // Standard builtin provider
    return {
      type: 'builtin',
      provider: provider.providerId,
      providerModelId: provider.providerModelId,
    };
  }

  // 3. Fallback: parse from the model ID and infer provider
  const parsed = parseModelId(modelId);
  if (!parsed) {
    throw new Error(`Invalid model ID format: ${modelId}`);
  }

  const { creator, modelName } = parsed;

  // Use centralized registry to infer provider
  const { providerId, needsCreatorPrefix } = inferProviderFromCreator(creator);
  const providerModelId = needsCreatorPrefix
    ? `${creator}/${modelName}`
    : modelName;

  // Only allow fallback for SDK providers (openai, google)
  // OpenRouter models must be in the database
  if (!providerHasSdkSupport(providerId) || providerId === 'openrouter') {
    throw new Error(
      `Provider for model "${modelId}" could not be determined. Ensure the model is configured in the database.`
    );
  }

  return { type: 'builtin', provider: providerId, providerModelId };
}

// =============================================================================
// Model Resolution & Caching
// =============================================================================

const MODEL_CACHE_TTL_MS = 10 * 60_000; // 10 minutes

type ModelCacheEntry = {
  model: any;
  fetchedAt: number;
};

const modelCache = new Map<string, ModelCacheEntry>();

/**
 * Build a language model client based on resolved provider info
 */
function buildLanguageModel(
  info: ProviderInfo,
  providerFactory?: (model: string) => any
) {
  if (info.type === 'platform-custom') {
    const factory = buildCustomProviderFactory(
      info.customProvider.slug,
      info.customProvider.apiKey || '',
      info.customProvider.baseUrl
    );
    return factory(info.providerModelId);
  }

  if (!providerFactory) {
    throw new Error('Provider factory required for builtin providers');
  }
  return providerFactory(info.providerModelId);
}

/**
 * Resolve and build a language model client for a model ID.
 * Results are cached for MODEL_CACHE_TTL_MS.
 */
async function resolveLanguageModel(modelId: string) {
  const info = await resolveProviderInfo(modelId);

  if (info.type === 'platform-custom') {
    return buildLanguageModel(info);
  }

  const client = await getProviderClient(info.provider);
  return client(info.providerModelId);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get a language model client for a model ID.
 * Uses caching to avoid repeated database lookups and SDK initialization.
 */
export async function getLanguageModel(id: string) {
  // Check cache first
  const cached = modelCache.get(id);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
    return cached.model;
  }

  // Test environment mock
  if (isTestEnvironment) {
    const { reasoningModel } = require('./models.mock');
    return reasoningModel;
  }

  // Resolve and cache
  const model = await resolveLanguageModel(id);
  modelCache.set(id, { model, fetchedAt: now });
  return model;
}

/**
 * Get a language model with a user-provided API key.
 * Used for platform models when user wants to use their own key.
 */
export async function getLanguageModelWithKey(id: string, apiKey: string) {
  const info = await resolveProviderInfo(id);

  if (info.type === 'platform-custom') {
    // Platform custom models use the platform's configured key
    return buildLanguageModel(info);
  }

  const factory = buildProviderFactory(info.provider, apiKey);
  return factory(info.providerModelId);
}

/**
 * Get a language model for a BYOK model ID with user credentials.
 *
 * @param parsed - Parsed BYOK model ID from parseByokModelId()
 * @param resolution - Resolution info containing API key and optional base URL
 */
export function getByokLanguageModel(
  parsed: ParsedByokModelId,
  resolution: {
    apiKey: string;
    baseUrl?: string;
    providerModelId: string;
  }
) {
  if (parsed.sourceType === 'platform') {
    // Use platform provider with user's API key
    const factory = buildProviderFactory(parsed.providerId, resolution.apiKey);
    return factory(resolution.providerModelId);
  }

  // Custom provider - use OpenAI-compatible client
  const factory = buildCustomProviderFactory(
    'byok-custom',
    resolution.apiKey,
    resolution.baseUrl!
  );
  return factory(resolution.providerModelId);
}

/**
 * Get the current provider version.
 * Increments whenever provider caches are refreshed.
 */
export function getProviderVersion() {
  return providerVersion;
}

/**
 * Force refresh all provider and model caches.
 * Call this after admin changes to providers or models.
 */
export async function forceRefreshProviders() {
  providerClientCache.clear();
  modelCache.clear();
  providerVersion++;
}

// =============================================================================
// Re-exports
// =============================================================================

export { SDK_PROVIDERS };
export { isByokModelId, parseByokModelId } from './byok';
export type { ParsedByokModelId } from './byok';
