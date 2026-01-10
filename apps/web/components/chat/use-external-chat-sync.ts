import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { getSyncManager } from '@/lib/cache/sync-manager';
import type { ChatMessage } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

type UseExternalChatSyncArgs = {
  chatId: string;
  messages: ChatMessage[];
  setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
  isStreaming: boolean;
};

/**
 * Hook to detect and merge external message updates into useChat state.
 *
 * This hook listens for cross-tab sync events via the SyncManager's tab-leader
 * BroadcastChannel and triggers a cache refresh when external changes are detected.
 *
 * Key behaviors:
 * - Does NOT sync while streaming (local state is authoritative during generation)
 * - Ignores own updates within a 2-second window to avoid echo loops
 * - Invalidates the bootstrap query cache to trigger fresh data fetch
 * - Integrates with existing tab-leader election system
 */
export function useExternalChatSync({
  chatId,
  messages,
  setMessages,
  isStreaming,
}: UseExternalChatSyncArgs) {
  const queryClient = useQueryClient();
  const { subscribeToMessageUpdates } = useEncryptedCache();
  const lastLocalUpdateRef = useRef(Date.now());
  const isStreamingRef = useRef(isStreaming);
  const chatIdRef = useRef(chatId);

  // Keep refs in sync
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  // Subscribe to message update events from other tabs
  useEffect(() => {
    if (!chatId) {
      return;
    }

    const handleMessagesUpdated = async (
      updatedChatId: string,
      updatedAt: number
    ) => {
      // Only handle updates for our chat
      if (updatedChatId !== chatIdRef.current) {
        return;
      }

      // Don't sync while streaming - local state is authoritative
      if (isStreamingRef.current) {
        return;
      }

      // Ignore if this was our own update (within 2 seconds)
      const timeSinceLocalUpdate = updatedAt - lastLocalUpdateRef.current;
      if (timeSinceLocalUpdate < 2000 && timeSinceLocalUpdate >= 0) {
        return;
      }

      // Invalidate the bootstrap query cache to trigger a fresh fetch
      // This will cause the Chat component to re-render with updated data
      await queryClient.invalidateQueries({
        queryKey: ['chat', 'bootstrap', updatedChatId],
      });

      // Request an incremental sync through the SyncManager.
      // This ensures IndexedDB gets updated and follows the proper sync flow
      // (debouncing, echo filtering, protection). The sync will update
      // lastSyncedAt only after successful completion.
      const syncManager = getSyncManager();
      syncManager?.requestSync('tab-request', updatedChatId);
    };

    const unsubscribe = subscribeToMessageUpdates(handleMessagesUpdated);

    return unsubscribe;
  }, [chatId, queryClient, subscribeToMessageUpdates]);

  // Mark local updates to filter out echo events
  const markLocalUpdate = useCallback(() => {
    lastLocalUpdateRef.current = Date.now();
  }, []);

  return { markLocalUpdate };
}
