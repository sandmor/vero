'use client';

import { getSyncManager } from '@/lib/cache/sync-manager';
import { getTabLeader, type LeaderState } from '@/lib/cache/tab-leader';
import {
  ChatAction,
  RealtimeClient,
  type ChatChangedPayload,
} from '@/lib/realtime';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

type ConnectionState =
  | 'disabled'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

type LeadershipState = LeaderState | 'unknown';

const GATEWAY_URL = process.env.NEXT_PUBLIC_REALTIME_GATEWAY_URL;
const IS_ENABLED = !!GATEWAY_URL;

/**
 * Hook to manage the realtime WebSocket connection for chat notifications.
 *
 * ## Architecture Overview
 *
 * The realtime system works alongside the incremental sync system to provide
 * fast updates while maintaining data consistency:
 *
 * 1. **Realtime Gateway**: WebSocket connection that receives push notifications
 *    when chats are created, updated, or deleted by ANY client (including other
 *    tabs/devices).
 *
 * 2. **Incremental Sync**: Periodic or triggered HTTP calls to `/api/cache/sync`
 *    that fetch all changes since `lastSyncedAt` and update IndexedDB.
 *
 * ## How They Work Together
 *
 * - Realtime events trigger IMMEDIATE React Query invalidation for fast UI updates
 * - Realtime events ALSO request an incremental sync through SyncManager
 * - The sync is debounced (500ms) to coalesce multiple rapid events
 * - Only the sync updates `lastSyncedAt` - realtime never modifies this timestamp
 * - This ensures no changes are missed even if realtime is temporarily unavailable
 *
 * ## Race Condition Prevention
 *
 * - Realtime events for own changes are filtered out (echo filtering via SyncManager)
 * - Active chats being edited are protected from sync updates during generation
 * - React Query invalidation is safe because it just triggers refetch from server
 * - The sync is the single source of truth for cache timestamp progression
 *
 * @see SyncManager for coordination logic
 * @see EncryptedCacheProvider for cache management
 */
export function useRealtimeConnection() {
  const { getToken, isSignedIn } = useAuth();
  const queryClient = useQueryClient();

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    IS_ENABLED ? 'disconnected' : 'disabled'
  );
  const [lastError, setLastError] = useState<Error | null>(null);
  const [leadershipState, setLeadershipState] =
    useState<LeadershipState>('unknown');

  const clientRef = useRef<RealtimeClient | null>(null);

  const handleChatChanged = useCallback(
    (payload: ChatChangedPayload) => {
      const { chatId, action } = payload;
      const syncManager = getSyncManager();

      switch (action) {
        case ChatAction.CREATED:
        case ChatAction.UPDATED:
          // Step 1: Invalidate React Query for immediate UI update.
          // This triggers a refetch of this specific chat's data from the server,
          // providing instant visual feedback to the user.
          // NOTE: This does NOT update IndexedDB or lastSyncedAt.
          queryClient.invalidateQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });

          // Step 2: Request incremental sync through SyncManager.
          // This will (after debouncing) fetch all changes since lastSyncedAt,
          // update IndexedDB, and advance the sync timestamp.
          // The SyncManager handles echo filtering (ignoring own changes)
          // and active chat protection (not overwriting during generation).
          syncManager?.requestSync('realtime', chatId);
          break;

        case ChatAction.DELETED:
          // For deletions, remove from React Query immediately for fast UI update
          queryClient.removeQueries({
            queryKey: ['chat', 'bootstrap', chatId],
          });
          // Then request sync to update IndexedDB and process the deletion properly
          syncManager?.requestSync('realtime', chatId);
          break;
      }
    },
    [queryClient]
  );

  // Only the tab leader should maintain the realtime socket to avoid N connections.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let isCancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | undefined;

    const attachToLeader = () => {
      const tabLeader = getTabLeader();
      if (!tabLeader) return false;

      const updateState = (state: LeaderState) => {
        if (!isCancelled) {
          setLeadershipState(state);
        }
      };

      updateState(tabLeader.getState());
      unsubscribe = tabLeader.addStateListener(updateState);
      return true;
    };

    const startPolling = () => {
      pollHandle = setInterval(() => {
        if (attachToLeader() && pollHandle) {
          clearInterval(pollHandle);
          pollHandle = undefined;
        }
      }, 300);
    };

    // Reset to unknown on auth changes to avoid stale leadership
    setLeadershipState('unknown');

    if (!isSignedIn) {
      return () => {
        isCancelled = true;
      };
    }

    const syncManager = getSyncManager();

    if (syncManager?.waitForElection) {
      void syncManager.waitForElection().finally(() => {
        if (isCancelled) return;
        if (!attachToLeader()) {
          startPolling();
        }
      });
    } else if (!attachToLeader()) {
      startPolling();
    }

    return () => {
      isCancelled = true;
      unsubscribe?.();
      if (pollHandle) {
        clearInterval(pollHandle);
      }
    };
  }, [isSignedIn]);

  const hasLeadership =
    leadershipState === 'leader' || leadershipState === 'disabled';

  useEffect(() => {
    // Don't connect if realtime is disabled or user not signed in
    if (!IS_ENABLED || !isSignedIn || !hasLeadership) {
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
  }, [isSignedIn, getToken, handleChatChanged, hasLeadership]);

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
