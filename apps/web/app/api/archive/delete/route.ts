import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { deleteArchiveEntry } from '@/lib/db/queries';

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
  const { slug } = body || {};
  if (!slug)
    return new ChatSDKError('bad_request:api', 'Missing slug').toResponse();
  try {
    const res = await deleteArchiveEntry({ userId: session.user.id, slug });
    return Response.json(res);
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to delete entry'
    ).toResponse();
  }
}
