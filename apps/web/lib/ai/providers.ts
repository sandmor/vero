import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { isTestEnvironment } from '../constants';
import { parseCompositeModelId } from './models';
import { getProviderApiKey } from './provider-keys';
import { SUPPORTED_PROVIDERS } from './registry';

const TTL_MS = 60_000;
let providerVersion = 0; // increments each rebuild

type ProviderClientEntry = {
  factory: (model: string) => any;
  apiKey: string | undefined;
  fetchedAt: number;
};

const providerClientCache = new Map<string, ProviderClientEntry>();

function buildProviderFactory(provider: string, apiKey?: string) {
  switch (provider) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: apiKey ?? '',
        extraBody: { include_reasoning: true },
      });
    case 'openai':
      return createOpenAI({ apiKey });
    case 'google':
      return createGoogleGenerativeAI({ apiKey });
    default:
      throw new Error(`Unsupported provider '${provider}'`);
  }
}

async function getProviderClient(
  provider: string
): Promise<(model: string) => any> {
  const existing = providerClientCache.get(provider);
  const now = Date.now();
  if (existing && now - existing.fetchedAt < TTL_MS) {
    return existing.factory;
  }
  const apiKey = await getProviderApiKey(provider); // undefined -> fallback to env inside SDK
  const factory = buildProviderFactory(provider, apiKey);
  providerClientCache.set(provider, { factory, apiKey, fetchedAt: now });
  providerVersion++; // bump version whenever any provider refreshes
  return factory;
}

async function resolveLanguageModel(compositeId: string) {
  const { provider, model } = parseCompositeModelId(compositeId);
  const client = await getProviderClient(provider);
  return client(model);
}

// Curated model IDs surfaced in UI / entitlements.
const KNOWN_MODEL_IDS = [
  'openai:gpt-5.1',
  'google:gemini-2.5-flash-image-preview',
  'google:gemini-2.5-flash',
  'google:gemini-2.5-pro',
];

let modelsCache: Record<string, any> | null = null;
let modelsFetchedAt = 0;
let modelsBuildPromise: Promise<Record<string, any>> | null = null;
const DYNAMIC_MODEL_CACHE_TTL_MS = 10 * 60_000; // 10 minutes for dynamically resolved models
let dynamicModelsCache: Record<string, { model: any; fetchedAt: number }> = {};

async function buildModels(): Promise<Record<string, any>> {
  if (isTestEnvironment) {
    const { chatModel, reasoningModel } = require('./models.mock');
    return {
      'openai:gpt-5.1': reasoningModel,
      'google:gemini-2.5-flash-image-preview': reasoningModel,
      'google:gemini-2.5-flash': reasoningModel,
      'google:gemini-2.5-pro': reasoningModel,
    } as Record<string, any>;
  }
  const entries = await Promise.all(
    KNOWN_MODEL_IDS.map(
      async (id) => [id, await resolveLanguageModel(id)] as const
    )
  );
  return Object.fromEntries(entries);
}

async function ensureModelsFresh(): Promise<Record<string, any>> {
  const now = Date.now();
  if (modelsCache && now - modelsFetchedAt < TTL_MS) return modelsCache;
  if (!modelsBuildPromise) {
    modelsBuildPromise = buildModels()
      .then((m) => {
        modelsCache = m;
        modelsFetchedAt = Date.now();
        return m;
      })
      .finally(() => {
        modelsBuildPromise = null;
      });
  }
  return modelsBuildPromise;
}
// Async accessors.
export async function getLanguageModel(id: string) {
  const map = await ensureModelsFresh();
  let model = map[id];
  if (model) return model;
  // On-demand resolution for arbitrary composite IDs (e.g., 'openrouter:openai/gpt-5').
  const cached = dynamicModelsCache[id];
  const now = Date.now();
  if (cached && now - cached.fetchedAt < DYNAMIC_MODEL_CACHE_TTL_MS) {
    return cached.model;
  }
  model = await resolveLanguageModel(id);
  dynamicModelsCache[id] = { model, fetchedAt: now };
  return model;
}

export async function getLanguageModelWithKey(id: string, apiKey: string) {
  const { provider, model } = parseCompositeModelId(id);
  const factory = buildProviderFactory(provider, apiKey);
  return factory(model);
}

export async function listLanguageModels() {
  const map = await ensureModelsFresh();
  return Object.keys(map);
}

export type RegisteredModelId = string;

export function getProviderVersion() {
  return providerVersion;
}

export async function forceRefreshProviders() {
  // Clear caches so next access rebuilds
  providerClientCache.clear();
  modelsCache = null;
  modelsFetchedAt = 0;
  dynamicModelsCache = {};
  providerVersion++;
}

// Centralized provider registry used across the app (UI, admin, etc.)
export { SUPPORTED_PROVIDERS };
