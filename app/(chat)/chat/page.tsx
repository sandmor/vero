import { Suspense } from 'react';
import { ChatComposerClient } from '@/components/chat/chat-composer.client';

import { ChatLoadingSkeleton } from '@/components/chat/chat-loading-skeleton';

export const dynamic = 'force-static';

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
