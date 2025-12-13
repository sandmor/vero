'use client';

import { useEffect } from 'react';
import { useNavigationStore } from '@/lib/stores/navigation-store';

export function SetLastChatUrl() {
  const setLastChatUrl = useNavigationStore((state) => state.setLastChatUrl);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLastChatUrl(window.location.href);
    }
  }, [setLastChatUrl]);

  return null;
}
