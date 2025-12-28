import type { ModelFormat } from './model-capabilities';

// Define defaults for each supported provider to ensure a safe fallback
// when a specific DEFAULT_CHAT_MODEL is not configured.
export const PROVIDER_DEFAULTS = {
  google: 'google:gemini-2.5-flash',
  openai: 'openai:gpt-5.1',
  openrouter: 'anthropic:claude-sonnet-4.5',
  xai: 'xai:grok-4-1-fast-reasoning',
} as const;

function resolveDefaultChatModel() {
  // 1. Explicit override
  if (process.env.DEFAULT_CHAT_MODEL) return process.env.DEFAULT_CHAT_MODEL;

  // 2. Auto-detect based on available API keys (Server-side only detection)
  // We check environment variables directly to avoid circular dependencies with provider-keys.ts
  const hasGoogle =
    !!process.env.GOOGLE_API_KEY || !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasXai = !!process.env.XAI_API_KEY;

  if (hasGoogle) return PROVIDER_DEFAULTS.google;
  if (hasOpenAI) return PROVIDER_DEFAULTS.openai;
  if (hasOpenRouter) return PROVIDER_DEFAULTS.openrouter;
  if (hasXai) return PROVIDER_DEFAULTS.xai;

  // 3. Ultimate fallback (Google was the original default)
  return PROVIDER_DEFAULTS.google;
}

export const DEFAULT_CHAT_MODEL = resolveDefaultChatModel();

export const TITLE_GENERATION_MODEL =
  process.env.TITLE_GENERATION_MODEL ?? DEFAULT_CHAT_MODEL;
export const ARTIFACT_GENERATION_MODEL =
  process.env.ARTIFACT_GENERATION_MODEL ?? DEFAULT_CHAT_MODEL;

export type ChatModel = {
  id: string; // composite id creator:model
  creator: string; // Model creator (openai, google, anthropic, meta, etc.)
  model: string; // creator-specific model slug used in SDK calls
  name: string; // human readable name
  description?: string; // optional
};

export type ChatModelCapabilitiesSummary = {
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
};

export type ChatModelOption = ChatModel & {
  capabilities: ChatModelCapabilitiesSummary | null;
  isBYOK?: boolean;
};

export function isModelIdAllowed(
  selectedId: string,
  allowedIds: string[]
): boolean {
  return allowedIds.includes(selectedId);
}
