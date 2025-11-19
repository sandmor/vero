import { Prisma as PrismaRuntime } from '../../../generated/prisma-client';
import { randomUUID } from 'crypto';
import type { Prisma } from '../../../generated/prisma-client';
import { prisma } from '../prisma';
import { ChatSDKError } from '../../errors';
import type { DBMessage, MessageTreeNode, MessageTreeResult } from '../schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import type { MessageDeletionMode } from '../../message-deletion';
import {
  PATH_PATTERN,
  PATH_SEGMENT_PATTERN,
  ROOT_KEY,
  getLastSegment,
  getParentPath,
  parseLabelIndex,
  parsePathSegments,
  toBase36Label,
} from '@/lib/chat/message-path';

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

        const parentPath = getParentPath(pathText);
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

        const parentPathForCache = getParentPath(path);
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

      // Update Chat's updatedAt timestamp
      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });
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
        select: { userId: true },
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
    const parentPath = pivot.pathText ? getParentPath(pivot.pathText) : null;

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
        select: { rootMessageIndex: true },
      }),
      prisma.message.findMany({
        where: { chatId: id },
        orderBy: { pathText: 'asc' },
      }),
    ]);
    const { buildMessageTree } = await import('../../utils/message-tree');
    return buildMessageTree(rows as DBMessage[], {
      rootMessageIndex: chat?.rootMessageIndex ?? null,
    });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get messages by chat id'
    );
  }
}

export async function getMessagesByChatIdRaw({
  id,
}: {
  id: string;
}): Promise<{ messages: DBMessage[]; rootMessageIndex: number | null }> {
  try {
    const [chat, rows] = await Promise.all([
      prisma.chat.findUnique({
        where: { id },
        select: { rootMessageIndex: true },
      }),
      prisma.message.findMany({
        where: { chatId: id },
        orderBy: { pathText: 'asc' },
      }),
    ]);
    return {
      messages: rows as DBMessage[],
      rootMessageIndex: chat?.rootMessageIndex ?? null,
    };
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get raw messages by chat id'
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
              rootMessageIndex: true,
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

      const parentPath = getParentPath(targetPath);
      const parentsToReindex = new Set<string>();
      const deletedIds = new Set<string>();
      const impactedRootIndices = new Set<number>();
      const impactedParentSelections = new Map<string, Set<number>>();

      const trackSelectionImpact = (path: string | null) => {
        if (!path || !PATH_PATTERN.test(path)) {
          return;
        }
        const label = getLastSegment(path);
        if (!PATH_SEGMENT_PATTERN.test(label)) {
          return;
        }
        const index = parseLabelIndex(label);
        if (index < 0) {
          return;
        }
        const ancestorPath = getParentPath(path);
        if (!ancestorPath) {
          impactedRootIndices.add(index);
          return;
        }
        const existing = impactedParentSelections.get(ancestorPath);
        if (existing) {
          existing.add(index);
        } else {
          impactedParentSelections.set(ancestorPath, new Set([index]));
        }
      };

      const addParentForReindex = (path: string | null) => {
        parentsToReindex.add(path ?? ROOT_KEY);
      };

      switch (mode) {
        case 'version': {
          trackSelectionImpact(targetPath);
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
          for (const path of uniquePaths) {
            trackSelectionImpact(path);
          }
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
            for (const path of siblingsToDelete) {
              trackSelectionImpact(path);
            }
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
          trackSelectionImpact(targetPath);

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

      const selectedRootIndex = message.chat.rootMessageIndex ?? 0;
      const shouldClearRootSelection =
        selectedRootIndex !== 0 && impactedRootIndices.has(selectedRootIndex);

      if (shouldClearRootSelection) {
        await tx.chat.update({
          where: { id: chatId },
          data: { rootMessageIndex: 0, updatedAt: new Date() },
        });
      }

      if (impactedParentSelections.size > 0) {
        const parentPaths = Array.from(impactedParentSelections.keys());
        if (parentPaths.length) {
          const parents = await tx.message.findMany({
            where: { chatId, pathText: { in: parentPaths } },
            select: { id: true, pathText: true, selectedChildIndex: true },
          });

          const parentIdsToClear: string[] = [];
          for (const parent of parents) {
            if (deletedIds.has(parent.id)) {
              continue;
            }
            const parentPathText = parent.pathText;
            if (!parentPathText) {
              continue;
            }
            const affected = impactedParentSelections.get(parentPathText);
            if (!affected || parent.selectedChildIndex === null) {
              continue;
            }
            if (affected.has(parent.selectedChildIndex)) {
              parentIdsToClear.push(parent.id);
            }
          }

          if (parentIdsToClear.length) {
            await tx.message.updateMany({
              where: { id: { in: parentIdsToClear } },
              data: { selectedChildIndex: 0 },
            });
          }
        }
      }

      // Update Chat's updatedAt timestamp
      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

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
              rootMessageIndex: true,
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

      const selectedRootIndex = messages[0]?.chat.rootMessageIndex ?? null;

      let deletedCount = 0;
      const parentsToReindex = new Set<string>();
      const deletedIds = new Set<string>();
      const impactedRootIndices = new Set<number>();
      const impactedParentSelections = new Map<string, Set<number>>();

      const trackSelectionImpact = (path: string | null) => {
        if (!path || !PATH_PATTERN.test(path)) {
          return;
        }
        const label = getLastSegment(path);
        if (!PATH_SEGMENT_PATTERN.test(label)) {
          return;
        }
        const index = parseLabelIndex(label);
        if (index < 0) {
          return;
        }
        const ancestorPath = getParentPath(path);
        if (!ancestorPath) {
          impactedRootIndices.add(index);
          return;
        }
        const existing = impactedParentSelections.get(ancestorPath);
        if (existing) {
          existing.add(index);
        } else {
          impactedParentSelections.set(ancestorPath, new Set([index]));
        }
      };

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
        const parentPath = getParentPath(currentPath);

        switch (mode) {
          case 'version': {
            trackSelectionImpact(currentPath);
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
            for (const path of uniquePaths) {
              trackSelectionImpact(path);
            }
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
              for (const path of siblingsToDelete) {
                trackSelectionImpact(path);
              }
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
            trackSelectionImpact(currentPath);
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

      if (
        selectedRootIndex !== null &&
        impactedRootIndices.has(selectedRootIndex)
      ) {
        await tx.chat.update({
          where: { id: chatId },
          data: { rootMessageIndex: 0, updatedAt: new Date() },
        });
      }

      if (impactedParentSelections.size > 0) {
        const parentPaths = Array.from(impactedParentSelections.keys());
        if (parentPaths.length) {
          const parents = await tx.message.findMany({
            where: { chatId, pathText: { in: parentPaths } },
            select: { id: true, pathText: true, selectedChildIndex: true },
          });

          const parentIdsToClear: string[] = [];
          for (const parent of parents) {
            if (deletedIds.has(parent.id)) {
              continue;
            }
            const parentPathText = parent.pathText;
            if (!parentPathText) {
              continue;
            }
            const affected = impactedParentSelections.get(parentPathText);
            if (!affected || parent.selectedChildIndex === null) {
              continue;
            }
            if (affected.has(parent.selectedChildIndex)) {
              parentIdsToClear.push(parent.id);
            }
          }

          if (parentIdsToClear.length) {
            await tx.message.updateMany({
              where: { id: { in: parentIdsToClear } },
              data: { selectedChildIndex: 0 },
            });
          }
        }
      }

      // Update Chat's updatedAt timestamp
      await tx.chat.update({
        where: { id: chatId },
        data: { updatedAt: new Date() },
      });

      return { deleted: deletedCount, chatDeleted: false };
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }
    throw new ChatSDKError('bad_request:database', 'Failed to delete messages');
  }
}

export async function updateBranchSelectionByChatId({
  chatId,
  userId,
  operation,
  expectedSnapshot,
}: {
  chatId: string;
  userId: string;
  operation:
    | { kind: 'root'; rootMessageIndex: number | null; childId?: string }
    | {
        kind: 'child';
        parentId: string;
        selectedChildIndex: number | null;
        childId?: string;
      };
  expectedSnapshot?: BranchSelectionSnapshot;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const chat = await tx.chat.findUnique({
        where: { id: chatId },
        select: { userId: true, rootMessageIndex: true },
      });

      if (!chat) {
        throw new ChatSDKError('not_found:database', 'Chat not found');
      }

      if (chat.userId !== userId) {
        throw new ChatSDKError(
          'forbidden:database',
          'Chat ownership mismatch when updating branch selection'
        );
      }

      if (operation.kind === 'root') {
        let requestedIndex =
          operation.rootMessageIndex !== null &&
          operation.rootMessageIndex !== undefined
            ? Math.max(0, Math.trunc(operation.rootMessageIndex))
            : 0;

        if (operation.childId) {
          const targetMessage = await tx.message.findUnique({
            where: { id: operation.childId },
            select: { pathText: true, chatId: true },
          });

          if (
            targetMessage &&
            targetMessage.chatId === chatId &&
            targetMessage.pathText &&
            PATH_PATTERN.test(targetMessage.pathText)
          ) {
            const parentPath = getParentPath(targetMessage.pathText);
            if (!parentPath) {
              // It is a root message, find its index
              const roots = await getDirectChildrenPaths(tx, chatId, null);
              const index = roots.indexOf(targetMessage.pathText);
              if (index !== -1) {
                requestedIndex = index;
              }
            }
          }
        }

        if (
          expectedSnapshot &&
          expectedSnapshot.rootMessageIndex !== undefined
        ) {
          const expected = expectedSnapshot.rootMessageIndex ?? 0;
          const current = chat.rootMessageIndex ?? 0;
          // If we resolved by ID, we trust that over the snapshot check for index
          if (!operation.childId && expected !== current) {
            throw new ChatSDKError(
              'bad_request:database',
              'Branch selection update conflict'
            );
          }
        }

        await tx.chat.update({
          where: { id: chatId },
          data: { rootMessageIndex: requestedIndex, updatedAt: new Date() },
        });

        return { kind: 'root', rootMessageIndex: requestedIndex } as const;
      }

      const parent = await tx.message.findUnique({
        where: { id: operation.parentId },
        select: { chatId: true, selectedChildIndex: true, pathText: true },
      });

      if (!parent) {
        throw new ChatSDKError(
          'not_found:database',
          'Parent message not found'
        );
      }

      if (parent.chatId !== chatId) {
        throw new ChatSDKError(
          'bad_request:database',
          'Parent message does not belong to the specified chat'
        );
      }

      if (expectedSnapshot?.selections) {
        const expected = Object.prototype.hasOwnProperty.call(
          expectedSnapshot.selections,
          operation.parentId
        )
          ? (expectedSnapshot.selections[operation.parentId] ?? null)
          : undefined;

        if (expected !== undefined) {
          const current = parent.selectedChildIndex ?? null;
          // If we resolved by ID, we trust that over the snapshot check for index
          if (!operation.childId && expected !== current) {
            throw new ChatSDKError(
              'bad_request:database',
              'Branch selection update conflict'
            );
          }
        }
      }

      let normalizedIndex =
        operation.selectedChildIndex === null ||
        operation.selectedChildIndex === undefined
          ? 0
          : Math.max(0, Math.trunc(operation.selectedChildIndex));

      if (operation.childId) {
        const targetMessage = await tx.message.findUnique({
          where: { id: operation.childId },
          select: { pathText: true, chatId: true },
        });

        if (
          targetMessage &&
          targetMessage.chatId === chatId &&
          targetMessage.pathText &&
          PATH_PATTERN.test(targetMessage.pathText) &&
          parent.pathText
        ) {
          const parentPath = getParentPath(targetMessage.pathText);
          if (parentPath === parent.pathText) {
            const siblings = await getDirectChildrenPaths(
              tx,
              chatId,
              parent.pathText
            );
            const index = siblings.indexOf(targetMessage.pathText);
            if (index !== -1) {
              normalizedIndex = index;
            }
          }
        }
      }

      await tx.message.update({
        where: { id: operation.parentId },
        data: { selectedChildIndex: normalizedIndex },
      });

      return {
        kind: 'child',
        parentId: operation.parentId,
        selectedChildIndex: normalizedIndex,
      } as const;
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      throw error;
    }

    throw new ChatSDKError(
      'bad_request:database',
      'Failed to update branch selection'
    );
  }
}
