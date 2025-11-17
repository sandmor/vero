// hooks/utils/tree-update.ts
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import { areSelectionSnapshotsEqual } from './selection-snapshot';

export type TreeUpdateDeferOptions = {
  allowDuringStreaming?: boolean;
  ignoreSelectionAlignment?: boolean;
};

/**
 * Determines if a tree update should be deferred based on current state
 */
export function shouldDeferTreeUpdate({
  isStreaming,
  desiredSelection,
  treeSelection,
  options,
}: {
  isStreaming: boolean;
  desiredSelection: BranchSelectionSnapshot | null;
  treeSelection: BranchSelectionSnapshot | null;
  options?: TreeUpdateDeferOptions;
}): boolean {
  const allowDuringStreaming = options?.allowDuringStreaming ?? false;
  const ignoreSelectionAlignment = options?.ignoreSelectionAlignment ?? false;

  // Defer if streaming (unless explicitly allowed)
  if (!allowDuringStreaming && isStreaming) {
    return true;
  }

  // Defer if selections don't match (unless explicitly ignored)
  if (
    !ignoreSelectionAlignment &&
    desiredSelection !== null &&
    treeSelection !== null &&
    !areSelectionSnapshotsEqual(desiredSelection, treeSelection)
  ) {
    return true;
  }

  return false;
}
