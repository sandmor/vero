'use client';

import nextDynamic from 'next/dynamic';

export const ChatComposerClient = nextDynamic(
  () =>
    import('@/components/chat/chat-composer').then((mod) => ({
      default: mod.ChatComposer,
    })),
  { ssr: false }
);
