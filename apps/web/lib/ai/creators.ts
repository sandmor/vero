/**
 * Model Creators Registry
 *
 * Centralized registry for model creators (companies/organizations that create AI models).
 * This separates the concept of "creator" (who made the model) from "provider" (which API serves it).
 *
 * Examples:
 * - OpenAI is both a creator AND a provider (they make and serve their own models)
 * - Anthropic is a creator, but their models are served through OpenRouter provider
 * - Meta is a creator (Llama models), but models are served through various providers
 */

// Known creator slugs - these are canonical identifiers
export const KNOWN_CREATORS = [
  'openai',
  'google',
  'anthropic',
  'meta',
  'mistral',
  'deepseek',
  'cohere',
  'nvidia',
  'alibaba',
  'xai',
  'zai',
] as const;

export type KnownCreator = (typeof KNOWN_CREATORS)[number];

/**
 * Creator metadata - contains display information for known creators
 */
export type CreatorInfo = {
  /** Canonical slug identifier */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Whether this creator has a custom logo icon */
  hasLogo: boolean;
  /** Optional website URL */
  website?: string;
};

/**
 * Registry of known creators with their metadata
 * This is the single source of truth for creator display names and info
 */
const CREATOR_REGISTRY: Record<string, CreatorInfo> = {
  openai: {
    slug: 'openai',
    name: 'OpenAI',
    hasLogo: true,
    website: 'https://openai.com',
  },
  google: {
    slug: 'google',
    name: 'Google',
    hasLogo: true,
    website: 'https://ai.google.dev',
  },
  anthropic: {
    slug: 'anthropic',
    name: 'Anthropic',
    hasLogo: true,
    website: 'https://anthropic.com',
  },
  meta: {
    slug: 'meta',
    name: 'Meta',
    hasLogo: true,
    website: 'https://ai.meta.com',
  },
  'meta-llama': {
    slug: 'meta-llama',
    name: 'Meta',
    hasLogo: true,
    website: 'https://ai.meta.com',
  },
  mistral: {
    slug: 'mistral',
    name: 'Mistral AI',
    hasLogo: true,
    website: 'https://mistral.ai',
  },
  mistralai: {
    slug: 'mistralai',
    name: 'Mistral AI',
    hasLogo: true,
    website: 'https://mistral.ai',
  },
  deepseek: {
    slug: 'deepseek',
    name: 'DeepSeek',
    hasLogo: true,
    website: 'https://deepseek.com',
  },
  cohere: {
    slug: 'cohere',
    name: 'Cohere',
    hasLogo: true,
    website: 'https://cohere.com',
  },
  nvidia: {
    slug: 'nvidia',
    name: 'NVIDIA',
    hasLogo: true,
    website: 'https://www.nvidia.com/en-us/ai/',
  },
  alibaba: {
    slug: 'alibaba',
    name: 'Alibaba',
    hasLogo: true,
    website: 'https://www.alibabacloud.com/product/tongyi-lingma',
  },
  qwen: {
    slug: 'qwen',
    name: 'Qwen (Alibaba)',
    hasLogo: true,
    website: 'https://qwenlm.github.io',
  },
  xai: {
    slug: 'xai',
    name: 'xAI',
    hasLogo: true,
    website: 'https://x.ai',
  },
  'x-ai': {
    slug: 'x-ai',
    name: 'xAI',
    hasLogo: true,
    website: 'https://x.ai',
  },
  zai: {
    slug: 'zai',
    name: 'Z.ai',
    hasLogo: true,
    website: 'https://z.ai',
  },
  'z-ai': {
    slug: 'z-ai',
    name: 'Z.ai',
    hasLogo: true,
    website: 'https://z.ai',
  },
};

/**
 * Normalize a creator slug by handling common variations
 */
export function normalizeCreatorSlug(slug: string): string {
  const normalized = slug.toLowerCase().trim();

  // Handle common slug variations that should map to the same creator
  const aliases: Record<string, string> = {
    'meta-llama': 'meta',
    mistralai: 'mistral',
    'x-ai': 'xai',
    'z-ai': 'zai',
    nousresearch: 'nous',
    qwen: 'alibaba',
  };

  return aliases[normalized] ?? normalized;
}

/**
 * Get creator info by slug
 * Returns info for known creators, or generates fallback info for unknown ones
 */
export function getCreatorInfo(slug: string): CreatorInfo {
  const normalizedSlug = slug.toLowerCase().trim();

  // Check registry first
  const registered = CREATOR_REGISTRY[normalizedSlug];
  if (registered) {
    return registered;
  }

  // Generate fallback for unknown creators
  return {
    slug: normalizedSlug,
    name: formatUnknownCreatorName(normalizedSlug),
    hasLogo: false,
  };
}

/**
 * Format an unknown creator slug into a display name
 * e.g., "my-cool-ai" -> "My Cool Ai"
 */
function formatUnknownCreatorName(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      // Keep common acronyms uppercase
      if (word.length <= 3 && /^[a-z]+$/i.test(word)) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Get the display name for a creator
 */
export function displayCreatorName(slug: string): string {
  return getCreatorInfo(slug).name;
}

/**
 * Check if a creator has a custom logo
 */
export function hasCreatorLogo(slug: string): boolean {
  return getCreatorInfo(slug).hasLogo;
}

/**
 * Extract creator slug from an OpenRouter model slug
 * OpenRouter slugs follow the pattern: "{creator}/{model}"
 *
 * @param openRouterSlug - The OpenRouter model slug (e.g., "anthropic/claude-3.5-sonnet")
 * @returns The creator slug (e.g., "anthropic")
 */
export function extractCreatorFromOpenRouterSlug(
  openRouterSlug: string
): string {
  const slashIndex = openRouterSlug.indexOf('/');
  if (slashIndex === -1) {
    // No slash found - this might be a malformed slug, return as-is
    return openRouterSlug;
  }
  return openRouterSlug.slice(0, slashIndex);
}

/**
 * Extract the model name part from an OpenRouter model slug
 *
 * @param openRouterSlug - The OpenRouter model slug (e.g., "anthropic/claude-3.5-sonnet")
 * @returns The model name (e.g., "claude-3.5-sonnet")
 */
export function extractModelFromOpenRouterSlug(openRouterSlug: string): string {
  const slashIndex = openRouterSlug.indexOf('/');
  if (slashIndex === -1) {
    return openRouterSlug;
  }
  return openRouterSlug.slice(slashIndex + 1);
}

/**
 * Derive creator from provider and model slug
 *
 * For direct providers (OpenAI, Google), the creator is the same as the provider.
 * For aggregators like OpenRouter, the creator is extracted from the model slug.
 *
 * NOTE: The core provider logic is centralized in lib/ai/registry.ts
 * This function uses isAggregatorProvider from the registry.
 */
export function deriveCreator(provider: string, modelSlug: string): string {
  // Import dynamically to avoid circular dependency
  // The registry imports this file's types, so we can't import at module level
  const { isAggregatorProvider } = require('./registry');

  // For aggregators like OpenRouter, extract creator from slug
  if (isAggregatorProvider(provider)) {
    return extractCreatorFromOpenRouterSlug(modelSlug);
  }

  // For other providers (e.g., openai, google), try to extract from slug if it has a slash
  if (modelSlug.includes('/')) {
    return extractCreatorFromOpenRouterSlug(modelSlug);
  }

  // For direct providers, creator equals provider
  return provider;
}

/**
 * Get all known creators
 */
export function getAllKnownCreators(): CreatorInfo[] {
  // Deduplicate by normalized slug to avoid listing aliases
  const seen = new Set<string>();
  const creators: CreatorInfo[] = [];

  for (const info of Object.values(CREATOR_REGISTRY)) {
    const normalized = normalizeCreatorSlug(info.slug);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      creators.push(info);
    }
  }

  return creators.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a creator slug is a known creator
 */
export function isKnownCreator(slug: string): boolean {
  const normalized = slug.toLowerCase().trim();
  return normalized in CREATOR_REGISTRY;
}
