import { Suspense } from 'react';
import { Metadata } from 'next';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';

import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';
import { getChatById } from '@/lib/db/queries/chats';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const chat = await getChatById({ id });
    if (chat) {
      return {
        title: chat.title,
      };
    }
  } catch {
    // ignore error
  }
  return {
    title: 'Chat',
  };
}

const ChatFallback = () => <ChatLoadingSkeleton />;

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Suspense fallback={<ChatFallback />}>
        <ChatComposerClient chatId={id} />
      </Suspense>
    </>
  );
}
