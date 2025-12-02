import type { ChatMessage } from '@/lib/types';

type MessagePart = NonNullable<ChatMessage['parts']>[number];

type FilePart = Extract<MessagePart, { type: 'file' }>;

type TextPart = Extract<MessagePart, { type: 'text' }>;

function cloneFilePart(part: FilePart): FilePart {
  return {
    ...part,
  } as FilePart;
}

function createTextPart(text: string): TextPart {
  return {
    type: 'text',
    text,
  } satisfies TextPart;
}

export function buildEditedUserMessageParts(
  message: ChatMessage,
  nextText: string
): NonNullable<ChatMessage['parts']> {
  const parts = message.parts ?? [];

  const attachments = parts
    .filter((part): part is FilePart => part?.type === 'file')
    .map((part) => cloneFilePart(part));

  return [...attachments, createTextPart(nextText)];
}
