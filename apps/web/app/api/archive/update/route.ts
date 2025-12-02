import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { updateArchiveEntry, getArchiveEntryBySlug } from '@/lib/db/queries';

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
  const {
    slug,
    entity: newEntity,
    addTags,
    removeTags,
    body: fullBody,
    appendBody,
  } = body || {};
  if (!slug)
    return new ChatSDKError('bad_request:api', 'Missing slug').toResponse();
  try {
    const result = await updateArchiveEntry({
      userId: session.user.id,
      slug,
      newEntity,
      addTags,
      removeTags,
      body: fullBody,
      appendBody,
    });
    if (!result)
      return new ChatSDKError(
        'not_found:api',
        'Archive entry not found'
      ).toResponse();
    const updated = await getArchiveEntryBySlug({
      userId: session.user.id,
      slug,
    });
    if (!updated)
      return new ChatSDKError(
        'not_found:api',
        'Archive entry disappeared during update'
      ).toResponse();
    return Response.json({
      slug: updated.slug,
      entity: updated.entity,
      tags: updated.tags,
      body: updated.body,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      noOp:
        result.updatedAt.getTime() === updated.updatedAt.getTime() &&
        result.body === updated.body,
    });
  } catch (e: any) {
    if (e instanceof ChatSDKError) return e.toResponse();
    console.error('/api/archive/update unexpected', e);
    return new ChatSDKError(
      'bad_request:api',
      'Unexpected failure updating entry'
    ).toResponse();
  }
}
