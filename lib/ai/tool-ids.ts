// Canonical list of chat tool identifiers (must match server registrations in /api/chat route)
export const CHAT_TOOL_IDS = [
  'getWeather',
  'runCode',
  'readArchive',
  'writeArchive',
  'manageChatPins',
] as const;
export type ChatToolId = (typeof CHAT_TOOL_IDS)[number];

const CHAT_TOOL_ID_ALIASES: Record<string, ChatToolId> = {
  run_code: 'runCode',
};

const CHAT_TOOL_ID_SET = new Set<string>(CHAT_TOOL_IDS);

export function normalizeChatToolId(id: string): ChatToolId | undefined {
  if (CHAT_TOOL_ID_SET.has(id)) {
    return id as ChatToolId;
  }
  return CHAT_TOOL_ID_ALIASES[id];
}

export function normalizeChatToolIds(
  ids: readonly string[] | null | undefined
): ChatToolId[] | undefined {
  if (!ids) {
    return undefined;
  }
  const seen = new Set<ChatToolId>();
  const normalized: ChatToolId[] = [];
  for (const id of ids) {
    const canonical = normalizeChatToolId(id);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    normalized.push(canonical);
  }
  return normalized;
}

export function isChatToolId(id: string): id is ChatToolId {
  return CHAT_TOOL_ID_SET.has(id) || id in CHAT_TOOL_ID_ALIASES;
}
