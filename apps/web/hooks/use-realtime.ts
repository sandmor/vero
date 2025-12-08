'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import {
  RealtimeClient,
  ChatAction,
  type ChatChangedPayload,
} from '@/lib/realtime';
import { getSyncManager } from '@/lib/cache/sync-manager';

type ConnectionState =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

const GATEWAY_URL = process.env.NEXT_PUBLIC_REALTIME_GATEWAY_URL;
const IS_ENABLED = !!GATEWAY_URL;

/**
 * Hook to manage the realtime WebSocket connection for chat notifications.
 *
 * Automatically connects when authenticated and disconnects on sign out.
 * Integrates with the SyncManager to coordinate cache updates and avoid race conditions.
 */
export function useRealtimeConnection() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    IS_ENABLED ? 'disconnected' : 'disabled'
  );
  const [lastError, setLastError] = useState<Error | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);

  const handleChatChanged = useCallback(
    (payload: ChatChangedPayload) => {
      const { chatId, action } = payload;
      const syncManager = getSyncManager();

      switch (action) {
        case ChatAction.CREATED:
        case ChatAction.UPDATED:
          // Invalidate the specific chat's queries to force refetch
          // Note: The SyncManager will filter this if it's an echo of own change
          queryClient.invalidateQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });
          // Request sync through the SyncManager (handles debouncing, echo filtering, protection)
          syncManager?.requestSync('realtime', chatId);
          break;

        case ChatAction.DELETED:
          // Remove from React Query cache immediately
          queryClient.removeQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });
          // Request sync through the SyncManager
          syncManager?.requestSync('realtime', chatId);
          break;
      }
    },
    [queryClient]
  );

  useEffect(() => {
    // Don't connect if realtime is disabled or user not signed in
    if (!IS_ENABLED || !isSignedIn) {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      setConnectionState(IS_ENABLED ? 'disconnected' : 'disabled');
      return;
    }

    // Create client if not exists
    if (!clientRef.current) {
      clientRef.current = new RealtimeClient({
        url: GATEWAY_URL!,
        getToken: async () => {
          try {
            return await getToken();
          } catch {
            return null;
          }
        },
        onChatChanged: handleChatChanged,
        onStateChange: (state) => {
          setConnectionState(state as ConnectionState);
        },
        onError: (error) => {
          setLastError(error);
          console.warn('[Realtime] Connection error:', error.message);
        },
        debug: process.env.NODE_ENV === 'development',
      });
    }

    // Connect
    clientRef.current.connect();

    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, [isSignedIn, getToken, handleChatChanged]);

  return {
    /** Whether realtime is enabled via environment variable */
    isEnabled: IS_ENABLED,
    /** Current connection state */
    connectionState,
    /** Whether currently connected */
    isConnected: connectionState === 'connected',
    /** Last connection error if any */
    lastError,
    /** Manually reconnect (e.g., after network recovery) */
    reconnect: useCallback(() => {
      clientRef.current?.connect();
    }, []),
  };
}
