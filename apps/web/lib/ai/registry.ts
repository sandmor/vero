/**
 * Provider Registry
 *
 * Centralized registry for AI providers (API endpoints that serve models).
 * This is separate from creators (who made the models) - see creators.ts.
 *
 * Providers are the API endpoints used to make inference calls:
 * - openai: Direct OpenAI API
 * - google: Google AI / Gemini API
 * - openrouter: OpenRouter aggregator (serves models from many creators)
 *
 * Future: This registry can be extended to support user-defined custom providers.
 */

export type ProviderInfo = {
  /** Canonical provider ID */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Whether this provider supports BYOK (Bring Your Own Key) */
  supportsByok: boolean;
  /** Whether this is an aggregator that serves models from multiple creators */
  isAggregator: boolean;
  /** Optional website URL */
  website?: string;
  /** Optional description */
  description?: string;
};

/**
 * Built-in provider registry
 * These are the core supported providers shipped with the application.
 */
const PROVIDER_REGISTRY: Record<string, ProviderInfo> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    supportsByok: true,
    isAggregator: true,
    website: 'https://openrouter.ai',
    description: 'Access models from multiple providers through a single API',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    supportsByok: true,
    isAggregator: false,
    website: 'https://openai.com',
    description: 'Direct access to OpenAI models like GPT-4 and GPT-5',
  },
  google: {
    id: 'google',
    name: 'Google',
    supportsByok: true,
    isAggregator: false,
    website: 'https://ai.google.dev',
    description: 'Google AI / Gemini models',
  },
};

/** List of supported provider IDs (order matters for UI) */
export const SUPPORTED_PROVIDERS = ['openrouter', 'openai', 'google'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/** Providers that support BYOK */
export const BYOK_PROVIDERS = SUPPORTED_PROVIDERS.filter(
  (id) => PROVIDER_REGISTRY[id]?.supportsByok
);

/** Aggregator providers (serve models from multiple creators) */
export const AGGREGATOR_PROVIDERS = SUPPORTED_PROVIDERS.filter(
  (id) => PROVIDER_REGISTRY[id]?.isAggregator
);

/**
 * Get provider info by ID
 * Returns info for known providers, or generates fallback for unknown ones
 */
export function getProviderInfo(id: string): ProviderInfo {
  const registered = PROVIDER_REGISTRY[id];
  if (registered) {
    return registered;
  }

  // Generate fallback for unknown providers (future: custom providers)
  return {
    id,
    name: formatUnknownProviderName(id),
    supportsByok: false,
    isAggregator: false,
  };
}

/**
 * Format an unknown provider ID into a display name
 */
function formatUnknownProviderName(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 3 && /^[a-z]+$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Get the display name for a provider
 */
export function displayProviderName(id: string): string {
  return getProviderInfo(id).name;
}

/**
 * Check if a provider is a known/supported provider
 */
export function isKnownProvider(id: string): boolean {
  return id in PROVIDER_REGISTRY;
}

/**
 * Check if a provider supports BYOK
 */
export function providerSupportsByok(id: string): boolean {
  return getProviderInfo(id).supportsByok;
}

/**
 * Check if a provider is an aggregator
 */
export function isAggregatorProvider(id: string): boolean {
  return getProviderInfo(id).isAggregator;
}

/**
 * Get all registered providers
 */
export function getAllProviders(): ProviderInfo[] {
  return SUPPORTED_PROVIDERS.map((id) => PROVIDER_REGISTRY[id]);
}
