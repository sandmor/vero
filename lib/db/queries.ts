import 'server-only';

import { prisma } from './prisma';
import { Prisma as PrismaRuntime } from '../../generated/prisma-client';
import type { Prisma } from '../../generated/prisma-client';
import type { ArtifactKind } from '@/components/artifact';
import type { VisibilityType } from '@/components/visibility-selector';
import { ChatSDKError } from '../errors';
import type { AppUsage } from '../usage';
import { generateUUID } from '../utils';
import {
  type Chat,
  type ChatSettings,
  type Suggestion,
  type User,
  type Document,
  type DBMessage,
  type MessageTreeNode,
  type MessageTreeResult,
} from './schema';
import { refreshPinnedEntriesCache } from './chat-settings';
import { generateTitleFromChatHistory } from '../../app/(chat)/actions';

const PATH_SEGMENT_PATTERN = /^_[0-9a-z]{2}$/;
const PATH_PATTERN = /^(_[0-9a-z]{2})(\._[0-9a-z]{2})*$/;
const ROOT_KEY = '__root__';

function parsePathSegments(path: string): string[] {
  return path.split('.').filter(Boolean);
}

function getParentPathFromText(path: string): string | null {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? null : path.slice(0, lastDot);
}

function getLastSegment(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? path : path.slice(lastDot + 1);
}

function toBase36Label(index: number): string {
  const normalized = index < 0 ? 0 : index;
  return `_${normalized.toString(36).padStart(2, '0')}`;
}

function parseLabelIndex(label: string): number {
  const normalized = label.startsWith('_') ? label.slice(1) : label;
  const parsed = parseInt(normalized, 36);
  return Number.isNaN(parsed) ? -1 : parsed;
}

function dedupePaths(paths: Array<string | null | undefined>): string[] {
  const unique = Array.from(
    new Set(
      paths.filter(
        (value): value is string =>
          typeof value === 'string' && value.length > 0
      )
    )
  ).sort((a, b) => a.length - b.length);

  const result: string[] = [];
  for (const path of unique) {
    const alreadyCovered = result.some(
      (candidate) => path === candidate || path.startsWith(`${candidate}.`)
    );
    if (!alreadyCovered) {
      result.push(path);
    }
  }
  return result;
}

function buildMessageTree(messages: DBMessage[]): MessageTreeResult {
  if (!messages.length) {
    return { tree: [], nodes: [], branch: [] };
  }

  const nodesByPath = new Map<string, MessageTreeNode>();
  const nodes: MessageTreeNode[] = [];

  for (const message of messages) {
    const pathText = message.pathText;
    if (!pathText || !PATH_PATTERN.test(pathText)) {
      continue;
    }

    const parentPath = getParentPathFromText(pathText);
    const node: MessageTreeNode = {
      ...message,
      pathText,
      parentPath,
      depth: parsePathSegments(pathText).length,
      children: [],
    };

    nodesByPath.set(pathText, node);
    nodes.push(node);
  }

  const roots: MessageTreeNode[] = [];

  for (const node of nodes) {
    if (!node.parentPath) {
      roots.push(node);
      continue;
    }
    const parent = nodesByPath.get(node.parentPath);
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortChildren = (items: MessageTreeNode[]) => {
    items.sort((a, b) => a.pathText.localeCompare(b.pathText));
    for (const child of items) {
      if (child.children.length) {
        sortChildren(child.children);
      }
    }
  };

  sortChildren(roots);

  let latest: MessageTreeNode | null = null;
  for (const node of nodes) {
    if (!latest) {
      latest = node;
      continue;
    }
    if (node.createdAt > latest.createdAt) {
      latest = node;
      continue;
    }
    if (
      node.createdAt.getTime() === latest.createdAt.getTime() &&
      node.pathText.localeCompare(latest.pathText) > 0
    ) {
      latest = node;
    }
  }

  const branch: MessageTreeNode[] = [];
  if (latest) {
    let cursor: MessageTreeNode | undefined = latest;
    while (cursor) {
      branch.push(cursor);
      if (!cursor.parentPath) {
        break;
      }
      cursor = nodesByPath.get(cursor.parentPath);
    }
    branch.reverse();
  }

  return { tree: roots, nodes, branch };
}

function buildLtreeArraySql(
  paths: string[]
): ReturnType<typeof PrismaRuntime.sql> {
  return PrismaRuntime.sql`ARRAY[${PrismaRuntime.join(
    paths.map((path) => PrismaRuntime.sql`${path}::ltree`)
  )}]::ltree[]`;
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await prisma.user.findMany({ where: { email } });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get user by email'
    );
  }
}

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
      data: { id, createdAt: new Date(), userId, title, visibility, agentId },
    });
    return;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save chat');
  }
}

export async function deleteChatById({ id }: { id: string }): Promise<Chat> {
  try {
    // Cascades are not defined; delete manually in correct order.
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
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const selectedChat = await prisma.chat.findUnique({
        where: { id: startingAfter },
      });

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${startingAfter} not found`
        );
      }
      const rows = await prisma.chat.findMany({
        where: { userId: id, createdAt: { gt: selectedChat.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: extendedLimit,
        include: { agent: true },
      });
      filteredChats = rows.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        title: c.title,
        userId: c.userId,
        visibility: c.visibility as Chat['visibility'],
        lastContext: c.lastContext as unknown as Chat['lastContext'],
        parentChatId: c.parentChatId ?? null,
        forkedFromMessageId: c.forkedFromMessageId ?? null,
        forkDepth: c.forkedFromMessageId ?? 0,
        settings: (c.settings as ChatSettings) ?? null,
        agent: c.agent ?? null,
      })) as unknown as Chat[];
    } else if (endingBefore) {
      const selectedChat = await prisma.chat.findUnique({
        where: { id: endingBefore },
      });

      if (!selectedChat) {
        throw new ChatSDKError(
          'not_found:database',
          `Chat with id ${endingBefore} not found`
        );
      }
      const rows = await prisma.chat.findMany({
        where: { userId: id, createdAt: { lt: selectedChat.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: extendedLimit,
        include: { agent: true },
      });
      filteredChats = rows.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        title: c.title,
        userId: c.userId,
        visibility: c.visibility as Chat['visibility'],
        lastContext: c.lastContext as unknown as Chat['lastContext'],
        parentChatId: c.parentChatId ?? null,
        forkedFromMessageId: c.forkedFromMessageId ?? null,
        forkDepth: c.forkDepth ?? 0,
        settings: (c.settings as ChatSettings) ?? null,
        agent: c.agent ?? null,
      })) as unknown as Chat[];
    } else {
      const rows = await prisma.chat.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: extendedLimit,
        include: { agent: true },
      });
      filteredChats = rows.map((c) => ({
        id: c.id,
        createdAt: c.createdAt,
        title: c.title,
        userId: c.userId,
        visibility: c.visibility as Chat['visibility'],
        lastContext: c.lastContext as unknown as Chat['lastContext'],
        parentChatId: c.parentChatId ?? null,
        forkedFromMessageId: c.forkedFromMessageId ?? null,
        forkDepth: c.forkDepth ?? 0,
        settings: (c.settings as ChatSettings) ?? null,
        agent: c.agent ?? null,
      })) as unknown as Chat[];
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get chats by user id'
    );
  }
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
    // Sanitize and prepare query for PostgreSQL full-text search
    const sanitizedQuery = query
      .trim()
      .replace(/[^\w\s]/g, ' ') // Replace special chars with spaces
      .split(/\s+/) // Split into words
      .filter((word) => word.length > 0) // Remove empty strings
      .join(' & '); // Join with AND operator for tsquery

    if (!sanitizedQuery) {
      return { chats: [], total: 0 };
    }

    const safeLimit = Math.max(1, Math.min(limit, 100));
    const safeOffset = Math.max(offset, 0);

    // Use PostgreSQL full-text search with GIN indexes
    // This query searches both title and message content using tsvector
    const results = await prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        title: string;
        userId: string;
        visibility: string;
        lastContext: unknown;
        parentChatId: string | null;
        forkedFromMessageId: string | null;
        forkDepth: number;
        settings: unknown;
        agentId: string | null;
        matchType: 'title' | 'message';
        rank: number;
        total: number;
      }>
    >`
      WITH chat_title_matches AS (
        SELECT 
          c.id,
          c."createdAt",
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
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
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
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
          id, "createdAt", title, "userId", visibility, "lastContext",
          "parentChatId", "forkedFromMessageId", "forkDepth", settings, "agentId",
          "matchType", rank
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
        ur.title,
        ur."userId",
        ur.visibility,
        ur."lastContext",
        ur."parentChatId",
        ur."forkedFromMessageId",
        ur."forkDepth",
        ur.settings,
        ur."agentId",
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
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
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
          c.title,
          c."userId",
          c.visibility,
          c."lastContext",
          c."parentChatId",
          c."forkedFromMessageId",
          c."forkDepth",
          c.settings,
          c."agentId",
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

    // Fetch agent data for all results in a single query
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

    // Transform results to Chat type
    const chats: Chat[] = results.map((result) => ({
      id: result.id,
      createdAt: result.createdAt,
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

    const { lastContext, visibility, settings, agent, ...rest } =
      selectedChat as typeof selectedChat & {
        visibility: string;
        settings: any;
        agent: any;
      };
    return {
      ...rest,
      visibility: visibility as Chat['visibility'],
      lastContext: lastContext as unknown as Chat['lastContext'],
      settings: (settings as ChatSettings) ?? null,
      agent: agent ?? null,
    } as Chat;
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to get chat by id');
  }
}

// Narrow input type for saving messages to avoid leaking Prisma.JsonValue typing upstream
type SaveMessageInput = {
  id: string;
  chatId: string;
  role: string;
  parts: unknown;
  attachments: unknown;
  createdAt: Date;
  model?: string | null;
  parentId?: string | null;
  parentPath?: string | null;
  path?: string | null;
};

export async function saveMessages({
  messages,
}: {
  messages: SaveMessageInput[];
}) {
  if (!messages.length) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const chatIds = Array.from(
        new Set(messages.map((message) => message.chatId))
      );
      if (chatIds.length !== 1) {
        throw new ChatSDKError(
          'bad_request:database',
          'saveMessages currently supports a single chat per call'
        );
      }

      const [chatId] = chatIds;

      const existing = await tx.message.findMany({
        where: { chatId },
        select: { id: true, pathText: true, createdAt: true },
      });

      const pathById = new Map<string, string>();
      const nextIndexByParent = new Map<string, number>();

      let tailPath: string | null = null;
      let tailTimestamp = -Infinity;

      for (const row of existing) {
        const pathText = row.pathText;
        if (!pathText || !PATH_PATTERN.test(pathText)) {
          continue;
        }

        pathById.set(row.id, pathText);

        const parentPath = getParentPathFromText(pathText);
        const label = getLastSegment(pathText);
        if (PATH_SEGMENT_PATTERN.test(label)) {
          const parentKey = parentPath ?? ROOT_KEY;
          const index = parseLabelIndex(label);
          const nextIndex = nextIndexByParent.get(parentKey) ?? 0;
          if (index + 1 > nextIndex) {
            nextIndexByParent.set(parentKey, index + 1);
          }
        }

        const createdAt =
          row.createdAt instanceof Date
            ? row.createdAt
            : new Date(row.createdAt as unknown as string);
        const timestamp = createdAt.getTime();
        if (
          timestamp > tailTimestamp ||
          (timestamp === tailTimestamp &&
            (!tailPath || pathText.localeCompare(tailPath) > 0))
        ) {
          tailTimestamp = timestamp;
          tailPath = pathText;
        }
      }

      const insertedPaths = new Map<string, string>();
      let currentTailPath = tailPath;

      const rows: {
        id: string;
        chatId: string;
        role: string;
        partsJson: string;
        attachmentsJson: string;
        createdAt: Date;
        model: string | null;
        path: string;
      }[] = [];

      for (const message of messages) {
        let path = message.path ?? null;
        const createdAt =
          message.createdAt instanceof Date
            ? message.createdAt
            : new Date(message.createdAt);
        const model = message.model ?? null;

        if (path) {
          if (!PATH_PATTERN.test(path)) {
            throw new ChatSDKError(
              'bad_request:database',
              'Invalid message path provided'
            );
          }
        } else {
          let parentPath: string | null;
          if (message.parentPath !== undefined) {
            parentPath = message.parentPath;
          } else if (message.parentId) {
            parentPath =
              insertedPaths.get(message.parentId) ??
              pathById.get(message.parentId) ??
              null;
            if (!parentPath && !pathById.has(message.parentId)) {
              parentPath = currentTailPath ?? null;
            }
          } else {
            parentPath = currentTailPath ?? null;
          }

          const parentKey = parentPath ?? ROOT_KEY;
          const nextIndex = nextIndexByParent.get(parentKey) ?? 0;
          const label = toBase36Label(nextIndex);
          nextIndexByParent.set(parentKey, nextIndex + 1);
          path = parentPath ? `${parentPath}.${label}` : label;
        }

        const parentPathForCache = getParentPathFromText(path);
        const labelForCache = getLastSegment(path);
        if (PATH_SEGMENT_PATTERN.test(labelForCache)) {
          const parentKey = parentPathForCache ?? ROOT_KEY;
          const index = parseLabelIndex(labelForCache);
          const nextIndex = nextIndexByParent.get(parentKey) ?? 0;
          if (index + 1 > nextIndex) {
            nextIndexByParent.set(parentKey, index + 1);
          }
        }

        insertedPaths.set(message.id, path);
        pathById.set(message.id, path);
        currentTailPath = path;

        rows.push({
          id: message.id,
          chatId: message.chatId,
          role: message.role,
          partsJson: JSON.stringify(message.parts ?? []),
          attachmentsJson: JSON.stringify(message.attachments ?? []),
          createdAt,
          model,
          path,
        });
      }

      if (!rows.length) {
        return;
      }

      const values = rows.map(
        (row) =>
          PrismaRuntime.sql`(
            ${row.id}::uuid,
            ${row.chatId}::uuid,
            ${row.role},
            ${row.partsJson}::jsonb,
            ${row.attachmentsJson}::jsonb,
            ${row.createdAt},
            ${row.model},
            ${row.path}::ltree
          )`
      );

      await tx.$executeRaw(
        PrismaRuntime.sql`
          INSERT INTO "Message"
            ("id", "chatId", "role", "parts", "attachments", "createdAt", "model", "path")
          VALUES ${PrismaRuntime.join(values)}
          ON CONFLICT ("id") DO NOTHING
        `
      );
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

// Save the very first assistant message (non-regeneration).
export async function saveAssistantMessage({
  id,
  chatId,
  parts,
  attachments = [],
  model,
  parentId,
}: {
  id: string;
  chatId: string;
  parts: unknown;
  attachments?: unknown;
  model?: string | null;
  parentId?: string | null;
}) {
  try {
    await saveMessages({
      messages: [
        {
          id,
          chatId,
          role: 'assistant',
          parts,
          attachments: attachments ?? [],
          createdAt: new Date(),
          model: model ?? null,
          parentId: parentId ?? undefined,
        },
      ],
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save assistant message'
    );
  }
}

export async function getMessagesByChatId({
  id,
}: {
  id: string;
}): Promise<MessageTreeResult> {
  try {
    const rows = await prisma.message.findMany({
      where: { chatId: id },
      orderBy: { pathText: 'asc' },
    });
    return buildMessageTree(rows as DBMessage[]);
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id'
    );
  }
}

// Return only active (non-superseded) message versions in chronological order
export async function getActiveMessagesByChatId({
  id,
}: {
  id: string;
}): Promise<MessageTreeNode[]> {
  try {
    const { branch } = await getMessagesByChatId({ id });
    return branch;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id'
    );
  }
}

// Regeneration now handled by forking chats at higher level.
export async function forkChat({
  sourceChatId,
  pivotMessageId,
  userId,
  mode,
  editedText,
}: {
  sourceChatId: string;
  pivotMessageId: string; // id of message being regenerated (assistant) or edited (user/assistant)
  userId: string;
  mode: 'regenerate' | 'edit';
  editedText?: string; // required for edit mode (new user text)
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

    const branchPrefix = branchToPivot.slice(0, -1);

    // Determine new chat title (use source title as placeholder)
    const newChatId = generateUUID();
    await prisma.chat.create({
      data: {
        id: newChatId,
        createdAt: new Date(),
        userId,
        title: sourceChat.title, // Use source title as placeholder
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

    // For edit mode: insert the edited message immediately
    // The role depends on the pivot message role
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

    // For regenerate mode we return the previous user message text so client can re-send it
    let previousUserText: string | undefined;
    if (mode === 'regenerate') {
      // Find the last user message in the duplicated branch (which should precede assistant pivot)
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

    // Fire-and-forget real title generation (no await)
    (async () => {
      try {
        // Get all messages from the new chat to generate title from conversation context
        const chatMessages = await prisma.message.findMany({
          where: { chatId: newChatId },
          orderBy: { createdAt: 'asc' },
        });

        if (chatMessages.length > 0) {
          // Convert to UIMessage format for title generation
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
            await updateChatTitleById({ chatId: newChatId, title: realTitle });
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

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
  metadata = null,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  metadata?: Prisma.InputJsonValue | null;
}) {
  try {
    const created = await prisma.document.create({
      data: {
        id,
        title,
        kind,
        content,
        userId,
        ...(metadata != null ? { metadata } : {}),
        createdAt: new Date(),
      },
    });
    const mapped: Document = {
      ...created,
      kind: created.kind as Document['kind'],
    };
    return [mapped as any];
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save document');
  }
}

export async function getDocumentsById({
  id,
}: {
  id: string;
}): Promise<Document[]> {
  try {
    const documents = await prisma.document.findMany({
      where: { id },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map((d) => ({ ...d, kind: d.kind as Document['kind'] }));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get documents by id'
    );
  }
}

export async function getDocumentById({
  id,
}: {
  id: string;
}): Promise<Document | null> {
  try {
    const selectedDocument = await prisma.document.findFirst({
      where: { id },
      orderBy: { createdAt: 'desc' },
    });
    return selectedDocument
      ? ({
          ...selectedDocument,
          kind: selectedDocument.kind as Document['kind'],
        } as Document)
      : null;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get document by id'
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}): Promise<Document[]> {
  try {
    // Capture the documents we will delete so we can return them after deletion
    const toDeleteRaw = await prisma.document.findMany({
      where: { id, createdAt: { gt: timestamp } },
      orderBy: { createdAt: 'asc' },
    });
    const toDelete: Document[] = toDeleteRaw.map((d) => ({
      ...d,
      kind: d.kind as Document['kind'],
    }));

    // Delete suggestions linked to documents after timestamp
    await prisma.suggestion.deleteMany({
      where: {
        documentId: id,
        documentCreatedAt: { gt: timestamp },
      },
    });

    await prisma.document.deleteMany({
      where: { id, createdAt: { gt: timestamp } },
    });
    return toDelete;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete documents by id after timestamp'
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    await prisma.suggestion.createMany({ data: suggestions });
    return;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save suggestions'
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await prisma.suggestion.findMany({ where: { documentId } });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get suggestions by document id'
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    const msg = await prisma.message.findUnique({ where: { id } });
    return msg ? ([msg] as any) : ([] as any);
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get message by id'
    );
  }
}

// getAssistantVariantsByMessageId removed (no longer applicable)

// ===================== Archive (Memory) =====================
import { slugify, appendSuffix, normalizeTags } from '../archive/utils';
import { mapPrismaError } from './prisma-error';

export async function createArchiveEntry({
  userId,
  entity,
  slug: requestedSlug,
  body = '',
  tags,
}: {
  userId: string;
  entity: string;
  slug?: string;
  body?: string;
  tags?: string[];
}) {
  try {
    const base = slugify(requestedSlug || entity);
    if (!base) {
      throw new ChatSDKError(
        'bad_request:database',
        'Empty slug after normalization'
      );
    }
    let slug = base;
    let collisions = 0;
    while (true) {
      const existing = await prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug } },
      });
      if (!existing) break;
      collisions += 1;
      if (collisions > 100) {
        throw new ChatSDKError(
          'bad_request:database',
          'Too many slug collisions'
        );
      }
      slug = appendSuffix(base, collisions);
    }
    const created = await prisma.archiveEntry.create({
      data: {
        userId,
        slug,
        entity: entity.slice(0, 512),
        body,
        tags: normalizeTags(tags),
      },
    });
    return { entry: created, adjusted: collisions > 0, base };
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveEntry', operation: 'create' });
  }
}

export async function getArchiveEntryBySlug({
  userId,
  slug,
}: {
  userId: string;
  slug: string;
}) {
  try {
    return await prisma.archiveEntry.findUnique({
      where: { userId_slug: { userId, slug } },
    });
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveEntry', operation: 'read' });
  }
}

export async function updateArchiveEntry({
  userId,
  slug,
  newEntity,
  addTags,
  removeTags,
  body,
  appendBody,
}: {
  userId: string;
  slug: string;
  newEntity?: string;
  addTags?: string[];
  removeTags?: string[];
  body?: string;
  appendBody?: string;
}) {
  if (body && appendBody) {
    throw new ChatSDKError(
      'bad_request:database',
      'Provide body or appendBody, not both'
    );
  }
  try {
    const current = await prisma.archiveEntry.findUnique({
      where: { userId_slug: { userId, slug } },
    });
    if (!current) return null;

    const noIncomingChanges =
      newEntity === undefined &&
      addTags === undefined &&
      removeTags === undefined &&
      body === undefined &&
      appendBody === undefined;
    if (noIncomingChanges) return current;

    let nextBody = current.body;
    if (body !== undefined) nextBody = body;
    else if (appendBody) nextBody = current.body + appendBody;

    let nextTags = current.tags;
    if (addTags?.length) {
      const incoming = normalizeTags(addTags);
      if (incoming.length) {
        const set = new Set(nextTags);
        for (const t of incoming) set.add(t);
        nextTags = Array.from(set);
      }
    }
    if (removeTags?.length) {
      const remove = new Set(normalizeTags(removeTags));
      if (remove.size) {
        nextTags = nextTags.filter((t: string) => !remove.has(t));
      }
    }

    const nextEntity =
      newEntity !== undefined ? newEntity.slice(0, 512).trim() : current.entity;
    const effectiveNoChange =
      nextEntity === current.entity &&
      nextBody === current.body &&
      JSON.stringify([...nextTags].sort()) ===
        JSON.stringify([...current.tags].sort());
    if (effectiveNoChange) return current;

    try {
      return await prisma.archiveEntry.update({
        where: { userId_slug: { userId, slug } },
        data: { entity: nextEntity, body: nextBody, tags: nextTags },
      });
    } catch (err) {
      throw mapPrismaError(err, { model: 'ArchiveEntry', operation: 'update' });
    }
  } catch (outer) {
    throw mapPrismaError(outer, { model: 'ArchiveEntry', operation: 'update' });
  }
}

export async function deleteArchiveEntry({
  userId,
  slug,
}: {
  userId: string;
  slug: string;
}) {
  try {
    const existing = await prisma.archiveEntry.findUnique({
      where: { userId_slug: { userId, slug } },
    });
    if (!existing) return { deleted: false, removedLinks: 0 };
    const removedLinks = await prisma.archiveLink.deleteMany({
      where: { OR: [{ sourceId: existing.id }, { targetId: existing.id }] },
    });
    await prisma.archiveEntry.delete({
      where: { userId_slug: { userId, slug } },
    });
    return { deleted: true, removedLinks: removedLinks.count };
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveEntry', operation: 'delete' });
  }
}

export async function deleteArchiveEntries({
  userId,
  slugs,
}: {
  userId: string;
  slugs: string[];
}) {
  try {
    // First, get all entries to verify they exist and belong to the user
    const existingEntries = await prisma.archiveEntry.findMany({
      where: {
        userId,
        slug: { in: slugs },
      },
      select: { id: true, slug: true },
    });

    if (existingEntries.length === 0) {
      return { deleted: [], removedLinks: 0 };
    }

    const existingIds = existingEntries.map((e) => e.id);
    const existingSlugs = existingEntries.map((e) => e.slug);

    // Delete all links associated with these entries
    const removedLinks = await prisma.archiveLink.deleteMany({
      where: {
        OR: [
          { sourceId: { in: existingIds } },
          { targetId: { in: existingIds } },
        ],
      },
    });

    // Delete the entries
    await prisma.archiveEntry.deleteMany({
      where: {
        userId,
        slug: { in: existingSlugs },
      },
    });

    return { deleted: existingSlugs, removedLinks: removedLinks.count };
  } catch (e) {
    throw mapPrismaError(e, {
      model: 'ArchiveEntry',
      operation: 'bulk-delete',
    });
  }
}

export async function linkArchiveEntries({
  userId,
  sourceSlug,
  targetSlug,
  type,
  bidirectional = true,
}: {
  userId: string;
  sourceSlug: string;
  targetSlug: string;
  type: string;
  bidirectional?: boolean;
}) {
  if (sourceSlug === targetSlug) {
    throw new ChatSDKError(
      'bad_request:database',
      'Cannot link an entry to itself'
    );
  }
  try {
    const [source, target] = await Promise.all([
      prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug: sourceSlug } },
      }),
      prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug: targetSlug } },
      }),
    ]);
    if (!source || !target)
      return { error: 'One or both entries not found' } as const;
    const existing = await prisma.archiveLink.findFirst({
      where: {
        OR: [
          { sourceId: source.id, targetId: target.id, type, bidirectional },
          bidirectional
            ? {
                sourceId: target.id,
                targetId: source.id,
                type,
                bidirectional: true,
              }
            : { id: '__skip__' },
        ],
      },
    });
    if (existing) {
      return {
        created: false,
        existing: true,
        bidirectional: existing.bidirectional,
        type: existing.type,
      } as const;
    }
    const created = await prisma.archiveLink.create({
      data: {
        sourceId: source.id,
        targetId: target.id,
        type: type.slice(0, 64),
        bidirectional,
      },
    });
    return {
      created: true,
      existing: false,
      bidirectional: created.bidirectional,
      type: created.type,
    } as const;
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveLink', operation: 'link' });
  }
}

export async function unlinkArchiveEntries({
  userId,
  sourceSlug,
  targetSlug,
  type,
}: {
  userId: string;
  sourceSlug: string;
  targetSlug: string;
  type: string;
}) {
  try {
    const [source, target] = await Promise.all([
      prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug: sourceSlug } },
      }),
      prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug: targetSlug } },
      }),
    ]);
    if (!source || !target) return { removed: 0 } as const;
    const removed = await prisma.archiveLink.deleteMany({
      where: {
        OR: [
          { sourceId: source.id, targetId: target.id, type },
          { sourceId: target.id, targetId: source.id, type },
        ],
      },
    });
    return { removed: removed.count } as const;
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveLink', operation: 'unlink' });
  }
}

export async function getLinksForEntry({ entryId }: { entryId: string }) {
  try {
    const [outgoing, incoming] = await Promise.all([
      prisma.archiveLink.findMany({ where: { sourceId: entryId } }),
      prisma.archiveLink.findMany({
        where: { targetId: entryId, bidirectional: true },
      }),
    ]);
    return { outgoing, incoming };
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveLink', operation: 'read' });
  }
}

export async function searchArchiveEntries({
  userId,
  tags,
  matchMode = 'any',
  query,
  limit = 10,
}: {
  userId: string;
  tags?: string[];
  matchMode?: 'any' | 'all';
  query?: string;
  limit?: number;
}) {
  try {
    const constraints: any = { userId };
    if (tags?.length) {
      const normalized = normalizeTags(tags);
      if (normalized.length) {
        constraints.tags =
          matchMode === 'all'
            ? { hasEvery: normalized }
            : { hasSome: normalized };
      }
    }
    const where: any = { ...constraints };
    if (query) {
      where.AND = [
        {
          OR: [
            { entity: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
          ],
        },
      ];
    }
    const rows = await prisma.archiveEntry.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 50),
    });
    return rows;
  } catch (e) {
    throw mapPrismaError(e, { model: 'ArchiveEntry', operation: 'search' });
  }
}

// Batch helper to map entry ids to slugs (for link resolution without N+1)
export async function getArchiveEntriesByIds({ ids }: { ids: string[] }) {
  if (!ids.length) return [] as any[];
  try {
    const rows = await prisma.archiveEntry.findMany({
      where: { id: { in: ids } },
    });
    return rows;
  } catch (_) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to map archive entry ids'
    );
  }
}

// ----- Chat pinned archive entries -----
export async function pinArchiveEntryToChat({
  userId,
  chatId,
  slug,
}: {
  userId: string;
  chatId: string;
  slug: string;
}) {
  try {
    const [chat, entry] = await Promise.all([
      prisma.chat.findUnique({ where: { id: chatId } }),
      prisma.archiveEntry.findUnique({
        where: { userId_slug: { userId, slug } },
      }),
    ]);
    if (!chat) throw new ChatSDKError('not_found:database', 'Chat not found');
    if (chat.userId !== userId)
      throw new ChatSDKError('forbidden:database', 'Chat ownership mismatch');
    if (!entry)
      throw new ChatSDKError('not_found:database', 'Archive entry not found');
    // Idempotent create
    const existing = await prisma.chatPinnedArchiveEntry.findFirst({
      where: { chatId, archiveEntryId: entry.id },
    });
    if (existing) return { pinned: false, already: true } as const;
    await prisma.chatPinnedArchiveEntry.create({
      data: { chatId, archiveEntryId: entry.id, userId },
    });
    // Update settings cache (best-effort, non-blocking errors)
    try {
      const all = await prisma.chatPinnedArchiveEntry.findMany({
        where: { chatId },
        include: { archiveEntry: { select: { slug: true } } },
        orderBy: { pinnedAt: 'asc' },
      });
      await refreshPinnedEntriesCache(
        chatId,
        all.map((r: any) => r.archiveEntry.slug)
      );
    } catch (e) {
      console.warn('Failed to refresh pinnedEntries cache', { chatId, e });
    }
    return { pinned: true, already: false } as const;
  } catch (e) {
    if (e instanceof ChatSDKError) throw e;
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to pin archive entry'
    );
  }
}

export async function unpinArchiveEntryFromChat({
  userId,
  chatId,
  slug,
}: {
  userId: string;
  chatId: string;
  slug: string;
}) {
  try {
    const entry = await prisma.archiveEntry.findUnique({
      where: { userId_slug: { userId, slug } },
    });
    if (!entry) return { removed: 0 } as const; // nothing to do
    const removed = await prisma.chatPinnedArchiveEntry.deleteMany({
      where: { chatId, archiveEntryId: entry.id },
    });
    if (removed.count > 0) {
      try {
        const all = await prisma.chatPinnedArchiveEntry.findMany({
          where: { chatId },
          include: { archiveEntry: { select: { slug: true } } },
          orderBy: { pinnedAt: 'asc' },
        });
        await refreshPinnedEntriesCache(
          chatId,
          all.map((r: any) => r.archiveEntry.slug)
        );
      } catch (e) {
        console.warn('Failed to refresh pinnedEntries cache after unpin', {
          chatId,
          e,
        });
      }
    }
    return { removed: removed.count } as const;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to unpin archive entry'
    );
  }
}

export async function getPinnedArchiveEntriesForChat({
  userId,
  chatId,
}: {
  userId: string;
  chatId: string;
}) {
  try {
    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) return [] as const;
    if (chat.userId !== userId) return [] as const; // do not leak
    const rows: any[] = await prisma.chatPinnedArchiveEntry.findMany({
      where: { chatId },
      include: { archiveEntry: true },
      orderBy: { pinnedAt: 'asc' },
    });
    return rows.map((r: any) => ({
      slug: r.archiveEntry.slug,
      entity: r.archiveEntry.entity,
      tags: r.archiveEntry.tags,
      body: r.archiveEntry.body,
      updatedAt: r.archiveEntry.updatedAt,
      pinnedAt: r.pinnedAt,
    }));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to load pinned archive entries'
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await prisma.message.findMany({
      where: { chatId, createdAt: { gte: timestamp } },
      select: { pathText: true },
    });

    const targetPaths = dedupePaths(
      messagesToDelete.map((message) => message.pathText)
    );

    if (targetPaths.length > 0) {
      const ltreeArray = buildLtreeArraySql(targetPaths);
      await prisma.$executeRaw(
        PrismaRuntime.sql`
          DELETE FROM "Message"
          WHERE "chatId" = ${chatId}::uuid
            AND EXISTS (
              SELECT 1
              FROM unnest(${ltreeArray}) AS target
              WHERE "Message"."path" <@ target
            )
        `
      );
    }
    return;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete messages by chat id after timestamp'
    );
  }
}

export async function deleteMessageById({
  chatId,
  messageId,
  userId,
}: {
  chatId: string;
  messageId: string;
  userId: string;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const message = await tx.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          chatId: true,
          pathText: true,
          chat: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (!message) {
        throw new ChatSDKError('not_found:database', 'Message not found');
      }

      if (message.chatId !== chatId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Message does not belong to the specified chat'
        );
      }

      if (message.chat.userId !== userId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Chat ownership mismatch when deleting message'
        );
      }

      const targetPath = message.pathText;
      if (!targetPath || !PATH_PATTERN.test(targetPath)) {
        throw new ChatSDKError(
          'bad_request:database',
          'Message path missing or invalid'
        );
      }

      await tx.$executeRaw(
        PrismaRuntime.sql`
          DELETE FROM "Message"
          WHERE "chatId" = ${chatId}::uuid
            AND "path" <@ ${targetPath}::ltree
        `
      );

      const remainingMessages = await tx.message.count({
        where: { chatId },
      });

      if (remainingMessages === 0) {
        await tx.stream.deleteMany({ where: { chatId } });
        await tx.chat.delete({ where: { id: chatId } });

        return { messageId, chatId, chatDeleted: true } as const;
      }

      return { messageId, chatId, chatDeleted: false } as const;
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to delete message');
  }
}

export async function deleteMessagesByIds({
  chatId,
  messageIds,
  userId,
}: {
  chatId: string;
  messageIds: string[];
  userId: string;
}) {
  if (!messageIds.length) {
    return { deleted: 0 as const, chatDeleted: false as const } as const;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: { id: { in: messageIds } },
        select: {
          id: true,
          chatId: true,
          pathText: true,
          chat: {
            select: {
              userId: true,
            },
          },
        },
      });

      if (messages.length !== messageIds.length) {
        throw new ChatSDKError(
          'not_found:database',
          'One or more messages missing'
        );
      }

      for (const message of messages) {
        if (message.chatId !== chatId) {
          throw new ChatSDKError(
            'forbidden:database',
            'Message does not belong to the specified chat'
          );
        }
        if (message.chat.userId !== userId) {
          throw new ChatSDKError(
            'forbidden:database',
            'Chat ownership mismatch when deleting messages'
          );
        }
      }

      const targetPaths = dedupePaths(
        messages.map((message) => message.pathText)
      );

      const deletedCount = targetPaths.length
        ? await tx.$executeRaw(
            PrismaRuntime.sql`
              DELETE FROM "Message"
              WHERE "chatId" = ${chatId}::uuid
                AND EXISTS (
                  SELECT 1
                  FROM unnest(${buildLtreeArraySql(targetPaths)}) AS target
                  WHERE "Message"."path" <@ target
                )
            `
          )
        : 0;

      const remainingMessages = await tx.message.count({
        where: { chatId },
      });

      if (remainingMessages === 0) {
        await tx.stream.deleteMany({ where: { chatId } });
        await tx.chat.delete({ where: { id: chatId } });

        return {
          deleted: Number(deletedCount),
          chatDeleted: true,
        } as const;
      }

      return {
        deleted: Number(deletedCount),
        chatDeleted: false,
      } as const;
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to delete messages');
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
    await prisma.chat.update({ where: { id: chatId }, data: { visibility } });
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
    await prisma.chat.update({ where: { id: chatId }, data: { title } });
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
  // Store merged server-enriched usage object
  context: AppUsage;
}) {
  try {
    await prisma.chat.update({
      where: { id: chatId },
      data: { lastContext: context as Prisma.InputJsonValue },
    });
    return;
  } catch (error) {
    console.warn('Failed to update lastContext for chat', chatId, error);
    return;
  }
}

// Deprecated: replaced by token bucket (UserRateLimit)
// export async function getMessageCountByUserId() {}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await prisma.stream.create({
      data: { id: streamId, chatId, createdAt: new Date() },
    });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create stream id'
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await prisma.stream.findMany({
      where: { chatId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return (streamIds as Array<{ id: string }>).map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get stream ids by chat id'
    );
  }
}
