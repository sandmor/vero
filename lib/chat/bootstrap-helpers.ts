import type { ChatSettings, Agent } from '@/lib/db/schema';
import type { AgentPreset } from '@/types/agent';
import { DEFAULT_CHAT_MODEL, isModelIdAllowed } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';

/**
 * Maps a database agent record to the AgentPreset type for client consumption.
 */
export function mapAgentToPreset(
  agent: Pick<Agent, 'id' | 'name' | 'description' | 'settings'> | null
): AgentPreset | null {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    settings: agent.settings,
  };
}

export function buildInitialSettings(
  base: ChatSettings | null,
  reasoningEffort?: 'low' | 'medium' | 'high' | null
): ChatSettings | null {
  if (!base && !reasoningEffort) return null;
  const settings: ChatSettings = { ...(base ?? {}) };
  if (reasoningEffort) {
    settings.reasoningEffort = reasoningEffort;
  } else {
    delete settings.reasoningEffort;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

export function resolveInitialModel({
  allowedModelIds,
  chatSettingsModel,
  agentSettingsModel,
  cookieCandidate,
}: {
  allowedModelIds: string[];
  chatSettingsModel?: string | null;
  agentSettingsModel?: string | null;
  cookieCandidate?: string | null;
}): string {
  const normalizedChatModel = normalizeModelId(chatSettingsModel);
  const normalizedAgentModel = normalizeModelId(agentSettingsModel);
  const normalizedCookie = normalizeModelId(cookieCandidate);

  const candidateOrder = [
    normalizedChatModel,
    normalizedAgentModel,
    normalizedCookie,
    DEFAULT_CHAT_MODEL,
  ];

  const selected = candidateOrder.find(
    (candidate): candidate is string =>
      !!candidate && isModelIdAllowed(candidate, allowedModelIds)
  );

  if (selected) return selected;
  return allowedModelIds[0] ?? DEFAULT_CHAT_MODEL;
}

export function resolveInitialReasoningEffort({
  chatSettingsReasoning,
  agentSettingsReasoning,
  cookieReasoning,
}: {
  chatSettingsReasoning?: string | null;
  agentSettingsReasoning?: string | null;
  cookieReasoning?: string | null;
}): 'low' | 'medium' | 'high' | undefined {
  const normalizedChat = normalizeReasoningEffort(chatSettingsReasoning);
  const normalizedAgent = normalizeReasoningEffort(agentSettingsReasoning);
  const normalizedCookie = normalizeReasoningEffort(cookieReasoning);
  return normalizedChat ?? normalizedAgent ?? normalizedCookie ?? undefined;
}
