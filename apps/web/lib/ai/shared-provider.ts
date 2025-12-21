/**
 * Shared Provider Utilities
 *
 * Common utilities for provider validation and factory creation,
 * used by both platform custom providers and user BYOK providers.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * Validate a provider slug format.
 * Must be non-empty, lowercase alphanumeric with hyphens, 1-64 chars.
 */
export function isValidProviderSlug(slug: string): boolean {
  if (!slug || slug.length === 0 || slug.length > 64) {
    return false;
  }
  // Allow lowercase alphanumeric and hyphens, no consecutive hyphens
  return (
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug) && !slug.includes('--')
  );
}

/**
 * Validate a model slug format.
 * Must be non-empty and reasonable length (1-256 chars).
 * Typically follows {creator}:{model} format but this is not enforced.
 */
export function isValidModelSlug(slug: string): boolean {
  if (!slug || typeof slug !== 'string') {
    return false;
  }
  const trimmed = slug.trim();
  return trimmed.length > 0 && trimmed.length <= 256 && trimmed === slug;
}

/**
 * Validate a provider model ID (the ID used by the provider's API).
 * Must be non-empty and reasonable length.
 */
export function isValidProviderModelId(modelId: string): boolean {
  if (!modelId || typeof modelId !== 'string') {
    return false;
  }
  return (
    modelId.length > 0 && modelId.length <= 256 && modelId.trim() === modelId
  );
}

/**
 * Validate a base URL for OpenAI-compatible endpoints.
 */
export function isValidBaseUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Build an OpenAI-compatible provider client.
 * Used for both platform custom providers and user custom providers.
 */
export function buildOpenAICompatibleClient(
  name: string,
  apiKey: string,
  baseUrl: string
) {
  return createOpenAICompatible({
    name,
    apiKey: apiKey || '',
    baseURL: baseUrl,
    includeUsage: true,
  });
}

/**
 * Provider configuration for building clients.
 */
export type CustomProviderConfig = {
  slug: string;
  name: string;
  baseUrl: string;
  apiKey?: string | null;
};

/**
 * Build a language model factory from a custom provider configuration.
 * Returns a function that takes a model ID and returns the language model.
 */
export function buildCustomProviderFactory(config: CustomProviderConfig) {
  const client = buildOpenAICompatibleClient(
    config.slug,
    config.apiKey || '',
    config.baseUrl
  );
  return (modelId: string) => client(modelId);
}
