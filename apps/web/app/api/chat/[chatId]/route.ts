import { getAppSession } from '@/lib/auth/session';
import { getChatById, updateChatTitleById } from '@/lib/db/queries';
import { ChatSDKError } from '@/lib/errors';
import { NextResponse } from 'next/server';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const { chatId } = await params;
    const { title } = await req.json();
    if (!title) {
      return new ChatSDKError('bad_request:api', 'Missing title').toResponse();
    }

    const chat = await getChatById({ id: chatId });
    if (!chat || chat.userId !== session.user.id) {
      return new ChatSDKError(
        'unauthorized:chat',
        'Chat not found or access revoked'
      ).toResponse();
    }

    await updateChatTitleById({ chatId, title, userId: session.user.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CHAT_PATCH]', error);
    if (error instanceof ChatSDKError) {
      if (error.type === 'not_found') {
        return new ChatSDKError(
          'unauthorized:chat',
          'Chat not found or access revoked'
        ).toResponse();
      }
      return error.toResponse();
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
