import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { searchArchiveEntries } from '@/lib/db/queries';
import { prisma } from '@/lib/db/prisma';

// Simple search + pagination for archive entries
// Query params: q (text), tags (csv), mode (any|all), cursor (createdAt ISO or id fallback), limit (default 20)
export async function GET(request: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return new ChatSDKError(
      'unauthorized:api',
      'Not authenticated'
    ).toResponse();
  }

  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q') || undefined;
  const tagsCsv = searchParams.get('tags');
  const tags = tagsCsv
    ? tagsCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const mode = (searchParams.get('mode') === 'all' ? 'all' : 'any') as
    | 'any'
    | 'all';
  const limit = Math.min(
    Number.parseInt(searchParams.get('limit') || '20', 10),
    50
  );
  const cursor = searchParams.get('cursor') || undefined; // use updatedAt cursor for stable ordering

  // We'll implement stable pagination using updatedAt desc, id tie-breaker.
  // searchArchiveEntries currently returns rows ordered by updatedAt desc (see implementation)
  // We re-run search then slice after cursor.
  const baseRows = await searchArchiveEntries({
    userId: session.user.id,
    tags,
    matchMode: mode,
    query: q,
    limit: 200,
  });
  let filtered = baseRows;
  if (cursor) {
    // cursor format: `${updatedAt}|${id}`
    const [cUpdated, cId] = cursor.split('|');
    filtered = baseRows.filter((r) => {
      if (r.updatedAt > new Date(cUpdated)) return true;
      if (
        r.updatedAt.getTime() === new Date(cUpdated).getTime() &&
        r.id !== cId
      )
        return true; // continue until we pass cursor element
      return false;
    });
  }
  const page = filtered.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const sliced = hasMore ? page.slice(0, limit) : page;

  // gather link counts like tool search (duplicated small aggregation to avoid importing tool logic)
  const ids = sliced.map((r) => r.id);
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

  return Response.json({
    entries: sliced.map((r) => ({
      slug: r.slug,
      entity: r.entity,
      tags: r.tags,
      bodyPreview: r.body.slice(0, 240),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      linkCount: linkCounts.get(r.id) || 0,
      cursor: `${r.updatedAt.toISOString()}|${r.id}`,
    })),
    nextCursor: hasMore
      ? `${sliced[sliced.length - 1].updatedAt.toISOString()}|${sliced[sliced.length - 1].id}`
      : null,
    hasMore,
  });
}
