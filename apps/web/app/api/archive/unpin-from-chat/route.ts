import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { unpinArchiveEntryFromChat } from '@/lib/db/queries';

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
  const { chatId, slug } = body || {};
  if (!chatId || !slug)
    return new ChatSDKError('bad_request:api', 'Missing fields').toResponse();
  try {
    const res = await unpinArchiveEntryFromChat({
      userId: session.user.id,
      chatId,
      slug,
    });
    return Response.json(res);
  } catch (e) {
    if (e instanceof ChatSDKError) return e.toResponse();
    return new ChatSDKError(
      'bad_request:api',
      'Failed to unpin entry'
    ).toResponse();
  }
}
