import type { NextRequest } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { ChatSDKError } from '@/lib/errors';
import { deleteChatsByIds } from '@/lib/db/queries';

export async function POST(req: NextRequest) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Invalid JSON payload'
    ).toResponse();
  }

  const ids = Array.isArray((body as { ids?: unknown }).ids)
    ? (body as { ids: unknown[] }).ids
    : null;

  if (!ids || ids.length === 0) {
    return new ChatSDKError(
      'bad_request:api',
      'Missing or invalid ids array'
    ).toResponse();
  }

  const sanitizedIds = ids.filter((value): value is string => {
    return typeof value === 'string' && value.trim().length > 0;
  });

  if (sanitizedIds.length === 0) {
    return new ChatSDKError(
      'bad_request:api',
      'All chat ids must be non-empty strings'
    ).toResponse();
  }

  try {
    const result = await deleteChatsByIds({
      userId: session.user.id,
      ids: sanitizedIds,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return new ChatSDKError(
      'bad_request:api',
      'Failed to delete chats'
    ).toResponse();
  }
}
