export const SUPPORTED_PROVIDERS = ['openrouter', 'openai', 'google'] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// Centralized friendly display names for providers (avoid duplicating across components)
export function displayProviderName(id: string): string {
  switch (id) {
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google';
    case 'openrouter':
      return 'OpenRouter';
    default:
      return id.charAt(0).toUpperCase() + id.slice(1);
  }
}
