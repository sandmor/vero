import { Suspense } from 'react';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';

export const dynamic = 'force-static';

const ChatFallback = () => <ChatLoadingSkeleton />;

export default function Page() {
  return (
    <>
      <Suspense fallback={<ChatFallback />}>
        <ChatComposerClient />
      </Suspense>
      <DataStreamHandler />
    </>
  );
}
