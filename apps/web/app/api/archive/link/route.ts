import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
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
  const { sourceSlug, targetSlug, type, bidirectional } = body || {};
  if (!sourceSlug || !targetSlug || !type)
    return new ChatSDKError('bad_request:api', 'Missing fields').toResponse();
  try {
    const res = await linkArchiveEntries({
      userId: session.user.id,
      sourceSlug,
      targetSlug,
      type,
      bidirectional,
    });
    return Response.json(res);
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to link entries'
    ).toResponse();
  }
}
