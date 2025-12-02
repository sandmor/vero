import type { ModelMessage } from 'ai';

const DEFAULT_CONTEXT_CHAR_LIMIT = 1800;

export type ConversationSummaryInput = {
  messages?: ModelMessage[];
  assistantPrelude?: string;
  recentUserLimit?: number;
  charLimit?: number;
};

export type ConversationSummary = {
  summary?: string;
  recentUserTexts: string[];
};

export function buildConversationSummary({
  messages,
  assistantPrelude,
  recentUserLimit = 2,
  charLimit = DEFAULT_CONTEXT_CHAR_LIMIT,
}: ConversationSummaryInput): ConversationSummary {
  const summaryParts: string[] = [];
  const recentUserTexts = collectRecentUserTexts(
    messages ?? [],
    recentUserLimit
  );

  if (recentUserTexts.length > 0) {
    const formattedUsers = recentUserTexts
      .map((entry, index) => {
        const label = index === 0 ? 'Latest request' : 'Previous request';
        return `${label}:\n${entry}`;
      })
      .join('\n\n');
    summaryParts.push(formattedUsers);
  }

  if (assistantPrelude) {
    summaryParts.push(`Assistant response so far:\n${assistantPrelude}`);
  }

  if (summaryParts.length === 0) {
    return { summary: undefined, recentUserTexts };
  }

  const draftSummary = summaryParts.join('\n\n');
  const trimmedSummary =
    draftSummary.length > charLimit
      ? draftSummary.slice(draftSummary.length - charLimit)
      : draftSummary;

  return {
    summary: trimmedSummary,
    recentUserTexts,
  };
}

export function collectRecentUserTexts(
  messages: ModelMessage[],
  limit: number
): string[] {
  const userTexts: string[] = [];

  for (
    let index = messages.length - 1;
    index >= 0 && userTexts.length < limit;
    index -= 1
  ) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }

    const text = toPlainText(message.content).trim();
    if (text) {
      userTexts.push(text);
    }
  }

  return userTexts;
}

export function toPlainText(content: ModelMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if ('type' in part && part.type === 'text' && 'text' in part) {
        return typeof part.text === 'string' ? part.text : '';
      }
      return '';
    })
    .join('\n');
}
