'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import {
  RealtimeClient,
  ChatAction,
  type ChatChangedPayload,
} from '@/lib/realtime';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';

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
 * Integrates with the encrypted cache to update local state when changes occur.
 */
export function useRealtimeConnection() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const { refreshCache } = useEncryptedCache();

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    IS_ENABLED ? 'disconnected' : 'disabled'
  );
  const [lastError, setLastError] = useState<Error | null>(null);

  const clientRef = useRef<RealtimeClient | null>(null);

  const handleChatChanged = useCallback(
    (payload: ChatChangedPayload) => {
      const { chatId, action } = payload;

      switch (action) {
        case ChatAction.CREATED:
        case ChatAction.UPDATED:
          // Invalidate the specific chat's queries to force refetch
          queryClient.invalidateQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });
          // Refresh the cache to sync new/updated chat
          refreshCache({ force: true });
          break;

        case ChatAction.DELETED:
          // Remove from React Query cache
          queryClient.removeQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });
          refreshCache({ force: true });
          break;
      }
    },
    [queryClient, refreshCache]
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
