'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  CircleAlert,
  Settings2,
  User,
  UserCheck,
} from 'lucide-react';

import { TierModelPicker } from '@/components/admin/tier-model-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { cn } from '@/lib/utils';
import type { TierRecordWithModels } from '@/lib/ai/tiers';
import type { CatalogEntry } from '@/lib/ai/model-capabilities/types';

// ============================================================================
// Types
// ============================================================================

export type TierActionState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

export type TierEditorProps = {
  id: 'guest' | 'regular';
  tier: TierRecordWithModels;
  action: (
    prevState: TierActionState,
    formData: FormData
  ) => Promise<TierActionState>;
};

const INITIAL_STATE: TierActionState = { status: 'idle' };

const TIER_CONFIG = {
  guest: {
    title: 'Guest Tier',
    description: 'Rate limits and available models for anonymous visitors',
  },
  regular: {
    title: 'Regular Tier',
    description: 'Rate limits and available models for signed-in users',
  },
} as const;

// ============================================================================
// Component: RateLimitInput
// ============================================================================

function RateLimitInput({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  defaultValue: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        name={name}
        type="number"
        min={1}
        step={1}
        defaultValue={defaultValue}
        className="h-9"
        required
      />
      {hint && <p className="text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

// ============================================================================
// Component: TierEditor
// ============================================================================

export function TierEditor({ id, tier, action }: TierEditorProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [showSuccess, setShowSuccess] = useState(false);
  const [models, setModels] = useState<string[]>(tier.modelIds);
  // Track catalog entries for models added from the catalog (need to create Model/ModelProvider)
  const catalogEntriesRef = useRef<Map<string, CatalogEntry>>(new Map());

  // Callback when models are added from catalog
  const handleModelsAdded = useCallback((entries: CatalogEntry[]) => {
    for (const entry of entries) {
      const modelId = entry.suggestedModelId ?? entry.providerModelId;
      if (modelId) {
        catalogEntriesRef.current.set(modelId, entry);
      }
    }
  }, []);

  // Sync models when tier prop changes
  useEffect(() => {
    setModels(tier.modelIds);
    catalogEntriesRef.current.clear();
  }, [tier.modelIds]);

  // Handle success state
  useEffect(() => {
    if (state.status === 'success') {
      setShowSuccess(true);
      const timeout = window.setTimeout(() => setShowSuccess(false), 2000);
      window.dispatchEvent(new CustomEvent('settings:tiers-updated'));
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [state.status]);

  const config = TIER_CONFIG[id];

  const statusMessage = useMemo(() => {
    if (state.status === 'error') return state.message;
    if (state.status === 'success') return state.message ?? 'Changes saved';
    return undefined;
  }, [state]);

  return (
    <motion.form
      action={formAction}
      className={cn(
        'relative rounded-xl border bg-card/50 backdrop-blur-sm transition-shadow',
        'hover:shadow-md focus-within:ring-2 focus-within:ring-primary/20',
        isPending && 'opacity-90'
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Progress indicator */}
      <AnimatePresence>
        {isPending && (
          <motion.div
            className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="h-full bg-linear-to-r from-primary/60 via-primary to-primary/60"
              animate={{ x: ['-100%', '100%'] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            {id === 'guest' ? (
              <User className="h-5 w-5 text-muted-foreground" />
            ) : (
              <UserCheck className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <h3 className="font-semibold">{config.title}</h3>
            <p className="text-xs text-muted-foreground">
              {config.description}
            </p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {showSuccess && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div className="space-y-4 px-4 pb-4">
        {/* Model Picker */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Available Models</span>
          </div>
          <TierModelPicker
            value={models}
            onChange={setModels}
            onModelsAdded={handleModelsAdded}
            name="modelIds"
          />
          {/* Pass catalog entries as JSON for server-side Model/ModelProvider creation */}
          <input
            type="hidden"
            name="catalogEntries"
            value={JSON.stringify(
              Array.from(catalogEntriesRef.current.entries()).map(
                ([modelId, entry]) => ({
                  modelId,
                  entry,
                })
              )
            )}
          />
        </div>

        {/* Rate Limit Settings */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Rate Limits</span>
            <span className="text-xs text-muted-foreground">
              (token bucket)
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <RateLimitInput
              label="Bucket Capacity"
              name="bucketCapacity"
              defaultValue={tier.bucketCapacity}
              hint="Max burst allowance"
            />
            <RateLimitInput
              label="Refill Amount"
              name="bucketRefillAmount"
              defaultValue={tier.bucketRefillAmount}
              hint="Tokens added per interval"
            />
            <RateLimitInput
              label="Refill Interval (sec)"
              name="bucketRefillIntervalSeconds"
              defaultValue={tier.bucketRefillIntervalSeconds}
              hint="Seconds between refills"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-3">
        <AnimatePresence mode="wait">
          {statusMessage && (
            <motion.p
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                state.status === 'error'
                  ? 'text-destructive'
                  : 'text-emerald-600'
              )}
            >
              {state.status === 'error' ? (
                <CircleAlert className="h-3.5 w-3.5" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {statusMessage}
            </motion.p>
          )}
        </AnimatePresence>

        <input type="hidden" name="id" value={id} />

        <Button
          type="submit"
          disabled={isPending}
          size="sm"
          className="ml-auto"
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
            idleLabel="Save Changes"
            loadingLabel="Saving..."
            successLabel="Saved!"
            errorLabel="Try Again"
          />
        </Button>
      </div>
    </motion.form>
  );
}
