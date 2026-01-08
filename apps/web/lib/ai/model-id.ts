/**
 * Model ID Utilities
 *
 * Pure utility functions for parsing and building model IDs.
 * This file is safe to import from client components (no server dependencies).
 *
 * Model ID format: {creator}:{model_name}
 * Examples:
 *   - anthropic:claude-sonnet-4.5
 *   - openai:gpt-5.1
 *   - google:gemini-2.5-flash
 */

/**
 * Build a model ID from creator and model name
 */
export function buildModelId(creator: string, modelName: string): string {
  return `${creator}:${modelName}`;
}

/**
 * Parse a model ID into creator and model name
 * Returns null if the ID is invalid (no colon separator)
 */
export function parseModelId(
  id: string
): { creator: string; modelName: string } | null {
  const colonIndex = id.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }
  return {
    creator: id.slice(0, colonIndex),
    modelName: id.slice(colonIndex + 1),
  };
}

/**
 * Extract the model name from a model ID
 * Returns the full ID if no colon is found
 */
export function getModelName(id: string): string {
  const parsed = parseModelId(id);
  return parsed?.modelName ?? id;
}

/**
 * Extract the creator from a model ID
 * Returns null if no colon is found
 */
export function getCreator(id: string): string | null {
  const parsed = parseModelId(id);
  return parsed?.creator ?? null;
}
