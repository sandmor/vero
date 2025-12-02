import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { getPinnedArchiveEntriesForChat } from '@/lib/db/queries';

export async function GET(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user)
    return new ChatSDKError(
      'unauthorized:api',
      'Not authenticated'
    ).toResponse();
  const { searchParams } = req.nextUrl;
  const chatId = searchParams.get('chatId');
  if (!chatId)
    return new ChatSDKError('bad_request:api', 'Missing chatId').toResponse();
  try {
    const rows = await getPinnedArchiveEntriesForChat({
      userId: session.user.id,
      chatId,
    });
    return Response.json(
      rows.map((r) => ({
        slug: r.slug,
        entity: r.entity,
        tags: r.tags,
        updatedAt: r.updatedAt.toISOString(),
        pinnedAt: r.pinnedAt.toISOString(),
        bodyPreview: r.body.slice(0, 600),
      }))
    );
  } catch (_error) {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to load pinned entries'
    ).toResponse();
  }
}
