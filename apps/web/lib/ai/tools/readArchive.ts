import { tool } from 'ai';
import { z } from 'zod';
import type { AppSession } from '@/lib/auth/session';
import {
  getArchiveEntryBySlug,
  getLinksForEntry,
  getArchiveEntriesByIds,
  searchArchiveEntries,
} from '@/lib/db/queries';
import { prisma } from '@/lib/db/prisma';

export const readArchive = ({ session }: { session: AppSession }) =>
  tool({
    description:
      'Read a single archive entry by its slug or search for entries using a query or tags.',
    inputSchema: z.object({
      slug: z
        .string()
        .optional()
        .describe('The unique identifier of the entry to read.'),
      query: z
        .string()
        .optional()
        .describe('A text query to search the body of entries.'),
      tags: z
        .array(z.string())
        .optional()
        .describe('A list of tags to filter by.'),
      limit: z.number().int().positive().max(50).optional(),
    }),
    execute: async ({ slug, query, tags, limit }) => {
      if (!session.user?.id) {
        return { error: 'No active user session' };
      }
      const userId = session.user.id;

      if (slug) {
        const entry = await getArchiveEntryBySlug({ userId, slug });
        if (!entry) return { error: 'Entry not found' };

        const { outgoing, incoming } = await getLinksForEntry({
          entryId: entry.id,
        });
        const targetIds = new Set<string>();
        outgoing.forEach((l) => targetIds.add(l.targetId));
        incoming.forEach((l) => targetIds.add(l.sourceId));
        const related = await getArchiveEntriesByIds({
          ids: Array.from(targetIds),
        });
        const idToSlug = new Map(related.map((r) => [r.id, r.slug] as const));
        const links: any[] = [];
        for (const o of outgoing) {
          links.push({
            otherSlug: idToSlug.get(o.targetId) || 'unknown',
            type: o.type,
            direction: o.bidirectional ? 'bidirectional' : 'out',
          });
        }
        for (const i of incoming) {
          links.push({
            otherSlug: idToSlug.get(i.sourceId) || 'unknown',
            type: i.type,
            direction: 'bidirectional',
          });
        }

        return {
          slug: entry.slug,
          entity: entry.entity,
          tags: entry.tags,
          body: entry.body,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          links,
        };
      } else {
        const rows = await searchArchiveEntries({
          userId,
          tags,
          matchMode: 'any',
          query,
          limit,
        });
        const ids = rows.map((r) => r.id);
        let linkCounts = new Map<string, number>();
        if (ids.length) {
          const linkAgg = await prisma.archiveLink.groupBy({
            by: ['sourceId'],
            where: { sourceId: { in: ids } },
            _count: { _all: true },
          });
          const bidiIncoming = await prisma.archiveLink.groupBy({
            by: ['targetId'],
            where: { targetId: { in: ids }, bidirectional: true },
            _count: { _all: true },
          });
          for (const g of linkAgg)
            linkCounts.set(
              g.sourceId,
              (linkCounts.get(g.sourceId) || 0) + g._count._all
            );
          for (const g of bidiIncoming)
            linkCounts.set(
              g.targetId,
              (linkCounts.get(g.targetId) || 0) + g._count._all
            );
        }
        return rows.map((r) => ({
          slug: r.slug,
          entity: r.entity,
          tags: r.tags,
          bodyPreview: r.body.slice(0, 200),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          linkCount: linkCounts.get(r.id) || 0,
        }));
      }
    },
  });
