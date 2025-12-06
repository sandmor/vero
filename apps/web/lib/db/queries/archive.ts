import { prisma } from '@virid/db';
import { ChatSDKError } from '../../errors';
import { slugify, appendSuffix, normalizeTags } from '../../archive/utils';
import { mapPrismaError } from '../prisma-error';
import { refreshPinnedEntriesCache } from '../chat-settings';

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
    throw mapPrismaError(outer, {
      model: 'ArchiveEntry',
      operation: 'update',
    });
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

    const removedLinks = await prisma.archiveLink.deleteMany({
      where: {
        OR: [
          { sourceId: { in: existingIds } },
          { targetId: { in: existingIds } },
        ],
      },
    });

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
    const existing = await prisma.chatPinnedArchiveEntry.findFirst({
      where: { chatId, archiveEntryId: entry.id },
    });
    if (existing) return { pinned: false, already: true } as const;
    await prisma.chatPinnedArchiveEntry.create({
      data: { chatId, archiveEntryId: entry.id, userId },
    });
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
    if (!entry) return { removed: 0 } as const;
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
    if (chat.userId !== userId) return [] as const;
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
