import { useMemo } from 'react';
import type { ChatMessage } from '@/lib/types';

type MessagePart = NonNullable<ChatMessage['parts']>[number];

const isFilePart = (
  part: MessagePart
): part is Extract<MessagePart, { type: 'file' }> => part.type === 'file';

const isReasoningPartWithText = (
  part: MessagePart
): part is Extract<MessagePart, { type: 'reasoning'; text: string }> =>
  part.type === 'reasoning' &&
  typeof part.text === 'string' &&
  part.text.length > 0;

const hasVisibleContent = (part: MessagePart): boolean => {
  // Text parts with non-empty content
  if (
    part.type === 'text' &&
    typeof part.text === 'string' &&
    part.text.trim().length > 0
  ) {
    return true;
  }

  // Reasoning parts with non-empty content
  if (isReasoningPartWithText(part)) {
    return true;
  }

  // File attachments
  if (part.type === 'file') {
    return true;
  }

  // Tool calls (all tool-* types)
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return true;
  }

  // All other part types (data-init, etc.) are not visible
  return false;
};

export type ProcessedMessageParts = {
  parts: NonNullable<ChatMessage['parts']>;
  attachments: Array<
    Extract<NonNullable<ChatMessage['parts']>[number], { type: 'file' }>
  >;
  firstTextIndex: number;
  inlineReasoningText: string;
  hasVisibleContent: boolean;
};

const joinReasoningText = (
  existing:
    | Extract<
        NonNullable<ChatMessage['parts']>[number],
        { type: 'reasoning'; text?: unknown }
      >
    | undefined,
  next: Extract<
    NonNullable<ChatMessage['parts']>[number],
    { type: 'reasoning'; text?: unknown }
  >
) => {
  if (!existing)
    return { ...next, text: typeof next.text === 'string' ? next.text : '' };
  const nextText = typeof next.text === 'string' ? next.text : '';
  if (!nextText) return existing;
  const mergedText = typeof existing.text === 'string' ? existing.text : '';
  return {
    ...existing,
    text: mergedText ? `${mergedText}\n\n${nextText}`.trim() : nextText,
  };
};

export const useProcessedMessageParts = (
  message: ChatMessage
): ProcessedMessageParts =>
  useMemo(() => {
    const rawParts = message.parts ?? [];

    const parts = rawParts.reduce<NonNullable<ChatMessage['parts']>>(
      (acc, part) => {
        if (part?.type === 'reasoning') {
          const text = typeof part.text === 'string' ? part.text.trim() : '';
          if (!text) {
            return acc;
          }
          const previous = acc[acc.length - 1];
          if (previous?.type === 'reasoning') {
            const merged = joinReasoningText(previous, { ...part, text });
            acc[acc.length - 1] = merged;
          } else {
            acc.push({ ...part, text });
          }
          return acc;
        }

        acc.push(part);
        return acc;
      },
      []
    );

    const attachments = parts.filter(isFilePart);

    const firstTextIndex = parts.findIndex(
      (part) =>
        part.type === 'text' &&
        typeof part.text === 'string' &&
        part.text.trim().length > 0
    );

    const inlineReasoningText = parts
      .slice(0, firstTextIndex === -1 ? parts.length : firstTextIndex)
      .filter(isReasoningPartWithText)
      .map((part) => part.text)
      .join('\n\n');

    const messageHasVisibleContent = parts.some(hasVisibleContent);

    return {
      parts,
      attachments,
      firstTextIndex,
      inlineReasoningText,
      hasVisibleContent: messageHasVisibleContent,
    };
  }, [message.parts]);
