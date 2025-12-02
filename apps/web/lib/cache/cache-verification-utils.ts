import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';

/**
 * Compares two ChatBootstrapResponse objects to determine if they are equivalent
 * @param cached The cached data
 * @param fresh The fresh data from server
 * @returns true if the data is the same, false if there are differences
 */
export async function compareChatBootstrapData(
  cached: ChatBootstrapResponse,
  fresh: ChatBootstrapResponse
): Promise<boolean> {
  // If kinds are different, there's definitely a change
  if (cached.kind !== fresh.kind) {
    return false;
  }

  if (fresh.kind === 'existing') {
    // Compare message IDs and count
    const cachedMessageIds = (cached.initialMessages ?? []).map((m) => m.id);
    const freshMessageIds = (fresh.initialMessages ?? []).map((m) => m.id);

    if (cachedMessageIds.length !== freshMessageIds.length) {
      return false;
    }

    // Check if all message IDs match in order
    for (let i = 0; i < freshMessageIds.length; i++) {
      if (cachedMessageIds[i] !== freshMessageIds[i]) {
        return false;
      }
    }

    // Compare branch state
    const cachedRootIndex = cached.initialBranchState?.rootMessageIndex ?? null;
    const freshRootIndex = fresh.initialBranchState?.rootMessageIndex ?? null;

    if (cachedRootIndex !== freshRootIndex) {
      return false;
    }

    // Compare last context if available
    if (
      JSON.stringify(cached.initialLastContext) !==
      JSON.stringify(fresh.initialLastContext)
    ) {
      return false;
    }
  }

  return true;
}
