'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';

export function useNewChatNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startTransition] = useTransition();

  const startNewChat = useCallback(() => {
    startTransition(() => {
      if (pathname === '/chat') {
        router.refresh();
      } else {
        router.push('/chat');
      }
    });
  }, [pathname, router]);

  return {
    startNewChat,
    isNavigating,
  } as const;
}
