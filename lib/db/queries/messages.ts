import { Prisma as PrismaRuntime } from '../../../generated/prisma-client';
import { randomUUID } from 'crypto';
import type { Prisma } from '../../../generated/prisma-client';
import { prisma } from '../prisma';
import { ChatSDKError } from '../../errors';
import type { DBMessage, MessageTreeNode, MessageTreeResult } from '../schema';
import type { MessageDeletionMode } from '../../message-deletion';

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

export function buildMessageTree(
  messages: DBMessage[],
  headMessageId?: string | null
): MessageTreeResult {
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
    const depth = parsePathSegments(pathText).length;
    const node: MessageTreeNode = {
      ...message,
      pathText,
      parentPath,
      depth,
      children: [],
      siblingsCount: 0,
      siblingIndex: 0,
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
    items.sort((a, b) =>
      a.pathText.localeCompare(b.pathText, 'en', { sensitivity: 'case' })
    );
    for (const child of items) {
      if (child.children.length) sortChildren(child.children);
    }
  };
  sortChildren(roots);

  const stampSiblingStats = (topLevel: MessageTreeNode[]) => {
    const queue: MessageTreeNode[][] = [topLevel];
    while (queue.length) {
      const siblings = queue.shift()!;
      const count = siblings.length;
      for (let i = 0; i < count; i++) {
        const n = siblings[i];
        n.siblingsCount = count;
        n.siblingIndex = i;
        if (n.children.length) queue.push(n.children);
      }
    }
  };
  stampSiblingStats(roots);

  const branch: MessageTreeNode[] = [];
  if (roots.length) {
    let cursor: MessageTreeNode | undefined;
    if (headMessageId) {
      const headMessage = messages.find((m) => m.id === headMessageId);
      cursor = headMessage ? nodesByPath.get(headMessage.pathText!) : undefined;
    } else {
      let latestMessage = messages[0];
      for (let i = 1; i < messages.length; i++) {
        if (messages[i].createdAt > latestMessage.createdAt) {
          latestMessage = messages[i];
        }
      }
      cursor = nodesByPath.get(latestMessage.pathText!);
    }

    while (cursor) {
      branch.push(cursor);
      if (!cursor.parentPath) break;
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

async function renameSubtree(
  tx: Prisma.TransactionClient,
  chatId: string,
  fromPath: string,
  toPath: string
) {
  if (
    !fromPath ||
    !toPath ||
    fromPath === toPath ||
    !PATH_PATTERN.test(fromPath) ||
    !PATH_PATTERN.test(toPath)
  ) {
    return;
  }

  const depth = parsePathSegments(fromPath).length;

  await tx.$executeRaw(
    PrismaRuntime.sql`
      UPDATE "Message"
      SET "path" = text2ltree(${toPath}) || subpath("path", ${depth}),
          "path_text" = ltree2text(text2ltree(${toPath}) || subpath("path", ${depth}))
      WHERE "chatId" = ${chatId}::uuid
        AND "path" <@ ${fromPath}::ltree
    `
  );
}

async function getDirectChildrenPaths(
  tx: Prisma.TransactionClient,
  chatId: string,
  parentPath: string | null
): Promise<string[]> {
  const parentPattern = parentPath ? `${parentPath}.*{1}` : '*{1}';

  const rows = await tx.$queryRaw<Array<{ pathText: string | null }>>(
    PrismaRuntime.sql`
      SELECT "path_text" AS "pathText"
      FROM "Message"
      WHERE "chatId" = ${chatId}::uuid
        AND "path_text" IS NOT NULL
        AND "path" ~ ${parentPattern}::lquery
      ORDER BY "path_text" ASC
    `
  );

  const paths: string[] = [];
  for (const row of rows) {
    const pathText = row.pathText;
    if (pathText && PATH_PATTERN.test(pathText)) {
      paths.push(pathText);
    }
  }
  return paths;
}

async function deleteSubtrees(
  tx: Prisma.TransactionClient,
  chatId: string,
  prefixes: string[]
): Promise<string[]> {
  const valid = prefixes.filter((path) => path && PATH_PATTERN.test(path));

  if (!valid.length) {
    return [];
  }

  const deleted = await tx.$queryRaw<Array<{ id: string }>>(
    PrismaRuntime.sql`
      DELETE FROM "Message"
      WHERE "chatId" = ${chatId}::uuid
        AND "path" <@ ANY(${buildLtreeArraySql(valid)})
      RETURNING "id"
    `
  );

  return deleted.map((row) => row.id);
}

async function promoteChildrenToParent(
  tx: Prisma.TransactionClient,
  chatId: string,
  targetPath: string,
  parentPath: string | null
) {
  if (!targetPath || !PATH_PATTERN.test(targetPath)) {
    return;
  }

  const childPattern = `${targetPath}.*{1}`;
  const childRows = await tx.$queryRaw<Array<{ pathText: string | null }>>(
    PrismaRuntime.sql`
      SELECT "path_text" AS "pathText"
      FROM "Message"
      WHERE "chatId" = ${chatId}::uuid
        AND "path_text" IS NOT NULL
        AND "path" ~ ${childPattern}::lquery
      ORDER BY "path_text" ASC
    `
  );

  if (!childRows.length) {
    return;
  }

  const siblingPaths = await getDirectChildrenPaths(tx, chatId, parentPath);
  let nextIndex = 0;
  for (const siblingPath of siblingPaths) {
    if (!siblingPath || siblingPath === targetPath) {
      continue;
    }
    const label = getLastSegment(siblingPath);
    if (!PATH_SEGMENT_PATTERN.test(label)) {
      continue;
    }
    const index = parseLabelIndex(label);
    if (index + 1 > nextIndex) {
      nextIndex = index + 1;
    }
  }

  for (const child of childRows) {
    const childPath = child.pathText;
    if (!childPath || !PATH_PATTERN.test(childPath)) {
      continue;
    }
    const newLabel = toBase36Label(nextIndex++);
    const newPrefix = parentPath ? `${parentPath}.${newLabel}` : newLabel;
    await renameSubtree(tx, chatId, childPath, newPrefix);
  }
}

async function reindexChildren(
  tx: Prisma.TransactionClient,
  chatId: string,
  parentPath: string | null
) {
  const children = await getDirectChildrenPaths(tx, chatId, parentPath);
  for (let index = 0; index < children.length; index++) {
    const currentPath = children[index];
    const newLabel = toBase36Label(index);
    const desiredPath = parentPath ? `${parentPath}.${newLabel}` : newLabel;
    if (currentPath === desiredPath) {
      continue;
    }
    await renameSubtree(tx, chatId, currentPath, desiredPath);
  }
}

export type SaveMessageInput = {
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
        pathText: string;
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
          pathText: path,
        });
      }

      const finalNewHead = rows.reduce(
        (currentHead, row) => {
          const rowTimestamp = row.createdAt.getTime();
          if (
            rowTimestamp > currentHead.timestamp ||
            (rowTimestamp === currentHead.timestamp &&
              row.path.localeCompare(currentHead.path ?? '') > 0)
          ) {
            return {
              id: row.id,
              timestamp: rowTimestamp,
              path: row.path,
            };
          }
          return currentHead;
        },
        {
          id: null as string | null,
          timestamp: -Infinity,
          path: null as string | null,
        }
      );

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
            ${row.path}::ltree,
            ${row.pathText}
          )`
      );

      await tx.$executeRaw(
        PrismaRuntime.sql`
          INSERT INTO "Message"
            ("id", "chatId", "role", "parts", "attachments", "createdAt", "model", "path", "path_text")
          VALUES ${PrismaRuntime.join(values)}
          ON CONFLICT ("id") DO NOTHING
        `
      );

      if (finalNewHead.id) {
        await tx.chat.update({
          where: { id: chatId },
          data: { headMessageId: finalNewHead.id },
        });
      }
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to save messages');
  }
}

export async function branchMessageWithEdit({
  chatId,
  pivotMessageId,
  userId,
  editedText,
}: {
  chatId: string;
  pivotMessageId: string;
  userId: string;
  editedText: string;
}) {
  const trimmed = editedText.trim();
  if (!trimmed) {
    throw new ChatSDKError('bad_request:database', 'Edited text required');
  }

  try {
    const [chat, pivot] = await Promise.all([
      prisma.chat.findUnique({
        where: { id: chatId },
        select: { userId: true, headMessageId: true },
      }),
      prisma.message.findUnique({
        where: { id: pivotMessageId },
        select: {
          id: true,
          chatId: true,
          role: true,
          attachments: true,
          model: true,
          pathText: true,
        },
      }),
    ]);

    if (!chat) {
      throw new ChatSDKError('not_found:database', 'Chat not found');
    }

    if (chat.userId !== userId) {
      throw new ChatSDKError(
        'forbidden:database',
        'Chat ownership mismatch when branching edited message'
      );
    }

    if (!pivot || pivot.chatId !== chatId) {
      throw new ChatSDKError(
        'bad_request:database',
        'Message does not belong to the specified chat'
      );
    }

    const newMessageId = randomUUID();
    const parentPath = pivot.pathText
      ? getParentPathFromText(pivot.pathText)
      : null;

    await saveMessages({
      messages: [
        {
          id: newMessageId,
          chatId,
          role: pivot.role,
          parts: [{ type: 'text', text: trimmed }],
          attachments: pivot.attachments ?? [],
          createdAt: new Date(),
          model: pivot.model ?? null,
          parentPath,
        },
      ],
    });

    return {
      newMessageId,
      previousHeadId: chat.headMessageId ?? null,
    } as const;
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to branch edited message'
    );
  }
}

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
    const [chat, rows] = await Promise.all([
      prisma.chat.findUnique({
        where: { id },
        select: { headMessageId: true },
      }),
      prisma.message.findMany({
        where: { chatId: id },
        orderBy: { pathText: 'asc' },
      }),
    ]);
    return buildMessageTree(rows as DBMessage[], chat?.headMessageId);
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id'
    );
  }
}

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

export async function deleteMessageById({
  chatId,
  messageId,
  userId,
  mode,
}: {
  chatId: string;
  messageId: string;
  userId: string;
  mode: MessageDeletionMode;
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

      const parentPath = getParentPathFromText(targetPath);
      const parentKey = parentPath ?? ROOT_KEY;
      const parentsToReindex = new Set<string>();
      const deletedIds = new Set<string>();

      const addParentForReindex = (path: string | null) => {
        parentsToReindex.add(path ?? ROOT_KEY);
      };

      switch (mode) {
        case 'version': {
          const removed = await deleteSubtrees(tx, chatId, [targetPath]);
          removed.forEach((id) => deletedIds.add(id));
          addParentForReindex(parentPath);
          break;
        }
        case 'message-with-following': {
          const stagePaths = await getDirectChildrenPaths(
            tx,
            chatId,
            parentPath
          );
          const uniquePaths = stagePaths.length ? stagePaths : [targetPath];
          const removed = await deleteSubtrees(tx, chatId, uniquePaths);
          removed.forEach((id) => deletedIds.add(id));
          addParentForReindex(parentPath);
          break;
        }
        case 'message-only': {
          const siblingPaths = await getDirectChildrenPaths(
            tx,
            chatId,
            parentPath
          );
          const siblingsToDelete = siblingPaths.filter(
            (path) => path !== targetPath
          );
          if (siblingsToDelete.length) {
            const removedSiblings = await deleteSubtrees(
              tx,
              chatId,
              siblingsToDelete
            );
            removedSiblings.forEach((id) => deletedIds.add(id));
          }

          await promoteChildrenToParent(tx, chatId, targetPath, parentPath);

          const removedTarget = await tx.$queryRaw<Array<{ id: string }>>(
            PrismaRuntime.sql`
              DELETE FROM "Message"
              WHERE "id" = ${messageId}::uuid
              RETURNING "id"
            `
          );
          removedTarget.forEach((row) => deletedIds.add(row.id));

          addParentForReindex(parentPath);
          break;
        }
        default:
          throw new ChatSDKError(
            'bad_request:database',
            'Unsupported message deletion mode'
          );
      }

      for (const key of parentsToReindex) {
        const parent = key === ROOT_KEY ? null : key;
        await reindexChildren(tx, chatId, parent);
      }

      const remainingMessages = await tx.message.count({
        where: { chatId },
      });

      if (remainingMessages === 0) {
        await tx.stream.deleteMany({ where: { chatId } });
        await tx.chat.delete({ where: { id: chatId } });

        return { messageId, chatId, chatDeleted: true } as const;
      }

      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: { headMessageId: true },
      });

      if (chat?.headMessageId && deletedIds.has(chat.headMessageId)) {
        const messages = await tx.message.findMany({
          where: { chatId },
          orderBy: { createdAt: 'desc' },
        });
        const newHead = messages.find((m) => !deletedIds.has(m.id));
        await tx.chat.update({
          where: { id: chatId },
          data: { headMessageId: newHead?.id ?? null },
        });
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
  mode,
}: {
  chatId: string;
  messageIds: string[];
  userId: string;
  mode: MessageDeletionMode;
}) {
  if (!messageIds.length) {
    return { deleted: 0 as const, chatDeleted: false as const } as const;
  }

  const uniqueMessageIds = Array.from(new Set(messageIds));

  try {
    return await prisma.$transaction(async (tx) => {
      const messages = await tx.message.findMany({
        where: { id: { in: uniqueMessageIds } },
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

      if (messages.length !== uniqueMessageIds.length) {
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

      const orderedMessages = messages
        .map((message) => {
          const pathText = message.pathText;
          if (!pathText || !PATH_PATTERN.test(pathText)) {
            throw new ChatSDKError(
              'bad_request:database',
              'Message path missing or invalid'
            );
          }
          return {
            id: message.id,
            depth: parsePathSegments(pathText).length,
            pathText,
          };
        })
        .sort((a, b) => {
          if (a.depth !== b.depth) return a.depth - b.depth;
          return a.pathText.localeCompare(b.pathText, 'en', {
            sensitivity: 'case',
          });
        });

      let deletedCount = 0;
      const parentsToReindex = new Set<string>();
      const deletedIds = new Set<string>();

      const addParentForReindex = (path: string | null) => {
        parentsToReindex.add(path ?? ROOT_KEY);
      };

      for (const entry of orderedMessages) {
        const current = await tx.message.findUnique({
          where: { id: entry.id },
          select: { pathText: true },
        });

        const pathText = current?.pathText ?? null;
        if (!pathText || !PATH_PATTERN.test(pathText)) {
          if (!current) {
            continue;
          }
          throw new ChatSDKError(
            'bad_request:database',
            'Message path missing or invalid'
          );
        }

        const currentPath = pathText;
        const parentPath = getParentPathFromText(currentPath);

        switch (mode) {
          case 'version': {
            const removed = await deleteSubtrees(tx, chatId, [currentPath]);
            if (!removed.length) {
              continue;
            }
            removed.forEach((id) => deletedIds.add(id));
            deletedCount += 1;
            addParentForReindex(parentPath);
            break;
          }
          case 'message-with-following': {
            const stagePaths = await getDirectChildrenPaths(
              tx,
              chatId,
              parentPath
            );
            const uniquePaths = stagePaths.length ? stagePaths : [currentPath];
            const removed = await deleteSubtrees(tx, chatId, uniquePaths);
            if (!removed.length) {
              continue;
            }
            removed.forEach((id) => deletedIds.add(id));
            deletedCount += 1;
            addParentForReindex(parentPath);
            break;
          }
          case 'message-only': {
            const siblingPaths = await getDirectChildrenPaths(
              tx,
              chatId,
              parentPath
            );
            const siblingsToDelete = siblingPaths.filter(
              (path) => path !== currentPath
            );
            if (siblingsToDelete.length) {
              const removedSiblings = await deleteSubtrees(
                tx,
                chatId,
                siblingsToDelete
              );
              removedSiblings.forEach((id) => deletedIds.add(id));
            }

            await promoteChildrenToParent(tx, chatId, currentPath, parentPath);

            const removedTarget = await tx.$queryRaw<Array<{ id: string }>>(
              PrismaRuntime.sql`
                DELETE FROM "Message"
                WHERE "id" = ${entry.id}::uuid
                RETURNING "id"
              `
            );
            if (!removedTarget.length) {
              continue;
            }
            removedTarget.forEach((row) => deletedIds.add(row.id));
            deletedCount += 1;
            addParentForReindex(parentPath);
            break;
          }
          default:
            throw new ChatSDKError(
              'bad_request:database',
              'Unsupported message deletion mode'
            );
        }
      }

      for (const key of parentsToReindex) {
        const parent = key === ROOT_KEY ? null : key;
        await reindexChildren(tx, chatId, parent);
      }

      const remainingMessages = await tx.message.count({
        where: { chatId },
      });

      if (remainingMessages === 0) {
        await tx.stream.deleteMany({ where: { chatId } });
        await tx.chat.delete({ where: { id: chatId } });
        return { deleted: messages.length, chatDeleted: true };
      }

      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: { headMessageId: true },
      });

      if (chat?.headMessageId && deletedIds.has(chat.headMessageId)) {
        const remaining = await tx.message.findMany({
          where: { chatId },
          orderBy: { createdAt: 'desc' },
        });
        const newHead = remaining.find((m) => !deletedIds.has(m.id));
        await tx.chat.update({
          where: { id: chatId },
          data: { headMessageId: newHead?.id ?? null },
        });
      }

      return { deleted: deletedCount, chatDeleted: false };
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to delete messages');
  }
}

export async function updateHeadMessageByChatId({
  chatId,
  messageId,
  userId,
  expectedHeadId,
}: {
  chatId: string;
  messageId: string;
  userId: string;
  expectedHeadId?: string | null;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: { userId: true },
      });

      if (!chat) {
        throw new ChatSDKError('not_found:database', 'Chat not found');
      }

      if (chat.userId !== userId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Chat ownership mismatch when updating head message'
        );
      }

      const message = await tx.message.findUnique({
        where: { id: messageId },
        select: {
          id: true,
          chatId: true,
          pathText: true,
        },
      });

      if (!message) {
        throw new ChatSDKError('not_found:database', 'Message not found');
      }

      if (message.chatId !== chatId) {
        throw new ChatSDKError(
          'bad_request:database',
          'Message does not belong to the specified chat'
        );
      }

      const pathText = message.pathText;

      if (!pathText || !PATH_PATTERN.test(pathText)) {
        throw new ChatSDKError(
          'bad_request:database',
          'Message path missing or invalid'
        );
      }

      const headMatch =
        expectedHeadId === undefined
          ? {}
          : expectedHeadId === null
            ? { headMessageId: null }
            : { headMessageId: expectedHeadId };

      const updated = await tx.chat.updateMany({
        where: {
          id: chatId,
          ...headMatch,
        },
        data: { headMessageId: messageId },
      });

      if (updated.count === 0) {
        throw new ChatSDKError(
          'bad_request:database',
          'Head message update conflict'
        );
      }

      return { headMessageId: messageId } as const;
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }

    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update head message'
    );
  }
}
