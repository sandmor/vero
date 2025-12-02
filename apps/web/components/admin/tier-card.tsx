'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';

import { ModelPickerFormFields } from '@/components/admin/model-picker-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import type { TierRecord } from '@/lib/ai/tiers';

export type TierActionState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

type TierCardProps = {
  id: 'guest' | 'regular';
  tier: TierRecord;
  action: (
    prevState: TierActionState,
    formData: FormData
  ) => Promise<TierActionState>;
};

const INITIAL_STATE: TierActionState = { status: 'idle' };

export function TierCard({ id, tier, action }: TierCardProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      setShowSuccess(true);
      const timeout = window.setTimeout(() => setShowSuccess(false), 1800);
      window.dispatchEvent(new CustomEvent('settings:tiers-updated'));
      return () => window.clearTimeout(timeout);
    }

    if (state.status === 'error') {
      setShowSuccess(false);
    }

    return undefined;
  }, [state.status]);

  const statusMessage = useMemo(() => {
    if (state.status === 'error' && state.message) {
      return state.message;
    }
    if (state.status === 'success') {
      return state.message ?? 'Changes saved';
    }
    return undefined;
  }, [state]);

  return (
    <motion.form
      action={formAction}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-primary/30"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.21, 1.02, 0.73, 1] }}
    >
      <AnimatePresence initial={false}>
        {isPending ? (
          <motion.span
            key="progress"
            className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/80 via-primary to-primary/70"
            initial={{ scaleX: 0, originX: 0 }}
            animate={{ scaleX: 1, originX: 0 }}
            exit={{ scaleX: 0, originX: 1 }}
            transition={{
              duration: 0.8,
              ease: 'easeInOut',
              repeat: Infinity,
              repeatType: 'mirror',
            }}
          />
        ) : null}
      </AnimatePresence>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold capitalize">{id} tier</p>
          <p className="text-xs text-muted-foreground">
            Configure eligible models and throttling for{' '}
            {id === 'guest' ? 'anonymous visitors' : 'signed-in users'}.
          </p>
        </div>
        <AnimatePresence initial={false}>
          {showSuccess ? (
            <motion.span
              key="badge-success"
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="mt-4 space-y-4">
        <ModelPickerFormFields name="modelIds" defaultValue={tier.modelIds} />
        <div className="grid gap-3 sm:grid-cols-3">
          <LabeledNumberInput
            label="Capacity"
            name="bucketCapacity"
            defaultValue={tier.bucketCapacity}
          />
          <LabeledNumberInput
            label="Refill Amt"
            name="bucketRefillAmount"
            defaultValue={tier.bucketRefillAmount}
          />
          <LabeledNumberInput
            label="Refill (s)"
            name="bucketRefillIntervalSeconds"
            defaultValue={tier.bucketRefillIntervalSeconds}
          />
        </div>
      </div>

      <input type="hidden" name="id" value={id} />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button asChild disabled={isPending} type="submit" className="relative">
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 25 }}
            className="flex items-center gap-2"
          >
            <AnimatedButtonLabel
              state={
                isPending
                  ? 'loading'
                  : showSuccess
                    ? 'success'
                    : state.status === 'error'
                      ? 'error'
                      : 'idle'
              }
              idleLabel={`Save ${id}`}
              loadingLabel="Saving…"
              successLabel="Saved"
              errorLabel="Error"
            />
          </motion.button>
        </Button>

        <AnimatePresence initial={false}>
          {statusMessage ? (
            <motion.p
              key="status"
              className={`flex items-center gap-1 text-xs ${state.status === 'error' ? 'text-destructive' : 'text-emerald-500'}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {state.status === 'error' ? (
                <CircleAlert className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {statusMessage}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.form>
  );
}

type LabeledNumberInputProps = {
  label: string;
  name: string;
  defaultValue: number;
};

function LabeledNumberInput({
  label,
  name,
  defaultValue,
}: LabeledNumberInputProps) {
  return (
    <label className="space-y-2">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
        {label}
      </span>
      <Input
        name={name}
        type="number"
        min={1}
        step={1}
        defaultValue={defaultValue}
        className="transition-shadow focus-visible:shadow ring-offset-background"
        required
      />
    </label>
  );
}
