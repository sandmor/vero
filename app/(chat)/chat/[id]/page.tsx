import { Suspense } from 'react';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';
import { DataStreamHandler } from '@/components/data-stream-handler';

function ChatFallback() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background">
      <span className="text-sm text-muted-foreground">Loading chat…</span>
    </div>
  );
}

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
      <DataStreamHandler />
    </>
  );
}
