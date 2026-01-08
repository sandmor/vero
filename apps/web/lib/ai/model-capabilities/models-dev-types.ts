/**
 * Models.dev API Types
 *
 * Type definitions for the models.dev API response.
 * Source: https://models.dev/api.json
 *
 * Models.dev is a community-maintained registry of AI model information
 * that provides up-to-date details about models from various providers.
 *
 * NOTE: Provider configuration (which providers use models.dev, provider ID mappings)
 * is centralized in lib/ai/registry.ts - this file only contains API types.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Modalities for model input/output
 */
export type ModelsDevModality = 'text' | 'image' | 'audio' | 'video';

/**
 * Modality configuration for a model
 */
export type ModelsDevModalities = {
  input: ModelsDevModality[];
  output: ('text' | 'audio')[];
};

/**
 * Cost information per million tokens (or per unit for images/audio)
 */
export type ModelsDevCost = {
  input?: number; // Cost per 1M input tokens
  output?: number; // Cost per 1M output tokens
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
  input_audio?: number;
  output_audio?: number;
};

/**
 * Token limits for a model
 */
export type ModelsDevLimit = {
  context: number; // Maximum context window size
  output?: number; // Maximum output tokens
};

/**
 * Interleaved content configuration
 */
export type ModelsDevInterleaved = {
  field?: string;
};

/**
 * Model definition from models.dev
 */
export type ModelsDevModel = {
  id: string;
  name: string;
  family: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  interleaved?: ModelsDevInterleaved;
  knowledge?: string; // Date pattern: YYYY, YYYY-MM, or YYYY-MM-DD
  release_date?: string;
  last_updated?: string;
  modalities: ModelsDevModalities;
  open_weights?: boolean;
  cost?: ModelsDevCost;
  limit: ModelsDevLimit;
};

/**
 * Provider definition from models.dev
 */
export type ModelsDevProvider = {
  id: string;
  name: string;
  env?: string[]; // Environment variables required
  npm?: string; // Associated NPM package
  api?: string; // Base API URL
  doc?: string; // Documentation URL
  models: Record<string, ModelsDevModel>;
};

/**
 * The full models.dev API response
 * This is a dictionary mapping provider IDs to provider objects
 */
export type ModelsDevCatalog = Record<string, ModelsDevProvider>;
