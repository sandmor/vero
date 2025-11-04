import type { Chat, ChatSettings, DBMessage } from '@/lib/db/schema';
import { DEFAULT_CHAT_MODEL, isModelIdAllowed } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { buildMessageTree } from '@/lib/utils/message-tree';

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

export function computeChatLastUpdatedAt({
  chat,
  messages,
  headMessageId,
}: {
  chat: Pick<Chat, 'createdAt'>;
  messages: DBMessage[];
  headMessageId?: string | null;
}): string {
  const baseline = new Date(chat.createdAt).getTime();
  if (!messages.length) {
    return new Date(baseline).toISOString();
  }

  const tree = buildMessageTree(messages, headMessageId ?? null);
  const candidateNodes = tree.branch.length ? tree.branch : tree.nodes;
  const iterable = candidateNodes.length ? candidateNodes : messages;

  const latestTimestamp = iterable.reduce<number>((acc, node) => {
    const value = new Date(node.createdAt).getTime();
    return Number.isNaN(value) ? acc : Math.max(acc, value);
  }, baseline);

  return new Date(latestTimestamp).toISOString();
}
