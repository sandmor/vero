'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from '@/components/toast';

type RefreshState = 'idle' | 'loading' | 'success';

export function CatalogRefreshButton() {
  const [state, setState] = useState<RefreshState>('idle');
  const lastClickRef = useRef<number>(0);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, []);

  async function refresh(force = true) {
    const now = Date.now();
    // 1.5s debounce window
    if (now - lastClickRef.current < 1500) {
      toast({
        type: 'error',
        description: 'Please wait before refreshing again',
      });
      return;
    }
    lastClickRef.current = now;
    setState('loading');
    try {
      window.dispatchEvent(
        new CustomEvent('catalog:refresh', { detail: { force } })
      );
      toast({ type: 'success', description: 'Refreshing model catalog…' });
      setState('success');
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setState('idle'), 1500);
    } catch (error) {
      console.error('Catalog refresh dispatch failed', error);
      toast({ type: 'error', description: 'Unable to refresh catalog.' });
      setState('idle');
    }
  }

  const disabled = state === 'loading';

  return (
    <Button
      asChild
      type="button"
      variant="secondary"
      size="sm"
      disabled={disabled}
    >
      <motion.button
        onClick={() => refresh(true)}
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 420, damping: 28 }}
        className="flex items-center gap-2"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {state === 'loading' ? (
            <motion.span
              key="loading"
              className="flex items-center gap-2"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Refreshing…
            </motion.span>
          ) : state === 'success' ? (
            <motion.span
              key="success"
              className="flex items-center gap-2 text-emerald-500"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <CheckCircle2 className="h-4 w-4" />
              Refreshed
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="flex items-center gap-2"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh model catalog
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </Button>
  );
}
