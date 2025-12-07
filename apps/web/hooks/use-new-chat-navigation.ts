'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook for navigating to a new chat.
 *
 * Handles cache invalidation to prevent stale bootstrap data from
 * being shown when creating a new chat.
 */
export function useNewChatNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startTransition] = useTransition();
  const queryClient = useQueryClient();

  const startNewChat = useCallback(() => {
    // Invalidate cached new-chat bootstrap before navigation to ensure
    // a fresh chat is created instead of reusing stale data
    queryClient.cancelQueries({ queryKey: ['chat', 'bootstrap', 'new'] });
    queryClient.removeQueries({ queryKey: ['chat', 'bootstrap', 'new'] });

    startTransition(() => {
      if (pathname === '/chat') {
        router.refresh();
      } else {
        router.push('/chat');
      }
    });
  }, [pathname, queryClient, router]);

  return {
    startNewChat,
    isNavigating,
  } as const;
}
