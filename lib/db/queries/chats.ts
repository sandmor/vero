import type { Prisma } from '../../../generated/prisma-client';
import { prisma } from '../prisma';
import { ChatSDKError } from '../../errors';
import type { Chat, ChatSettings, DBMessage, MessageTreeNode } from '../schema';
import type { AppUsage } from '../../usage';
import type { VisibilityType } from '@/components/visibility-selector';
import { generateUUID } from '../../utils';
import { generateTitleFromChatHistory } from '../../../app/(chat)/actions';
import {
  saveMessages,
  getMessagesByChatId,
  type SaveMessageInput,
} from './messages';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

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
    return;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }): Promise<Chat> {
  try {
    await prisma.message.deleteMany({ where: { chatId: id } });
    await prisma.stream.deleteMany({ where: { chatId: id } });

    const deleted = await prisma.chat.delete({ where: { id } });
    const { lastContext, visibility, ...rest } = deleted as typeof deleted & {
      visibility: string;
    };
    return {
      ...rest,
      visibility: visibility as Chat['visibility'],
      lastContext: lastContext as unknown as Chat['lastContext'],
      settings: (deleted.settings as ChatSettings) ?? null,
      agent: null,
    };
  } catch (_error) {
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
    await prisma.chat.deleteMany({ where: { id: { in: targetIds }, userId } });

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
      headMessageId: c.headMessageId ?? null,
      rootMessageIndex: c.rootMessageIndex ?? null,
    };

    return {
      ...normalized,
      branchState: { rootMessageIndex: normalized.rootMessageIndex ?? null },
      ...(includeMessages ? { messages: rawMessages ?? [] } : {}),
    };
  });

  return { chats, hasMore };
}

export async function searchChats({
  userId,
  query,
  limit,
  offset = 0,
}: {
  userId: string;
  query: string;
  limit: number;
  offset?: number;
}) {
  try {
    const sanitizedQuery = query
      .trim()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .join(' & ');

    if (!sanitizedQuery) {
      return { chats: [], total: 0 };
    }

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(offset, 0);

    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        title: string;
        userId: string;
        visibility: string;
        lastContext: unknown;
        parentChatId: string | null;
        forkedFromMessageId: string | null;
        forkDepth: number;
        settings: unknown;
        agentId: string | null;
        rootMessageIndex: number | null;
        matchType: 'title' | 'message';
        rank: number;
        total: number;
      }>
    >`
      WITH chat_title_matches AS (
        SELECT
          c.id,
          c."createdAt",
          c."updatedAt",
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
          c."rootMessageIndex",
          'title'::text as "matchType",
    ts_rank(to_tsvector('simple', c.title), to_tsquery('simple', ${sanitizedQuery})) as rank
        FROM "Chat" c
        WHERE c."userId" = ${userId}
          AND to_tsvector('simple', c.title) @@ to_tsquery('simple', ${sanitizedQuery})
      ),
      chat_message_matches AS (
        SELECT DISTINCT ON (c.id)
          c.id,
          c."createdAt",
          c."updatedAt",
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
          c."rootMessageIndex",
          'message'::text as "matchType",
          ts_rank(
            to_tsvector('simple', 
              COALESCE(
                (
                  SELECT string_agg(value->>'text', ' ')
                  FROM jsonb_array_elements(m.parts::jsonb)
                  WHERE value->>'type' = 'text'
                ),
                ''
              )
            ),
            to_tsquery('simple', ${sanitizedQuery})
          ) as rank
        FROM "Chat" c
        INNER JOIN "Message" m ON m."chatId" = c.id
        WHERE c."userId" = ${userId}
          AND to_tsvector('simple', 
            COALESCE(
              (
                SELECT string_agg(value->>'text', ' ')
                FROM jsonb_array_elements(m.parts::jsonb)
                WHERE value->>'type' = 'text'
              ),
              ''
            )
            ) @@ to_tsquery('simple', ${sanitizedQuery})
        ORDER BY c.id, rank DESC
      ),
      combined_results AS (
        SELECT * FROM chat_title_matches
        UNION
        SELECT * FROM chat_message_matches
      ),
      unique_results AS (
        SELECT DISTINCT ON (id)
          id, "createdAt", "updatedAt", title, "userId", visibility, "lastContext",
          "parentChatId", "forkedFromMessageId", "forkDepth", settings, "agentId",
          "rootMessageIndex", "matchType", rank
        FROM combined_results
        ORDER BY id, 
          CASE WHEN "matchType" = 'title' THEN 1 ELSE 2 END,
          rank DESC,
          "createdAt" DESC
      ),
      total_count AS (
        SELECT COUNT(*)::int AS total FROM unique_results
      )
      SELECT
        ur.id,
        ur."createdAt",
        ur."updatedAt",
        ur.title,
        ur."userId",
        ur.visibility,
        ur."lastContext",
        ur."parentChatId",
        ur."forkedFromMessageId",
        ur."forkDepth",
        ur.settings,
        ur."agentId",
  ur."rootMessageIndex",
        ur."matchType",
        ur.rank,
        total_count.total
      FROM unique_results ur
      CROSS JOIN total_count
      ORDER BY 
        CASE WHEN ur."matchType" = 'title' THEN 0 ELSE 1 END,
        ur.rank DESC,
        ur."createdAt" DESC
      LIMIT ${safeLimit}
      OFFSET ${safeOffset}
    `;

    const totalResult = await prisma.$queryRaw<Array<{ total: number }>>`
      WITH chat_title_matches AS (
        SELECT
          c.id,
          c."createdAt",
          c."updatedAt",
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
          c."rootMessageIndex",
          'title'::text as "matchType",
    ts_rank(to_tsvector('simple', c.title), to_tsquery('simple', ${sanitizedQuery})) as rank
        FROM "Chat" c
        WHERE c."userId" = ${userId}
          AND to_tsvector('simple', c.title) @@ to_tsquery('simple', ${sanitizedQuery})
      ),
      chat_message_matches AS (
        SELECT DISTINCT ON (c.id)
          c.id,
          c."createdAt",
          c."updatedAt",
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
          c."rootMessageIndex",
          'message'::text as "matchType",
          ts_rank(
            to_tsvector('simple', 
              COALESCE(
                (
                  SELECT string_agg(value->>'text', ' ')
                  FROM jsonb_array_elements(m.parts::jsonb)
                  WHERE value->>'type' = 'text'
                ),
                ''
              )
            ),
            to_tsquery('simple', ${sanitizedQuery})
          ) as rank
        FROM "Chat" c
        INNER JOIN "Message" m ON m."chatId" = c.id
        WHERE c."userId" = ${userId}
          AND to_tsvector('simple', 
            COALESCE(
              (
                SELECT string_agg(value->>'text', ' ')
                FROM jsonb_array_elements(m.parts::jsonb)
                WHERE value->>'type' = 'text'
              ),
              ''
            )
            ) @@ to_tsquery('simple', ${sanitizedQuery})
        ORDER BY c.id, rank DESC
      ),
      combined_results AS (
        SELECT * FROM chat_title_matches
        UNION
        SELECT * FROM chat_message_matches
      )
      SELECT COUNT(DISTINCT id)::int AS total FROM combined_results
    `;

    const agentIds = results
      .map((r) => r.agentId)
      .filter((id): id is string => id !== null);
    const agents =
      agentIds.length > 0
        ? await prisma.agent.findMany({
            where: { id: { in: agentIds } },
          })
        : [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const chats: Chat[] = results.map((result) => ({
      id: result.id,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      title: result.title,
      userId: result.userId,
      visibility: result.visibility as Chat['visibility'],
      lastContext: result.lastContext as Chat['lastContext'],
      parentChatId: result.parentChatId ?? null,
      forkedFromMessageId: result.forkedFromMessageId ?? null,
      forkDepth: result.forkDepth ?? 0,
      settings: (result.settings as ChatSettings) ?? null,
      agentId: result.agentId ?? null,
      agent: result.agentId ? (agentMap.get(result.agentId) ?? null) : null,
      headMessageId: null,
      rootMessageIndex: result.rootMessageIndex ?? null,
    }));

    return {
      chats,
      total: totalResult.length > 0 ? totalResult[0].total : chats.length,
    };
  } catch (error) {
    console.error('Search error:', error);
    throw new ChatSDKError('bad_request:database', 'Failed to search chats');
  }
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
}: {
  chatId: string;
  visibility: 'private' | 'public';
}) {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { visibility, updatedAt: new Date() },
    });
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
}: {
  chatId: string;
  title: string;
}) {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { title, updatedAt: new Date() },
    });
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
