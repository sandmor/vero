import type { Prisma } from '@vero/db';
import { prisma } from '@vero/db';
import { ChatSDKError } from '../../errors';
import type { Chat, ChatSettings, DBMessage, MessageTreeNode } from '../schema';
import type { AppUsage } from '../../usage';
import type { VisibilityType } from '@/components/visibility-selector';
import { generateUUID } from '../../utils';
import { generateTitleFromChatHistory } from '../../../app/actions/chat';
import {
  saveMessages,
  getMessagesByChatId,
  type SaveMessageInput,
} from './messages';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import {
  notifyOnChatCreated,
  notifyOnChatUpdated,
  notifyOnChatDeleted,
  notifyOnChatsDeleted,
} from '@/lib/realtime/notify';

export async function saveChat({
  id,
  userId,
  title,
  visibility,
  agentId,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
  agentId?: string;
}) {
  try {
    await prisma.chat.create({
      data: {
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
        title,
        visibility,
        agentId,
      },
    });
    // Notify realtime gateway (best-effort, non-blocking)
    notifyOnChatCreated(userId, id).catch(() => {});
    return;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({
  id,
  userId,
}: {
  id: string;
  userId?: string;
}): Promise<Chat> {
  try {
    // Fetch chat first to get userId for tombstone
    const chat = await prisma.chat.findUnique({ where: { id } });
    if (!chat) {
      throw new ChatSDKError('not_found:database', 'Chat not found');
    }
    if (userId && chat.userId !== userId) {
      throw new ChatSDKError(
        'forbidden:database',
        'Not authorized to delete this chat'
      );
    }

    await prisma.message.deleteMany({ where: { chatId: id } });
    await prisma.stream.deleteMany({ where: { chatId: id } });

    // Delete chat and create tombstone atomically
    const [deleted] = await prisma.$transaction([
      prisma.chat.delete({ where: { id } }),
      prisma.chatDeletion.create({
        data: { id, userId: chat.userId, deletedAt: new Date() },
      }),
    ]);

    const { lastContext, visibility, ...rest } = deleted as typeof deleted & {
      visibility: string;
    };
    // Notify realtime gateway (best-effort, non-blocking)
    notifyOnChatDeleted(chat.userId, id).catch(() => {});
    return {
      ...rest,
      visibility: visibility as Chat['visibility'],
      lastContext: lastContext as unknown as Chat['lastContext'],
      settings: (deleted.settings as ChatSettings) ?? null,
      agent: null,
    };
  } catch (error) {
    if (error instanceof ChatSDKError) throw error;
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete chat by id'
    );
  }
}

export async function deleteChatsByIds({
  userId,
  ids,
}: {
  userId: string;
  ids: string[];
}): Promise<{ deletedIds: string[] }> {
  try {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) {
      return { deletedIds: [] };
    }

    const chats = await prisma.chat.findMany({
      where: {
        userId,
        id: { in: uniqueIds },
      },
      select: { id: true },
    });

    const targetIds = chats.map((chat) => chat.id);
    if (targetIds.length === 0) {
      return { deletedIds: [] };
    }

    await prisma.message.deleteMany({ where: { chatId: { in: targetIds } } });
    await prisma.stream.deleteMany({ where: { chatId: { in: targetIds } } });

    // Delete chats and create tombstones atomically
    const now = new Date();
    await prisma.$transaction([
      prisma.chat.deleteMany({ where: { id: { in: targetIds }, userId } }),
      prisma.chatDeletion.createMany({
        data: targetIds.map((chatId) => ({
          id: chatId,
          userId,
          deletedAt: now,
        })),
      }),
    ]);

    // Notify realtime gateway (best-effort, non-blocking)
    notifyOnChatsDeleted(userId, targetIds).catch(() => {});

    return { deletedIds: targetIds };
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to delete chats');
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter = null, // chat id to load newer than (optional)
  endingBefore = null, // chat id to load older than (optional)
  includeMessages = false,
}: {
  id: string;
  limit: number;
  startingAfter?: string | null;
  endingBefore?: string | null;
  includeMessages?: boolean;
}): Promise<{
  chats: (Chat & {
    messages?: DBMessage[];
    branchState: BranchSelectionSnapshot;
  })[];
  hasMore: boolean;
}> {
  if (startingAfter && endingBefore) {
    throw new ChatSDKError(
      'bad_request:database',
      'Provide only one of startingAfter or endingBefore'
    );
  }

  const extendedLimit = limit + 1;
  const orderBy: Prisma.ChatOrderByWithRelationInput[] = [
    { createdAt: 'desc' },
    { id: 'desc' }, // tie-breaker, keeps paging deterministic
  ];

  const include: Prisma.ChatInclude = { agent: true };
  if (includeMessages) {
    include.messages = { orderBy: { pathText: 'asc' } };
  }

  // Build a single Prisma query with cursor-based pagination (no anchor fetch)
  const args: Prisma.ChatFindManyArgs = {
    where: { userId: id },
    orderBy,
    include,
    take: extendedLimit,
  };

  if (startingAfter) {
    // Load newer than this chat (previous page in a descending list)
    args.cursor = { id: startingAfter };
    args.skip = 1; // exclude the cursor row
    args.take = -extendedLimit; // rows before the cursor in the current order (i.e., newer)
  } else if (endingBefore) {
    // Load older than this chat (next page in a descending list)
    args.cursor = { id: endingBefore };
    args.skip = 1; // exclude the cursor row
    args.take = extendedLimit; // rows after the cursor in the current order (i.e., older)
  }

  const rows = await prisma.chat.findMany(args);

  // Ensure final output is in descending order (covers the negative-take branch)
  rows.sort((a, b) => {
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  type ChatWithBranchState = Chat & {
    messages?: DBMessage[];
    branchState: BranchSelectionSnapshot;
  };

  const chats = pageRows.map<ChatWithBranchState>((c) => {
    const rawMessages =
      includeMessages && Array.isArray((c as any).messages)
        ? ((c as any).messages as DBMessage[])
        : undefined;

    const { headMessage, ...chatWithoutHead } = c as typeof c & {
      headMessage?: unknown;
    };

    const normalized: Chat = {
      ...chatWithoutHead,
      visibility: c.visibility as Chat['visibility'],
      lastContext: c.lastContext as unknown as Chat['lastContext'],
      settings: (c.settings as ChatSettings) ?? null,
      agent: (c as any).agent ?? null,
      rootMessageIndex: c.rootMessageIndex ?? 0,
    };

    return {
      ...normalized,
      branchState: { rootMessageIndex: normalized.rootMessageIndex ?? null },
      ...(includeMessages ? { messages: rawMessages ?? [] } : {}),
    };
  });

  return { chats, hasMore };
}

export async function getChatById({
  id,
}: {
  id: string;
}): Promise<Chat | null> {
  try {
    const selectedChat = await prisma.chat.findUnique({
      where: { id },
      include: { agent: true },
    });
    if (!selectedChat) {
      return null;
    }

    const normalized: Chat = {
      ...selectedChat,
      visibility: selectedChat.visibility as Chat['visibility'],
      lastContext: selectedChat.lastContext as unknown as Chat['lastContext'],
      settings: (selectedChat.settings as ChatSettings) ?? null,
      agent: selectedChat.agent ?? null,
    };

    return normalized;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

export async function updateChatVisiblityById({
  chatId,
  visibility,
  userId,
}: {
  chatId: string;
  visibility: 'private' | 'public';
  userId?: string;
}) {
  try {
    if (userId) {
      const existing = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { userId: true },
      });
      if (!existing) {
        throw new ChatSDKError('not_found:database', 'Chat not found');
      }
      if (existing.userId !== userId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Not authorized to update this chat'
        );
      }
    }
    const updated = await prisma.chat.update({
      where: { id: chatId },
      data: { visibility, updatedAt: new Date() },
      select: { userId: true },
    });
    // Notify realtime gateway (best-effort, non-blocking)
    if (userId || updated.userId) {
      notifyOnChatUpdated(userId ?? updated.userId, chatId).catch(() => {});
    }
    return;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat visibility by id'
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
  userId,
}: {
  chatId: string;
  title: string;
  userId?: string;
}) {
  try {
    if (userId) {
      const existing = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { userId: true },
      });
      if (!existing) {
        throw new ChatSDKError('not_found:database', 'Chat not found');
      }
      if (existing.userId !== userId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Not authorized to update this chat'
        );
      }
    }
    const updated = await prisma.chat.update({
      where: { id: chatId },
      data: { title, updatedAt: new Date() },
      select: { userId: true },
    });
    // Notify realtime gateway (best-effort, non-blocking)
    if (userId || updated.userId) {
      notifyOnChatUpdated(userId ?? updated.userId, chatId).catch(() => {});
    }
    return;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update chat title by id'
    );
  }
}

export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  context: AppUsage;
}) {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        lastContext: context as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
    return;
  } catch (error) {
    console.warn('Failed to update lastContext for chat', chatId, error);
    return;
  }
}

export async function forkChat({
  sourceChatId,
  pivotMessageId,
  userId,
  mode,
  editedText,
}: {
  sourceChatId: string;
  pivotMessageId: string;
  userId: string;
  mode: 'regenerate' | 'edit' | 'clone';
  editedText?: string;
}) {
  if (mode === 'edit' && (!editedText || !editedText.trim())) {
    throw new ChatSDKError('bad_request:database', 'Edited text required');
  }
  try {
    const sourceChat: any = await prisma.chat.findUnique({
      where: { id: sourceChatId },
    });
    if (!sourceChat)
      throw new ChatSDKError('not_found:database', 'Source chat not found');
    if (sourceChat.userId !== userId)
      throw new ChatSDKError('forbidden:database', 'Ownership mismatch');

    const messageTree = await getMessagesByChatId({ id: sourceChatId });
    const nodesById = new Map<string, MessageTreeNode>(
      messageTree.nodes.map((node) => [node.id, node])
    );

    const pivotNode = nodesById.get(pivotMessageId);
    if (!pivotNode) {
      throw new ChatSDKError('not_found:database', 'Pivot message not in chat');
    }

    const nodesByPath = new Map<string, MessageTreeNode>(
      messageTree.nodes.map((node) => [node.pathText, node])
    );

    const branchToPivot: MessageTreeNode[] = [];
    let cursor: MessageTreeNode | undefined = pivotNode;
    while (cursor) {
      branchToPivot.push(cursor);
      if (!cursor.parentPath) {
        break;
      }
      cursor = nodesByPath.get(cursor.parentPath);
    }

    branchToPivot.reverse();

    const branchPrefix =
      mode === 'clone' ? branchToPivot : branchToPivot.slice(0, -1);

    const newChatId = generateUUID();
    await prisma.chat.create({
      data: {
        id: newChatId,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId,
        title: sourceChat.title,
        visibility: sourceChat.visibility as string,
        lastContext: sourceChat.lastContext as Prisma.InputJsonValue,
        parentChatId: sourceChat.parentChatId || sourceChat.id,
        forkedFromMessageId: pivotMessageId,
        forkDepth: (sourceChat.forkDepth || 0) + 1,
        agentId: sourceChat.agentId,
        ...(sourceChat.settings
          ? { settings: sourceChat.settings as Prisma.InputJsonValue }
          : {}),
      } as any,
    });
    // Notify realtime gateway about the new forked chat (best-effort, non-blocking)
    notifyOnChatCreated(userId, newChatId).catch(() => {});

    let lastReplayedId: string | undefined;

    if (branchPrefix.length) {
      const replayMessages: SaveMessageInput[] = [];
      for (const original of branchPrefix) {
        const newId = generateUUID();
        replayMessages.push({
          id: newId,
          chatId: newChatId,
          role: original.role,
          parts: original.parts,
          attachments: original.attachments,
          createdAt:
            original.createdAt instanceof Date
              ? original.createdAt
              : new Date(original.createdAt),
          model:
            typeof original.model === 'string' &&
            original.model.trim().length > 0
              ? original.model
              : null,
          parentId: replayMessages.length
            ? replayMessages[replayMessages.length - 1].id
            : undefined,
        });
      }
      if (replayMessages.length) {
        await saveMessages({ messages: replayMessages });
        lastReplayedId = replayMessages[replayMessages.length - 1]?.id;
      }
    }

    let insertedEditedMessageId: string | undefined;
    if (mode === 'edit') {
      const pivotMessage = pivotNode;
      insertedEditedMessageId = generateUUID();
      await saveMessages({
        messages: [
          {
            id: insertedEditedMessageId,
            chatId: newChatId,
            role: pivotMessage.role,
            parts: [{ type: 'text', text: editedText }],
            attachments: [],
            createdAt: new Date(),
            parentId: lastReplayedId,
          },
        ],
      });
      lastReplayedId = insertedEditedMessageId;
    }

    let previousUserText: string | undefined;
    if (mode === 'regenerate') {
      for (let i = branchPrefix.length - 1; i >= 0; i--) {
        const candidate = branchPrefix[i];
        if (candidate.role === 'user') {
          const textParts = Array.isArray(candidate.parts)
            ? (candidate.parts as any[])
                .filter((p) => p && p.type === 'text')
                .map((p) => p.text)
                .join('\n')
            : undefined;
          previousUserText = textParts || '';
          break;
        }
      }
    }

    (async () => {
      try {
        const chatMessages = await prisma.message.findMany({
          where: { chatId: newChatId },
          orderBy: { createdAt: 'asc' },
        });

        if (chatMessages.length > 0) {
          const uiMessages = chatMessages.map((msg: any) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.parts,
            metadata: undefined,
          }));

          const realTitle = await generateTitleFromChatHistory({
            messages: uiMessages,
          });
          if (realTitle && realTitle !== sourceChat.title) {
            await prisma.chat.update({
              where: { id: newChatId },
              data: { title: realTitle, updatedAt: new Date() },
            });
            // Notify realtime gateway about title update (best-effort)
            notifyOnChatUpdated(userId, newChatId).catch(() => {});
          }
        }
      } catch (e) {
        console.warn(
          'Deferred title generation failed for forked chat',
          newChatId,
          e
        );
      }
    })();

    return { newChatId, insertedEditedMessageId, previousUserText };
  } catch (e) {
    if (e instanceof ChatSDKError) throw e;
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to fork chat (simplified)'
    );
  }
}
