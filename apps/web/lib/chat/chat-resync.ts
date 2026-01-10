import { getSyncManager } from '@/lib/cache/sync-manager';

const MISSING_STATUS_CODES = new Set([401, 403, 404, 410]);
const RESYNC_DEBOUNCE_MS = 2000;

let lastResyncAt = 0;

function shouldTriggerFromStatus(status: number): boolean {
  return MISSING_STATUS_CODES.has(status);
}

async function confirmChatStillExists(chatId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/chat/settings?chatId=${encodeURIComponent(chatId)}`,
      { cache: 'no-store' }
    );

    if (response.ok) return true;

    if (shouldTriggerFromStatus(response.status)) {
      return false;
    }
  } catch (error) {
    // Network or unexpected errors are treated as inconclusive; avoid false positives.
    console.warn('[chat-resync] Failed to confirm chat existence', error);
  }

  return true;
}

function triggerFullResync(reason: string, chatId?: string): boolean {
  const now = Date.now();
  if (now - lastResyncAt < RESYNC_DEBOUNCE_MS) {
    return false;
  }
  lastResyncAt = now;

  const syncManager = getSyncManager();
  if (!syncManager) {
    console.warn('[chat-resync] SyncManager unavailable, cannot resync', {
      reason,
      chatId,
    });
    return false;
  }

  syncManager.requestFullResync(chatId);
  return true;
}

export type ChatActionFailureContext = {
  chatId: string;
  action: string;
  response?: Response;
  error?: unknown;
  confirmIfUnknown?: boolean;
};

/**
 * Centralized handler for chat action failures. Detects stale/missing chat states
 * and triggers a leader-driven full resync when needed.
 *
 * @returns true if a resync was requested.
 */
export async function handleChatActionFailure(
  context: ChatActionFailureContext
): Promise<boolean> {
  const { chatId, action, response, error, confirmIfUnknown = true } = context;

  if (response) {
    if (shouldTriggerFromStatus(response.status)) {
      return triggerFullResync(`${action}:missing`, chatId);
    }
  }

  if (!confirmIfUnknown) {
    return false;
  }

  // If we reach here, the error status was ambiguous or we caught a fetch error.
  const stillExists = await confirmChatStillExists(chatId);
  if (!stillExists) {
    return triggerFullResync(`${action}:confirmed-missing`, chatId);
  }

  // If a non-missing error was thrown, log for observability.
  if (error) {
    console.warn('[chat-resync] Chat action failed but chat still exists', {
      action,
      chatId,
      error,
    });
  }

  return false;
}
