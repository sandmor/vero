import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import {
  getArchiveEntryBySlug,
  getLinksForEntry,
  getArchiveEntriesByIds,
} from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const session = await getAppSession();
  if (!session?.user)
    return new ChatSDKError(
      'unauthorized:api',
      'Not authenticated'
    ).toResponse();
  const { searchParams } = request.nextUrl;
  const slug = searchParams.get('slug');
  if (!slug)
    return new ChatSDKError('bad_request:api', 'Missing slug').toResponse();

  const entry = await getArchiveEntryBySlug({ userId: session.user.id, slug });
  if (!entry)
    return new ChatSDKError('not_found:api', 'Entry not found').toResponse();

  const { outgoing, incoming } = await getLinksForEntry({ entryId: entry.id });
  const targetIds = new Set<string>();
  outgoing.forEach((l) => targetIds.add(l.targetId));
  incoming.forEach((l) => targetIds.add(l.sourceId));
  const related = targetIds.size
    ? await getArchiveEntriesByIds({ ids: Array.from(targetIds) })
    : [];
  const idToSlug = new Map(related.map((r) => [r.id, r.slug] as const));
  const links: any[] = [];
  for (const o of outgoing)
    links.push({
      otherSlug: idToSlug.get(o.targetId) || 'unknown',
      type: o.type,
      direction: o.bidirectional ? 'bidirectional' : 'out',
    });
  for (const i of incoming)
    links.push({
      otherSlug: idToSlug.get(i.sourceId) || 'unknown',
      type: i.type,
      direction: 'bidirectional',
    });

  return Response.json({
    slug: entry.slug,
    entity: entry.entity,
    tags: entry.tags,
    body: entry.body,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    links,
  });
}
