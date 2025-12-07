import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { updateChatTitleById } from '@/lib/db/queries';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return new NextResponse('Unauthorized', { status: 401 });
    }

    const { title } = await req.json();
    if (!title) {
      return new NextResponse('Missing title', { status: 400 });
    }

    const { chatId } = await params;
    await updateChatTitleById({ chatId, title });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[CHAT_PATCH]', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
