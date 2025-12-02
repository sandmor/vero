import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { deleteArchiveEntries } from '@/lib/db/queries';

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

  const { slugs } = body || {};
  if (!slugs || !Array.isArray(slugs) || slugs.length === 0)
    return new ChatSDKError(
      'bad_request:api',
      'Missing or invalid slugs array'
    ).toResponse();

  // Validate slugs are strings
  if (!slugs.every((slug: any) => typeof slug === 'string' && slug.trim()))
    return new ChatSDKError(
      'bad_request:api',
      'All slugs must be non-empty strings'
    ).toResponse();

  try {
    const res = await deleteArchiveEntries({
      userId: session.user.id,
      slugs: slugs.map((s: string) => s.trim()),
    });
    return Response.json(res);
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to delete entries'
    ).toResponse();
  }
}
