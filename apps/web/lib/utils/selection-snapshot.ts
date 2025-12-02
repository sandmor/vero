// hooks/utils/selection-snapshot.ts
import type { MessageTreeResult } from '@/lib/db/schema';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

/**
 * Builds a selection snapshot from a message tree
 */
export const buildSelectionSnapshot = (
  tree: MessageTreeResult
): BranchSelectionSnapshot => {
  const selections: Record<string, number | null> = {};

  for (const node of tree.nodes) {
    if (node.selectedChildIndex !== undefined) {
      selections[node.id] = node.selectedChildIndex ?? null;
    }
  }

  const normalizedSelections = Object.keys(selections).length
    ? selections
    : undefined;

  return {
    rootMessageIndex: tree.rootMessageIndex ?? null,
    ...(normalizedSelections ? { selections: normalizedSelections } : {}),
  };
};

/**
 * Deep clone a selection snapshot
 */
export const cloneSelectionSnapshot = (
  snapshot: BranchSelectionSnapshot
): BranchSelectionSnapshot => {
  const selectionsEntries = snapshot.selections
    ? Object.entries(snapshot.selections)
    : [];
  const selections = selectionsEntries.length
    ? Object.fromEntries(
        selectionsEntries.map(([messageId, index]) => [
          messageId,
          index ?? null,
        ])
      )
    : undefined;

  return {
    rootMessageIndex: snapshot.rootMessageIndex ?? null,
    ...(selections ? { selections } : {}),
  };
};

/**
 * Compares two selection snapshots for equality
 */
export const areSelectionSnapshotsEqual = (
  a: BranchSelectionSnapshot | null,
  b: BranchSelectionSnapshot | null
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;

  if ((a.rootMessageIndex ?? null) !== (b.rootMessageIndex ?? null)) {
    return false;
  }

  const aSelections = a.selections ?? {};
  const bSelections = b.selections ?? {};
  const aKeys = Object.keys(aSelections);
  const bKeys = Object.keys(bSelections);

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    if ((aSelections[key] ?? null) !== (bSelections[key] ?? null)) {
      return false;
    }
  }

  return true;
};

/**
 * Ensures that a selection snapshot has a selections map
 */
export const ensureSelectionMap = (
  snapshot: BranchSelectionSnapshot
): Record<string, number | null> => {
  if (!snapshot.selections) {
    snapshot.selections = {};
  }
  return snapshot.selections;
};
