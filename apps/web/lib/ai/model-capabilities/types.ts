/**
 * Model Capabilities Type Definitions
 */

export type ModelFormat = 'text' | 'image' | 'file' | 'audio' | 'video';

export type ModelPricing = {
  prompt?: number; // Cost per million input tokens
  completion?: number; // Cost per million output tokens
  image?: number; // Cost per image generated
  reasoning?: number; // Cost per million reasoning tokens
  cacheRead?: number; // Cost per million cache read tokens
  cacheWrite?: number; // Cost per million cache write tokens
};

/**
 * A provider association for a model
 */
export type ModelProviderAssociation = {
  id: string;
  providerId: string;
  providerModelId: string;
  pricing: ModelPricing | null;
  isDefault: boolean;
  enabled: boolean;
  /** Optional: ID of a custom platform provider to route through */
  customPlatformProviderId?: string | null;
  /** Display name of the custom provider (populated when fetching) */
  customProviderName?: string;
};

/**
 * Core model capabilities (the conceptual model)
 */
export type ModelCapabilities = {
  id: string; // composite id (creator:model_name) e.g., "anthropic:claude-sonnet-4.5"
  name: string;
  creator: string; // The model creator/organization
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  maxOutputTokens: number | null; // Optional override for max output tokens
  createdAt: Date;
  updatedAt: Date;
  // Provider associations
  providers: ModelProviderAssociation[];
};

/**
 * Flattened view of a model with a specific provider (for API calls)
 */
export type ResolvedModelCapabilities = {
  id: string;
  name: string;
  creator: string;
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  maxOutputTokens: number | null;
  // The resolved provider for this request
  provider: string;
  providerModelId: string;
  pricing: ModelPricing | null;
};

/**
 * Model with admin management metadata
 */
export type ManagedModelCapabilities = ModelCapabilities & {
  isPersisted: boolean;
  inUse: boolean;
  /** Whether this model can be added to tiers (has at least one provider) */
  canBeInTier?: boolean;
};

/**
 * Catalog entry from provider sync
 */
export type CatalogEntry = {
  id: string;
  providerId: string;
  providerModelId: string;
  suggestedModelId: string | null;
  suggestedName: string | null;
  suggestedCreator: string | null;
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  pricing: ModelPricing | null;
  lastSynced: Date;
};
