import { describe, expect, it } from 'bun:test';
import type { ChatMessage } from '@/lib/types';
import { buildEditedUserMessageParts } from '@/lib/message-editing';

describe('buildEditedUserMessageParts', () => {
  const baseMessage: ChatMessage = {
    id: 'msg-user-1',
    role: 'user',
    parts: [
      {
        type: 'file',
        url: 'https://example.com/file.txt',
        filename: 'file.txt',
        mediaType: 'text/plain',
      },
      {
        type: 'text',
        text: 'Original message',
      },
    ],
    metadata: {
      createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      model: undefined,
      siblingIndex: 0,
      siblingsCount: 1,
    },
  };

  it('preserves existing file attachments ahead of the text part', () => {
    const updatedParts = buildEditedUserMessageParts(baseMessage, 'New text');

    expect(updatedParts.length).toBe(2);

    const filePart = updatedParts[0] as Record<string, unknown>;
    expect(filePart.type).toBe('file');
    expect(filePart.url).toBe('https://example.com/file.txt');
    expect(filePart.filename).toBe('file.txt');
    expect(filePart.mediaType).toBe('text/plain');

    const textPart = updatedParts[1] as Record<string, unknown>;
    expect(textPart.type).toBe('text');
    expect(textPart.text).toBe('New text');
  });

  it('clears previous text segments and replaces them with the next text', () => {
    const multiTextMessage: ChatMessage = {
      ...baseMessage,
      parts: [
        {
          type: 'text',
          text: 'First segment',
        },
        {
          type: 'text',
          text: 'Second segment',
        },
      ],
    };

    const updatedParts = buildEditedUserMessageParts(
      multiTextMessage,
      'Consolidated message'
    );

    expect(updatedParts.length).toBe(1);
    const textPart = updatedParts[0] as Record<string, unknown>;
    expect(textPart).toEqual({ type: 'text', text: 'Consolidated message' });
  });
});
