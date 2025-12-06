import { prisma } from '@virid/db';
import type { ChatSettings } from './schema';
import type { Prisma } from '@virid/db';
import { ChatSDKError } from '../errors';
import { normalizeChatToolIds } from '../ai/tool-ids';

// Default empty settings object (do not persist unless mutations occur)
const EMPTY: ChatSettings = {};

export async function getChatSettings(chatId: string): Promise<ChatSettings> {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { settings: true },
  });
  if (!chat) return EMPTY;
  try {
    if (!chat.settings || typeof chat.settings !== 'object') return EMPTY;
    const settings = chat.settings as ChatSettings;
    if (Array.isArray(settings.tools?.allow)) {
      const normalizedAllow = normalizeChatToolIds(settings.tools.allow);
      if (normalizedAllow !== undefined) {
        return {
          ...settings,
          tools: { ...(settings.tools ?? {}), allow: normalizedAllow },
        };
      }
    }
    return settings;
  } catch {
    return EMPTY;
  }
}

export async function updateChatSettings(
  chatId: string,
  mutate: (prev: ChatSettings) => ChatSettings | Partial<ChatSettings>
): Promise<ChatSettings> {
  // Read existing (tolerate parse errors)
  const prev = await getChatSettings(chatId);
  const nextPatch = mutate(prev);
  const next: ChatSettings = { ...prev, ...nextPatch };
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        settings: next as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat settings'
    );
  }
  return next;
}

export async function setAllowedTools(
  chatId: string,
  toolIds: string[] | undefined
) {
  const normalized =
    toolIds === undefined
      ? undefined
      : (normalizeChatToolIds(toolIds) ?? []).slice(0, 64);
  return updateChatSettings(chatId, (prev) => ({
    tools: {
      ...(prev.tools ?? {}),
      // New semantics: undefined => all tools; [] => no tools
      allow: normalized,
    },
  }));
}

export async function setReasoningEffort(
  chatId: string,
  effort: 'low' | 'medium' | 'high' | undefined
) {
  return updateChatSettings(chatId, (prev) => ({
    ...prev,
    reasoningEffort: effort,
  }));
}

export async function setModelId(chatId: string, modelId: string | undefined) {
  return updateChatSettings(chatId, (prev) => {
    if (modelId === undefined) {
      const { modelId: _omit, ...rest } = prev;
      return rest;
    }
    return {
      ...prev,
      modelId,
    };
  });
}

export async function updateChatAgent(chatId: string, agentId: string | null) {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { agentId, updatedAt: new Date() },
    });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat agent'
    );
  }
}

export async function refreshPinnedEntriesCache(
  chatId: string,
  pinnedSlugs: string[]
) {
  return updateChatSettings(chatId, () => ({ pinnedEntries: pinnedSlugs }));
}

// Merge agent (base) settings with runtime overrides (allowedTools, pinnedSlugs, reasoningEffort, future fields).
// Precedence order (highest last): base <- overrides
// - base: agent.settings (or existing chat settings if we later support cloning chats)
// - overrides.allowedTools -> maps to tools.allow semantics
// - overrides.pinnedSlugs -> sets pinnedEntries cache (does not create join rows itself)
// - overrides.reasoningEffort -> sets reasoning effort level
// Input semantics mirror chat creation API semantics.
export interface SettingsOverrideInput {
  allowedTools?: string[]; // undefined => no restriction stored, [] => explicit empty allow list, [...]
  pinnedSlugs?: string[]; // optional initial pinned slugs (cache only); join table insert handled separately
  reasoningEffort?: 'low' | 'medium' | 'high'; // reasoning effort level
  modelId?: string; // preferred chat model id (provider:model)
}

export async function applyInitialSettingsPreset({
  chatId,
  base,
  overrides,
}: {
  chatId: string;
  base: any | null | undefined; // agent.settings JSON stored
  overrides: SettingsOverrideInput;
}) {
  // Start from a safe normalized object
  const merged: any = base && typeof base === 'object' ? { ...base } : {};

  // Apply allowedTools override semantics
  if (Object.prototype.hasOwnProperty.call(overrides, 'allowedTools')) {
    const list = overrides.allowedTools;
    if (list === undefined) {
      // leave merged.tools.allow undefined (no restriction)
      if (merged.tools && 'allow' in merged.tools) delete merged.tools.allow;
    } else {
      const normalized = (normalizeChatToolIds(list) ?? []).slice(0, 64);
      merged.tools = { ...(merged.tools || {}), allow: normalized };
    }
  }

  if (Array.isArray(merged.tools?.allow)) {
    const normalized = (normalizeChatToolIds(merged.tools.allow) ?? []).slice(
      0,
      64
    );
    if (normalized !== undefined) {
      merged.tools = { ...(merged.tools || {}), allow: normalized };
    }
  }

  if (overrides.pinnedSlugs) {
    // Cache - actual pin join rows are handled elsewhere (route logic already handles pinning asynchronously)
    merged.pinnedEntries = overrides.pinnedSlugs.slice(0, 64); // guard size
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'reasoningEffort')) {
    merged.reasoningEffort = overrides.reasoningEffort;
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'modelId')) {
    const candidate = overrides.modelId;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      merged.modelId = candidate;
    } else {
      delete merged.modelId;
    }
  }

  await prisma.chat.update({
    where: { id: chatId },
    data: { settings: merged, updatedAt: new Date() },
  });

  return merged as ChatSettings;
}
