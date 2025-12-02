import type { ModelFormat } from './model-capabilities';

export const DEFAULT_CHAT_MODEL = 'google:gemini-2.5-flash';

export const TITLE_GENERATION_MODEL =
  process.env.TITLE_GENERATION_MODEL ?? 'google:gemini-2.5-flash';
export const ARTIFACT_GENERATION_MODEL =
  process.env.ARTIFACT_GENERATION_MODEL ?? 'google:gemini-2.5-flash';

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
  'openai:gpt-5': {
    name: 'GPT-5',
    description:
      'OpenAI frontier model for high reasoning & multilingual coding tasks',
  },
  'google:gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image Preview',
    description:
      'Fast multimodal (image+text) with lightweight image preview support',
  },
  'google:gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    description: 'Balanced speed + quality multimodal generation',
  },
  'google:gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro',
    description:
      'Higher capability Gemini 2.5 for complex reasoning & synthesis',
  },
  'openrouter:x-ai/grok-4': {
    name: 'Grok 4',
    description:
      'xAI flagship: advanced long‑context reasoning & multimodal understanding',
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
