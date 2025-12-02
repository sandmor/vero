import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { createArchiveEntry } from '@/lib/db/queries';
import { linkArchiveEntries } from '@/lib/db/queries';

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user)
    return new ChatSDKError(
      'unauthorized:api',
      'Not authenticated'
    ).toResponse();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return new ChatSDKError('bad_request:api', 'Invalid JSON').toResponse();
  }
  const { entity, slug, tags, body: entryBody, links } = body || {};
  if (!entity || typeof entity !== 'string')
    return new ChatSDKError('bad_request:api', 'Missing entity').toResponse();
  try {
    const { entry, adjusted, base } = await createArchiveEntry({
      userId: session.user.id,
      entity,
      slug,
      body: entryBody,
      tags,
    });
    if (links?.length) {
      for (const l of links) {
        if (l && l.targetSlug && l.type) {
          try {
            await linkArchiveEntries({
              userId: session.user.id,
              sourceSlug: entry.slug,
              targetSlug: l.targetSlug,
              type: l.type,
              bidirectional: !!l.bidirectional,
            });
          } catch {
            /* ignore single link failure */
          }
        }
      }
    }
    return Response.json({
      slug: entry.slug,
      entity: entry.entity,
      tags: entry.tags,
      body: entry.body,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      note: adjusted ? `Slug '${base}' adjusted to '${entry.slug}'` : undefined,
    });
  } catch (_error) {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to create entry'
    ).toResponse();
  }
}
