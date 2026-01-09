'use client';

import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { getSyncManager } from '@/lib/cache/sync-manager';
import { useCallback } from 'react';

/**
 * Hook for centralized sidebar history updates.
 *
 * This hook provides a single entry point for updating the sidebar history
 * when a chat is modified. It handles:
 * - Optimistic UI updates (moving chat to top immediately)
 * - Cross-tab synchronization via BroadcastChannel
 * - Recording local changes for echo filtering
 *
 * Use this hook in any component that modifies a chat to ensure the sidebar
 * reflects the change immediately across all tabs.
 */
export function useSidebarUpdate() {
  const { bumpChatToTop, recordLocalChange } = useEncryptedCache();

  /**
   * Bump a chat to the top of the sidebar history.
   *
   * This should be called whenever a chat is updated in any way:
   * - Message sent, edited, or regenerated
   * - Chat renamed
   * - Chat created
   * - Branch switched
   * - Settings changed
   *
   * @param chatId - The ID of the chat to bump
   */
  const updateSidebarForChat = useCallback(
    (chatId: string) => {
      // Record this as a local change to filter out realtime echoes
      recordLocalChange(chatId);

      // Optimistically move the chat to the top of the sidebar
      bumpChatToTop(chatId);

      // Notify other tabs about the update
      const syncManager = getSyncManager();
      syncManager?.notifyMessagesUpdated(chatId);
    },
    [bumpChatToTop, recordLocalChange]
  );

  return { updateSidebarForChat };
}
