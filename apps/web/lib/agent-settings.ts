import type { ChatSettings } from '@/lib/db/schema';
import type { ChatToolId } from '@/lib/ai/tool-ids';
import { normalizeChatToolIds } from '@/lib/ai/tool-ids';
import {
  DEFAULT_AGENT_PROMPT_CONFIG,
  agentPromptConfigIsDefault,
  cloneAgentPromptConfig,
  normalizeAgentPromptConfig,
  type AgentPromptConfig,
} from './agent-prompt';

export interface AgentSettingsValue {
  pinnedEntries: string[];
  allowedTools?: ChatToolId[];
  modelId?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  prompt: AgentPromptConfig;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettingsValue = {
  pinnedEntries: [],
  allowedTools: undefined,
  modelId: undefined,
  reasoningEffort: undefined,
  prompt: cloneAgentPromptConfig(DEFAULT_AGENT_PROMPT_CONFIG),
};

export function cloneAgentSettingsValue(
  value: AgentSettingsValue = DEFAULT_AGENT_SETTINGS
): AgentSettingsValue {
  return {
    pinnedEntries: [...value.pinnedEntries],
    allowedTools: value.allowedTools ? [...value.allowedTools] : undefined,
    modelId: value.modelId,
    reasoningEffort: value.reasoningEffort,
    prompt: cloneAgentPromptConfig(value.prompt),
  };
}

export function normalizePinnedEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const deduped = Array.from(
    new Set(
      raw.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0
      )
    )
  );
  return deduped.slice(0, 12);
}

export function normalizeAllowedTools(raw: unknown): ChatToolId[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const normalized = normalizeChatToolIds(cleaned);
  if (normalized === undefined) return undefined;
  if (normalized.length === 0) return [];
  return normalized.slice(0, 64);
}

export function normalizeModelId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 256);
}

export function normalizeReasoningEffort(
  raw: unknown
): 'low' | 'medium' | 'high' | undefined {
  if (raw === 'low' || raw === 'medium' || raw === 'high') {
    return raw;
  }
  return undefined;
}

export function agentSettingsFromChatSettings(
  settings: ChatSettings | null | undefined
): AgentSettingsValue {
  return {
    pinnedEntries: normalizePinnedEntries(settings?.pinnedEntries ?? []),
    allowedTools: normalizeAllowedTools(settings?.tools?.allow ?? undefined),
    modelId: normalizeModelId(settings?.modelId ?? undefined),
    reasoningEffort: normalizeReasoningEffort(
      settings?.reasoningEffort ?? undefined
    ),
    prompt: normalizeAgentPromptConfig(settings?.prompt),
  };
}

export function agentSettingsToChatSettings(
  value: AgentSettingsValue
): ChatSettings {
  const result: ChatSettings = {};
  result.pinnedEntries = [...value.pinnedEntries];
  if (value.allowedTools !== undefined) {
    result.tools = { allow: [...value.allowedTools] };
  }
  if (value.modelId) {
    result.modelId = value.modelId;
  }
  if (value.reasoningEffort) {
    result.reasoningEffort = value.reasoningEffort;
  }
  if (!agentPromptConfigIsDefault(value.prompt)) {
    result.prompt = normalizeAgentPromptConfig(value.prompt);
  }
  if (!result.pinnedEntries.length) {
    delete result.pinnedEntries;
  }
  if (
    result.tools &&
    result.tools.allow !== undefined &&
    result.tools.allow.length === 0
  ) {
    result.tools = { allow: [] };
  }
  if (result.tools && result.tools.allow === undefined) {
    delete result.tools;
  }
  return result;
}

export function agentSettingsIsDefault(value: AgentSettingsValue): boolean {
  return (
    value.pinnedEntries.length === 0 &&
    value.allowedTools === undefined &&
    value.modelId === undefined &&
    value.reasoningEffort === undefined &&
    agentPromptConfigIsDefault(value.prompt)
  );
}

export function normalizeAgentSettingsPayload(input: unknown): ChatSettings {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const raw = input as Record<string, unknown>;
  const pinnedEntries = normalizePinnedEntries(
    raw.pinnedEntries ?? (raw as any)?.settings?.pinnedEntries
  );
  const allowedTools = normalizeAllowedTools(
    raw.allowedTools ??
      (raw as any)?.settings?.allowedTools ??
      (raw as any)?.tools?.allow
  );
  const modelId = normalizeModelId(
    raw.modelId ?? (raw as any)?.settings?.modelId
  );
  const reasoningEffort = normalizeReasoningEffort(
    raw.reasoningEffort ?? (raw as any)?.settings?.reasoningEffort
  );
  const prompt = normalizeAgentPromptConfig(
    raw.prompt ?? (raw as any)?.settings?.prompt
  );
  const settings: ChatSettings = {};
  if (pinnedEntries.length) settings.pinnedEntries = pinnedEntries;
  if (allowedTools !== undefined) settings.tools = { allow: allowedTools };
  if (modelId) settings.modelId = modelId;
  if (reasoningEffort) settings.reasoningEffort = reasoningEffort;
  if (!agentPromptConfigIsDefault(prompt)) settings.prompt = prompt;
  return settings;
}
