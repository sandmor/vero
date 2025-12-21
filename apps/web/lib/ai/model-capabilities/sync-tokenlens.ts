/**
 * TokenLens Sync Operations
 */

import type { ProviderModel } from 'tokenlens/core';
import type { CatalogEntry, ModelFormat, ModelPricing } from './types';
import { upsertCatalogEntry } from './catalog';
import {
    mapModalityToFormat,
    sortFormats,
    generateFriendlyModelName,
} from './utils';
import { deriveCreator, extractModelFromOpenRouterSlug } from '../creators';

// ============================================================================
// TokenLens Parsing Helpers
// ============================================================================

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

// ============================================================================
// TokenLens Sync Functions
// ============================================================================

/**
 * Sync TokenLens provider catalog
 */
export async function syncTokenLensCatalog(
    providerId: string
): Promise<{ synced: number; errors: string[] }> {
    const errors: string[] = [];
    let synced = 0;

    try {
        const { fetchModels } = await import('tokenlens/fetch');
        const providerInfo = await fetchModels(providerId);

        if (!providerInfo) {
            errors.push(`Provider '${providerId}' not found in TokenLens`);
            return { synced, errors };
        }

        const models = providerInfo.models ?? {};

        for (const [modelKey, model] of Object.entries(models)) {
            try {
                const creator = deriveCreator(providerId, modelKey);
                const modelName = generateFriendlyModelName(
                    modelKey.includes('/')
                        ? extractModelFromOpenRouterSlug(modelKey)
                        : modelKey
                );
                const suggestedModelId = `${creator}:${modelName}`;

                const entry: Omit<CatalogEntry, 'id' | 'lastSynced'> = {
                    providerId,
                    providerModelId: modelKey,
                    suggestedModelId,
                    suggestedName: model.name ?? modelKey,
                    suggestedCreator: creator,
                    supportsTools: Boolean(model.tool_call),
                    supportedFormats: sortFormats(deriveTokenLensFormats(model)),
                    pricing: normalizeTokenLensPricing(model),
                };

                await upsertCatalogEntry(entry);
                synced++;
            } catch (error) {
                errors.push(
                    `${modelKey}: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }
    } catch (error) {
        errors.push(
            `TokenLens: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    return { synced, errors };
}
