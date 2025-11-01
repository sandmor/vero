import { getAppSession } from '@/lib/auth/session';
import { deleteMessagesByIds } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import {
  isMessageDeletionMode,
  type MessageDeletionMode,
} from '@/lib/message-deletion';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params;

  if (!chatId) {
    return new ChatSDKError(
      'bad_request:api',
      'Parameter chatId is required.'
    ).toResponse();
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Request body must be valid JSON.'
    ).toResponse();
  }

  const body = (payload ?? null) as Record<string, unknown> | null;
  const rawMessageIds = Array.isArray(body?.['messageIds'])
    ? (body?.['messageIds'] as unknown[])
    : null;
  const messageIds = rawMessageIds
    ? (rawMessageIds.filter(
        (id: unknown): id is string =>
          typeof id === 'string' && id.trim().length > 0
      ) as string[])
    : null;

  if (!messageIds || messageIds.length === 0) {
    return new ChatSDKError(
      'bad_request:api',
      'Request body must include messageIds as a non-empty array of strings.'
    ).toResponse();
  }

  let mode: MessageDeletionMode = 'version';
  if (body && 'mode' in body) {
    const rawMode = body['mode'];
    if (!isMessageDeletionMode(rawMode)) {
      return new ChatSDKError(
        'bad_request:api',
        'Invalid deletion mode.'
      ).toResponse();
    }
    mode = rawMode;
  }

  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  try {
    const result = await deleteMessagesByIds({
      chatId,
      messageIds,
      userId: session.user.id,
      mode,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError('bad_request:api').toResponse();
  }
}
