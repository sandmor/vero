/**
 * OpenRouter Sync Operations
 */

import type { CatalogEntry, ModelFormat, ModelPricing } from './types';
import { upsertCatalogEntry, deleteCatalogEntriesForProvider } from './catalog';
import {
  mapModalityToFormat,
  sortFormats,
  generateFriendlyModelName,
} from './utils';
import {
  extractCreatorFromOpenRouterSlug,
  extractModelFromOpenRouterSlug,
} from '../creators';

// ============================================================================
// OpenRouter API Types
// ============================================================================

export type OpenRouterModel = {
  id: string;
  name: string;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
    image?: string | number;
    request?: string | number;
  };
};

export type OpenRouterModelsResponse = {
  data: OpenRouterModel[];
};

// ============================================================================
// OpenRouter Sync Functions
// ============================================================================

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
 * Parse OpenRouter model to catalog entry format
 */
export function parseOpenRouterCapabilities(
  model: OpenRouterModel,
  providerId: string = 'openrouter'
): Omit<CatalogEntry, 'id' | 'lastSynced'> {
  const supportsTools =
    model.supported_parameters?.some(
      (param) =>
        param === 'tools' || param === 'tool_choice' || param === 'functions'
    ) ?? false;

  const formats = new Set<ModelFormat>(['text']);
  if (model.architecture?.input_modalities) {
    for (const modality of model.architecture.input_modalities) {
      const format = mapModalityToFormat(modality);
      if (format) formats.add(format);
    }
  }

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

  const creator = extractCreatorFromOpenRouterSlug(model.id);
  const rawModelName = extractModelFromOpenRouterSlug(model.id);
  const modelName = generateFriendlyModelName(rawModelName);
  const suggestedModelId = `${creator}:${modelName}`;

  return {
    providerId,
    providerModelId: model.id,
    suggestedModelId,
    suggestedName: model.name,
    suggestedCreator: creator,
    supportsTools,
    supportedFormats: sortFormats(formats),
    pricing,
  };
}

/**
 * Sync OpenRouter models to catalog (informational only)
 * Also removes stale entries that are no longer available from OpenRouter.
 */
export async function syncOpenRouterCatalog(): Promise<{
  synced: number;
  removed: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;
  let removed = 0;
  const syncedModelIds = new Set<string>();

  try {
    const models = await fetchOpenRouterModels();

    for (const model of models) {
      try {
        const entry = parseOpenRouterCapabilities(model);
        await upsertCatalogEntry(entry);
        syncedModelIds.add(model.id);
        synced++;
      } catch (error) {
        errors.push(
          `${model.id}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    // Remove stale entries for OpenRouter that are no longer in the API response
    if (syncedModelIds.size > 0) {
      removed = await deleteCatalogEntriesForProvider(
        'openrouter',
        syncedModelIds
      );
    }
  } catch (error) {
    errors.push(
      `OpenRouter API: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  return { synced, removed, errors };
}
