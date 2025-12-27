/**
 * BYOK (Bring Your Own Key) Model ID Utilities
 *
 * Handles parsing and formatting of BYOK model IDs.
 *
 * Model ID format: byok:{source_type}:{provider_slug}:{model_id}
 *
 * Source types:
 * - "platform" for platform providers (openai, google, openrouter) with user keys
 * - "custom" for user-defined custom providers
 *
 * Examples:
 * - byok:openai:gpt-4o (platform provider: OpenAI)
 * - byok:openrouter:anthropic/claude-3.5-sonnet (platform provider: OpenRouter)
 * - byok:custom:my-ollama:llama-3.1-70b (custom provider named "my-ollama")
 *
 * For platform providers: byok:{providerId}:{providerModelId}
 * For custom providers: byok:custom:{customProviderSlug}:{providerModelId}
 */

import { SDK_PROVIDERS, type SdkProvider } from './registry';

export const BYOK_PREFIX = 'byok:';
export const BYOK_CUSTOM_SOURCE = 'custom';

export type ByokSourceType = 'platform' | 'custom';

/**
 * Parsed BYOK model ID for a platform provider
 */
export type ByokPlatformModel = {
    sourceType: 'platform';
    providerId: SdkProvider;
    providerModelId: string;
};

/**
 * Parsed BYOK model ID for a custom provider
 */
export type ByokCustomModel = {
    sourceType: 'custom';
    customProviderSlug: string;
    providerModelId: string;
};

export type ParsedByokModelId = ByokPlatformModel | ByokCustomModel;

/**
 * Check if a model ID is a BYOK model
 */
export function isByokModelId(modelId: string): boolean {
    return modelId.startsWith(BYOK_PREFIX);
}

/**
 * Parse a BYOK model ID into its components
 * Returns null if the model ID is not a valid BYOK format
 */
export function parseByokModelId(modelId: string): ParsedByokModelId | null {
    if (!isByokModelId(modelId)) {
        return null;
    }

    const withoutPrefix = modelId.slice(BYOK_PREFIX.length);

    // Check if it's a custom provider: byok:custom:{slug}:{modelId}
    if (withoutPrefix.startsWith(`${BYOK_CUSTOM_SOURCE}:`)) {
        const rest = withoutPrefix.slice(BYOK_CUSTOM_SOURCE.length + 1);
        const colonIndex = rest.indexOf(':');

        if (colonIndex === -1 || colonIndex === 0 || colonIndex === rest.length - 1) {
            return null; // Invalid format
        }

        const customProviderSlug = rest.slice(0, colonIndex);
        const providerModelId = rest.slice(colonIndex + 1);

        return {
            sourceType: 'custom',
            customProviderSlug,
            providerModelId,
        };
    }

    // Platform provider: byok:{providerId}:{modelId}
    const colonIndex = withoutPrefix.indexOf(':');

    if (colonIndex === -1 || colonIndex === 0 || colonIndex === withoutPrefix.length - 1) {
        return null; // Invalid format
    }

    const providerId = withoutPrefix.slice(0, colonIndex);
    const providerModelId = withoutPrefix.slice(colonIndex + 1);

    // Validate provider ID is a known platform provider
    if (!SDK_PROVIDERS.includes(providerId as SdkProvider)) {
        return null;
    }

    return {
        sourceType: 'platform',
        providerId: providerId as SdkProvider,
        providerModelId,
    };
}

/**
 * Format a BYOK model ID from components for a platform provider
 */
export function formatByokPlatformModelId(
    providerId: SdkProvider,
    providerModelId: string
): string {
    return `${BYOK_PREFIX}${providerId}:${providerModelId}`;
}

/**
 * Format a BYOK model ID from components for a custom provider
 */
export function formatByokCustomModelId(
    customProviderSlug: string,
    providerModelId: string
): string {
    return `${BYOK_PREFIX}${BYOK_CUSTOM_SOURCE}:${customProviderSlug}:${providerModelId}`;
}

/**
 * Format a BYOK model ID from parsed components
 */
export function formatByokModelId(parsed: ParsedByokModelId): string {
    if (parsed.sourceType === 'platform') {
        return formatByokPlatformModelId(parsed.providerId, parsed.providerModelId);
    }
    return formatByokCustomModelId(parsed.customProviderSlug, parsed.providerModelId);
}

/**
 * Extract the provider used by a BYOK model.
 * For platform models, returns the platform provider ID.
 * For custom models, returns 'custom'.
 */
export function getByokProvider(modelId: string): string | null {
    const parsed = parseByokModelId(modelId);
    if (!parsed) return null;

    if (parsed.sourceType === 'platform') {
        return parsed.providerId;
    }
    return BYOK_CUSTOM_SOURCE;
}

/**
 * Get a display name for a BYOK model
 */
export function getByokModelDisplayName(
    parsed: ParsedByokModelId,
    customDisplayName?: string
): string {
    if (customDisplayName) {
        return customDisplayName;
    }
    return parsed.providerModelId;
}

/**
 * Validate a custom provider slug
 * Must be lowercase alphanumeric with hyphens, 1-64 chars
 */
export function isValidCustomProviderSlug(slug: string): boolean {
    return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(slug) && !slug.includes('--');
}

/**
 * Validate a provider model ID
 * Generally permissive, but must be non-empty and reasonable length
 */
export function isValidProviderModelId(modelId: string): boolean {
    return (
        typeof modelId === 'string' &&
        modelId.length > 0 &&
        modelId.length <= 256 &&
        modelId.trim() === modelId
    );
}
