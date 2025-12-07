import type { ModelFormat } from './model-capabilities';

// Define defaults for each supported provider to ensure a safe fallback
// when a specific DEFAULT_CHAT_MODEL is not configured.
export const PROVIDER_DEFAULTS = {
  google: 'google:gemini-2.5-flash',
  openai: 'openai:gpt-5.1',
  openrouter: 'anthropic/claude-sonnet-4.5',
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

  if (hasGoogle) return PROVIDER_DEFAULTS.google;
  if (hasOpenAI) return PROVIDER_DEFAULTS.openai;
  if (hasOpenRouter) return PROVIDER_DEFAULTS.openrouter;

  // 3. Ultimate fallback (Google was the original default)
  return PROVIDER_DEFAULTS.google;
}

export const DEFAULT_CHAT_MODEL = resolveDefaultChatModel();

export const TITLE_GENERATION_MODEL =
  process.env.TITLE_GENERATION_MODEL ?? DEFAULT_CHAT_MODEL;
export const ARTIFACT_GENERATION_MODEL =
  process.env.ARTIFACT_GENERATION_MODEL ?? DEFAULT_CHAT_MODEL;

export type ChatModel = {
  id: string; // composite id provider:model
  provider: string;
  model: string; // provider-specific model slug used in SDK calls
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

export function buildCompositeModelId(provider: string, model: string) {
  return `${provider}:${model}`;
}

export function parseCompositeModelId(id: string): {
  provider: string;
  model: string;
} {
  const idx = id.indexOf(':');
  if (idx === -1) {
    return { provider: 'openrouter', model: id };
  }
  return { provider: id.slice(0, idx), model: id.slice(idx + 1) };
}

export function isModelIdAllowed(
  selectedId: string,
  allowedIds: string[]
): boolean {
  return allowedIds.includes(selectedId);
}

// Curated metadata for a *small* set of popular models; absence falls back to automatic derivation.
// Curated metadata keyed by composite id
const curated: Record<string, { name: string; description?: string }> = {
  [PROVIDER_DEFAULTS.google]: {
    name: 'Gemini 2.5 Flash',
    description: 'Balanced speed + quality multimodal generation',
  },
  'google:gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image Preview',
    description:
      'Fast multimodal (image+text) with lightweight image preview support',
  },
  'google:gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description:
      'Higher capability Gemini 2.5 for complex reasoning & synthesis',
  },
  [PROVIDER_DEFAULTS.openai]: {
    name: 'GPT-5.1',
    description: 'OpenAI flagship multimodal model',
  },
  [PROVIDER_DEFAULTS.openrouter]: {
    name: 'Sonnet 4.5',
    description: 'Fast multimodal model by Anthropic via OpenRouter',
  },
};

// When we lack curated metadata, derive a display name heuristically from the slug.
export function deriveChatModel(id: string): ChatModel {
  const { provider, model } = parseCompositeModelId(id);
  const existing = curated[id];
  if (existing) return { id, provider, model, ...existing };
  // heuristic: take last path after '/', replace separators
  const lastSegment = model.split('/').slice(-1)[0];
  const base = lastSegment.replace(/[:]/g, ' ');
  const words = base.split(/[-_]/).filter(Boolean);
  const name = words
    .map((w) =>
      w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)
    )
    .join(' ');
  return { id, provider, model, name, description: model };
}

// Export a small known set matching entitlements so existing UI/tests still enumerate choices.
export const KNOWN_CHAT_MODEL_IDS: string[] = Object.keys(curated);
export const chatModels: ChatModel[] =
  KNOWN_CHAT_MODEL_IDS.map(deriveChatModel);

export function getChatModelsByIds(ids: string[]): ChatModel[] {
  return ids.map(deriveChatModel);
}
