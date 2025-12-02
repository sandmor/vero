import { describe, expect, it } from 'bun:test';
import { buildMessageTree } from '@/lib/utils/message-tree';
import type { DBMessage, MessageTreeNode } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

type MessageFactoryInput = {
  id: string;
  pathText: string;
  createdAt: Date;
  role?: string;
  chatId?: string;
  model?: string | null;
  selectedChildIndex?: number | null;
};

function createMessage({
  id,
  pathText,
  createdAt,
  role = 'assistant',
  chatId = 'chat-test',
  model = null,
  selectedChildIndex = null,
}: MessageFactoryInput): DBMessage {
  return {
    id,
    chatId,
    role,
    parts: [] as unknown,
    attachments: [] as unknown,
    createdAt,
    model,
    path: pathText,
    pathText,
    selectedChildIndex,
  } as unknown as DBMessage;
}

describe('buildMessageTree', () => {
  it('respects persisted branch selection across roots and children', () => {
    const messages: DBMessage[] = [
      createMessage({
        id: 'root-a',
        pathText: '_00',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        role: 'user',
        selectedChildIndex: 1,
      }),
      createMessage({
        id: 'root-b',
        pathText: '_01',
        createdAt: new Date('2024-01-01T00:02:00Z'),
        role: 'user',
      }),
      createMessage({
        id: 'child-a1',
        pathText: '_00._00',
        createdAt: new Date('2024-01-01T00:03:00Z'),
      }),
      createMessage({
        id: 'child-a2',
        pathText: '_00._01',
        createdAt: new Date('2024-01-01T00:04:00Z'),
      }),
    ];

    const branchState: BranchSelectionSnapshot = { rootMessageIndex: 0 };
    const result = buildMessageTree(messages, branchState);

    expect(result.branch.map((node: MessageTreeNode) => node.id)).toEqual([
      'root-a',
      'child-a2',
    ]);
    expect(result.rootMessageIndex).toBe(0);
  });

  it('falls back to the most recent root when selection indexes are missing', () => {
    const messages: DBMessage[] = [
      createMessage({
        id: 'root-a',
        pathText: '_00',
        createdAt: new Date('2024-02-01T08:00:00Z'),
        role: 'user',
      }),
      createMessage({
        id: 'root-b',
        pathText: '_01',
        createdAt: new Date('2024-02-01T08:05:00Z'),
        role: 'user',
      }),
      createMessage({
        id: 'child-a',
        pathText: '_00._00',
        createdAt: new Date('2024-02-01T08:10:00Z'),
      }),
      createMessage({
        id: 'child-b',
        pathText: '_01._00',
        createdAt: new Date('2024-02-01T08:06:00Z'),
      }),
    ];

    const result = buildMessageTree(messages);

    expect(result.branch.map((node: MessageTreeNode) => node.id)).toEqual([
      'root-b',
      'child-b',
    ]);
    expect(result.rootMessageIndex).toBe(1);
  });

  it('ignores out-of-range root selections and uses the latest root instead', () => {
    const messages: DBMessage[] = [
      createMessage({
        id: 'root-a',
        pathText: '_00',
        createdAt: new Date('2024-03-01T09:00:00Z'),
        role: 'user',
      }),
      createMessage({
        id: 'root-b',
        pathText: '_01',
        createdAt: new Date('2024-03-01T09:02:00Z'),
        role: 'user',
      }),
      createMessage({
        id: 'child-b',
        pathText: '_01._00',
        createdAt: new Date('2024-03-01T09:03:00Z'),
      }),
    ];

    const branchState: BranchSelectionSnapshot = { rootMessageIndex: 5 };
    const result = buildMessageTree(messages, branchState);

    expect(result.branch.map((node: MessageTreeNode) => node.id)).toEqual([
      'root-b',
      'child-b',
    ]);
    expect(result.rootMessageIndex).toBe(1);
  });
});
