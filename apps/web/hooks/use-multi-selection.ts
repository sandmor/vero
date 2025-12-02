import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from 'react';

export type MultiSelectionOptions = {
  /** Delay in milliseconds before a long press toggles selection mode. */
  longPressDelay?: number;
  /** Movement threshold in pixels before a long press is canceled. */
  longPressMoveThreshold?: number;
};

export type MultiSelectionResult<T extends string> = {
  /** Whether the UI is currently in selection mode. */
  isSelectionMode: boolean;
  /** Read-only set of selected identifiers. */
  selectedSet: ReadonlySet<T>;
  /** Ordered array of selected identifiers for rendering. */
  selectedIds: T[];
  /** Convenience count of selected identifiers. */
  selectedCount: number;
  /** Checks if an identifier is selected. */
  isSelected: (id: T) => boolean;
  /** Enables selection mode without modifying the selection. */
  startSelectionMode: () => void;
  /** Clears the selection and exits selection mode. */
  stopSelectionMode: () => void;
  /** Toggles selection state for a single id. */
  toggleSelection: (id: T) => void;
  /** Replaces the current selection set. */
  setSelection: (ids: Iterable<T>) => void;
  /** Selects every identifier from the provided iterable. */
  selectAll: (ids: Iterable<T>) => void;
  /**
   * Handles range selection: selects all ids between last toggled id and the provided id,
   * using the order defined in the iterable passed at invocation.
   */
  toggleSelectionRange: (id: T, orderedIds: readonly T[]) => void;
  /**
   * Initiates the long-press timer for touch/mouse devices. Optional callback fires once
   * selection mode begins via long press.
   */
  handlePressStart: (id: T, onInitiated?: () => void) => void;
  /** Clears any pending long-press timer without altering selection state. */
  handlePressEnd: () => void;
  /** Handles touch start events, enabling movement tracking. */
  handleTouchStart: (
    id: T,
    event: ReactTouchEvent<HTMLElement>,
    onInitiated?: () => void
  ) => void;
  /** Handles touch move events; returns true when long press was canceled. */
  handleTouchMove: (event: ReactTouchEvent<HTMLElement>) => boolean;
  /** Handles touch end/cancel events; returns true when long press was canceled. */
  handleTouchEnd: () => boolean;
  /** Returns the latest ordered selection. */
  getSelectedIds: () => T[];
  /** Removes all provided identifiers from the selection. */
  removeFromSelection: (ids: Iterable<T>) => void;
};

export function useMultiSelection<T extends string>(
  options: MultiSelectionOptions = {}
): MultiSelectionResult<T> {
  const { longPressDelay = 500, longPressMoveThreshold = 8 } = options;
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<T>>(new Set());
  const lastSelectedRef = useRef<T | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovementCanceledRef = useRef(false);

  const startSelectionMode = useCallback(() => {
    setIsSelectionMode(true);
  }, []);

  const stopSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedSet(new Set());
    lastSelectedRef.current = null;
  }, []);

  const isSelected = useCallback((id: T) => selectedSet.has(id), [selectedSet]);

  const setSelection = useCallback((ids: Iterable<T>) => {
    const next = new Set<T>();
    for (const id of ids) {
      next.add(id);
    }
    setSelectedSet(next);
    setIsSelectionMode(next.size > 0);
    lastSelectedRef.current = null;
  }, []);

  const toggleSelection = useCallback((id: T) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      if (next.size === 0) {
        setIsSelectionMode(false);
        lastSelectedRef.current = null;
      } else {
        setIsSelectionMode(true);
        lastSelectedRef.current = id;
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: Iterable<T>) => {
    const next = new Set<T>();
    for (const id of ids) {
      next.add(id);
    }
    setSelectedSet(next);
    setIsSelectionMode(next.size > 0);
    lastSelectedRef.current = null;
  }, []);

  const toggleSelectionRange = useCallback(
    (id: T, orderedIds: readonly T[]) => {
      setSelectedSet((prev) => {
        if (!orderedIds.length) return prev;
        const next = new Set(prev);
        const anchor = lastSelectedRef.current ?? id;
        const startIndex = orderedIds.indexOf(anchor);
        const endIndex = orderedIds.indexOf(id);
        if (startIndex === -1 || endIndex === -1) {
          next.add(id);
        } else {
          const [from, to] =
            startIndex <= endIndex
              ? [startIndex, endIndex]
              : [endIndex, startIndex];
          for (let index = from; index <= to; index += 1) {
            next.add(orderedIds[index]);
          }
        }
        lastSelectedRef.current = id;
        setIsSelectionMode(true);
        return next;
      });
    },
    []
  );

  const handlePressStart = useCallback(
    (id: T, onInitiated?: () => void) => {
      if (isSelectionMode) return;
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressTimerRef.current = setTimeout(() => {
        startSelectionMode();
        toggleSelection(id);
        if (onInitiated) {
          onInitiated();
        }
      }, longPressDelay);
    },
    [isSelectionMode, longPressDelay, startSelectionMode, toggleSelection]
  );

  const handlePressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback(
    (id: T, event: ReactTouchEvent<HTMLElement>, onInitiated?: () => void) => {
      if (isSelectionMode) return;
      const touch = event.touches[0];
      touchStartPointRef.current = touch
        ? { x: touch.clientX, y: touch.clientY }
        : null;
      touchMovementCanceledRef.current = false;
      handlePressStart(id, onInitiated);
    },
    [handlePressStart, isSelectionMode]
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (isSelectionMode) return false;
      if (touchMovementCanceledRef.current) return true;
      const touch = event.touches[0];
      const start = touchStartPointRef.current;
      if (!touch || !start) return false;
      const deltaX = Math.abs(touch.clientX - start.x);
      const deltaY = Math.abs(touch.clientY - start.y);
      if (deltaX > longPressMoveThreshold || deltaY > longPressMoveThreshold) {
        touchMovementCanceledRef.current = true;
        touchStartPointRef.current = null;
        handlePressEnd();
        return true;
      }
      return false;
    },
    [handlePressEnd, isSelectionMode, longPressMoveThreshold]
  );

  const handleTouchEnd = useCallback(() => {
    const wasCanceled = touchMovementCanceledRef.current;
    touchStartPointRef.current = null;
    touchMovementCanceledRef.current = false;
    handlePressEnd();
    return wasCanceled;
  }, [handlePressEnd]);

  const selectedIds = useMemo(() => Array.from(selectedSet), [selectedSet]);
  const selectedCount = selectedIds.length;
  const selectedIdsRef = useRef(selectedIds);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const getSelectedIds = useCallback(() => {
    return selectedIdsRef.current.slice();
  }, []);

  const removeFromSelection = useCallback((ids: Iterable<T>) => {
    const toRemove = Array.isArray(ids) ? ids : Array.from(ids);
    if (toRemove.length === 0) {
      return;
    }

    setSelectedSet((prev) => {
      if (prev.size === 0) {
        return prev;
      }

      const next = new Set(prev);
      let changed = false;
      for (const id of toRemove) {
        if (next.delete(id)) {
          changed = true;
        }
      }

      if (!changed) {
        return prev;
      }

      if (next.size === 0) {
        setIsSelectionMode(false);
        lastSelectedRef.current = null;
      }

      return next;
    });
  }, []);

  return {
    isSelectionMode,
    selectedSet,
    selectedIds,
    selectedCount,
    isSelected,
    startSelectionMode,
    stopSelectionMode,
    toggleSelection,
    setSelection,
    selectAll,
    toggleSelectionRange,
    handlePressStart,
    handlePressEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    getSelectedIds,
    removeFromSelection,
  };
}
