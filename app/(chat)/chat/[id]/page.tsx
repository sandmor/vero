import { Suspense } from 'react';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';

import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';

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
