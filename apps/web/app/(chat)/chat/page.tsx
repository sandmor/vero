import { Suspense } from 'react';
import { Metadata } from 'next';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';

import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'New Chat',
};

const ChatFallback = () => <ChatLoadingSkeleton variant="new" />;

export default function Page() {
  return (
    <>
      <Suspense fallback={<ChatFallback />}>
        <ChatComposerClient />
      </Suspense>
    </>
  );
}
