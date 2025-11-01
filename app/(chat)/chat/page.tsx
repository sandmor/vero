import { Suspense } from 'react';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';
import { DataStreamHandler } from '@/components/data-stream-handler';

export const dynamic = 'force-static';

function ChatFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <span className="text-sm text-muted-foreground">Loading chat…</span>
    </div>
  );
}

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
