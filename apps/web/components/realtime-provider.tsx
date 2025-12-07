'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useRealtimeConnection } from '@/hooks/use-realtime';

type RealtimeContextValue = ReturnType<typeof useRealtimeConnection>;

const RealtimeContext = createContext<RealtimeContextValue>({
  isEnabled: false,
  connectionState: 'disabled',
  isConnected: false,
  lastError: null,
  reconnect: () => {},
});

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/**
 * Provider that manages the realtime WebSocket connection.
 * Should be placed inside EncryptedCacheProvider and QueryProvider.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const realtimeState = useRealtimeConnection();

  return (
    <RealtimeContext.Provider value={realtimeState}>
      {children}
    </RealtimeContext.Provider>
  );
}
