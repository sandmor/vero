'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';

type FeedbackState = 'idle' | 'loading' | 'success' | 'error';

interface AnimatedButtonProps {
  state: FeedbackState;
  idleLabel: string;
  loadingLabel?: string;
  successLabel?: string;
  errorLabel?: string;
  className?: string;
}

export function AnimatedButtonLabel({
  state,
  idleLabel,
  loadingLabel = 'Loading…',
  successLabel = 'Success',
  errorLabel = 'Error',
  className = '',
}: AnimatedButtonProps) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {state === 'loading' ? (
        <motion.span
          key="loading"
          className={`flex items-center gap-2 ${className}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </motion.span>
      ) : state === 'success' ? (
        <motion.span
          key="success"
          className={`flex items-center gap-2 ${className}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <CheckCircle2 className="h-4 w-4" />
          {successLabel}
        </motion.span>
      ) : state === 'error' ? (
        <motion.span
          key="error"
          className={`flex items-center gap-2 ${className}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 0, y: -4 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          <CircleAlert className="h-4 w-4" />
          {errorLabel}
        </motion.span>
      ) : (
        <motion.span
          key="idle"
          className={`flex items-center gap-2 ${className}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {idleLabel}
        </motion.span>
      )}
    </AnimatePresence>
  );
}