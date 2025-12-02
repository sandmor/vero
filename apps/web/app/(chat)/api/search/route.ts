import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { searchChats } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const query = searchParams.get('q');
  const limit = Number.parseInt(searchParams.get('limit') || '20', 10);
  const offset = Number.parseInt(searchParams.get('offset') || '0', 10);

  if (!query || query.trim().length === 0) {
    return new ChatSDKError(
      'bad_request:api',
      'Search query parameter "q" is required.'
    ).toResponse();
  }

  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const results = await searchChats({
    userId: session.user.id,
    query: query.trim(),
    limit,
    offset: Number.isNaN(offset) ? 0 : Math.max(offset, 0),
  });

  return Response.json(results);
}
