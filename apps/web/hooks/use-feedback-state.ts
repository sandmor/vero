'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

export function useFeedbackState(initialState: FeedbackState = 'idle') {
  const [state, setState] = useState<FeedbackState>(initialState);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const setFeedbackState = useCallback(
    (newState: FeedbackState, timeout?: number) => {
      setState(newState);
      if (newState === 'idle') return;

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      if (timeout) {
        timerRef.current = window.setTimeout(() => {
          setState('idle');
          timerRef.current = null;
        }, timeout);
      }
    },
    []
  );

  return [state, setFeedbackState] as const;
}
