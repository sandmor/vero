import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getChatById } from '@/lib/db/queries';
import { generateTitleFromChatHistory } from '@/app/(chat)/actions';
import { getMessagesByChatId } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { id } = await params;
    const chat = await getChatById({ id });

    if (!chat) {
      return new NextResponse('Chat not found', { status: 404 });
    }

    // Fetch the chat messages
    const messageTreeResult = await getMessagesByChatId({ id: chat.id });
    const uiMessages = convertToUIMessages(messageTreeResult.nodes);

    const newTitle = await generateTitleFromChatHistory({
      messages: uiMessages,
    });

    if (!newTitle) {
      return new NextResponse('Failed to generate title', { status: 500 });
    }

    return NextResponse.json({ title: newTitle });
  } catch (error) {
    console.error('[CHAT_GENERATE_TITLE_POST]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
