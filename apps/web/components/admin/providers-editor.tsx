'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, CircleAlert, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { SUPPORTED_PROVIDERS, displayProviderName } from '@/lib/ai/registry';

type FeedbackState = 'idle' | 'saved' | 'deleted' | 'error';

export function ProvidersEditor({
  initialKeys,
}: {
  initialKeys: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<Record<string, string>>(
    Object.fromEntries(
      SUPPORTED_PROVIDERS.map((p) => [p, initialKeys[p] || '']) as Array<
        [string, string]
      >
    )
  );
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>(
    () =>
      Object.fromEntries(
        SUPPORTED_PROVIDERS.map((provider) => [provider, 'idle'] as const)
      ) as Record<string, FeedbackState>
  );
  const feedbackTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(feedbackTimers.current).forEach((timer) =>
        window.clearTimeout(timer)
      );
    };
  }, []);

  const setFeedbackState = (id: string, state: FeedbackState, ttl = 1600) => {
    setFeedback((prev) => ({ ...prev, [id]: state }));
    if (state === 'idle') return;
    if (feedbackTimers.current[id]) {
      window.clearTimeout(feedbackTimers.current[id]);
    }
    feedbackTimers.current[id] = window.setTimeout(() => {
      setFeedback((prev) => ({ ...prev, [id]: 'idle' }));
      delete feedbackTimers.current[id];
    }, ttl);
  };

  const saveMutation = useMutation({
    mutationFn: async ({ id, apiKey }: { id: string; apiKey: string }) => {
      const response = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, apiKey }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save provider override');
      }

      return { id };
    },
    onSuccess: (_, variables) => {
      toast({
        type: 'success',
        description: `${displayProviderName(variables.id)} saved`,
      });
      setFeedbackState(variables.id, 'saved');
      router.refresh();
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : `Failed to save ${displayProviderName(variables.id)}`,
      });
      setFeedbackState(variables.id, 'error', 2200);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const response = await fetch(
        `/api/admin/providers?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to delete provider override');
      }

      return { id };
    },
    onSuccess: (_, variables) => {
      setKeys((k) => ({ ...k, [variables.id]: '' }));
      toast({
        type: 'success',
        description: `${displayProviderName(variables.id)} removed`,
      });
      setFeedbackState(variables.id, 'deleted');
      router.refresh();
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : `Failed to delete ${displayProviderName(variables.id)}`,
      });
      setFeedbackState(variables.id, 'error', 2200);
    },
  });

  async function save(id: string) {
    const apiKey = keys[id]?.trim();

    if (!apiKey) {
      toast({ type: 'error', description: 'Enter an API key before saving.' });
      return;
    }

    try {
      await saveMutation.mutateAsync({ id, apiKey });
    } catch {
      // handled via onError
    }
  }

  async function remove(id: string) {
    try {
      await deleteMutation.mutateAsync({ id });
    } catch {
      // handled via onError
    }
  }

  return (
    <div className="space-y-3">
      {SUPPORTED_PROVIDERS.map((p, index) => {
        const trimmedValue = keys[p]?.trim() ?? '';
        const isSaving =
          saveMutation.isPending && saveMutation.variables?.id === p;
        const isDeleting =
          deleteMutation.isPending && deleteMutation.variables?.id === p;
        const status = feedback[p] ?? 'idle';

        return (
          <motion.div
            key={p}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.2 }}
          >
            <Collapsible
              open={open[p] ?? false}
              onOpenChange={(o) => setOpen((s) => ({ ...s, [p]: o }))}
            >
              <CollapsibleTrigger asChild>
                <Button
                  asChild
                  variant="outline"
                  className="w-full justify-between rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/30 hover:bg-card/80"
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="flex w-full items-center justify-between"
                  >
                    <span className="font-medium tracking-tight">
                      {displayProviderName(p)}
                    </span>
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground/80">
                      <AnimatePresence initial={false} mode="popLayout">
                        {status === 'saved' || status === 'deleted' ? (
                          <motion.span
                            key="status-pill"
                            className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-500"
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.18 }}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {status === 'deleted' ? 'Removed' : 'Saved'}
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                      <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                    </div>
                  </motion.button>
                </Button>
              </CollapsibleTrigger>

              <AnimatePresence initial={false}>
                {open[p] ? (
                  <CollapsibleContent forceMount asChild>
                    <motion.div
                      key="content"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="mt-3 rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm backdrop-blur"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <Input
                          type="password"
                          placeholder={`${displayProviderName(p)} API key`}
                          value={keys[p] || ''}
                          onChange={(e) =>
                            setKeys((k) => ({ ...k, [p]: e.target.value }))
                          }
                          className="md:flex-1"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            asChild
                            disabled={
                              isSaving ||
                              isDeleting ||
                              trimmedValue.length === 0
                            }
                          >
                            <motion.button
                              type="button"
                              onClick={() => save(p)}
                              whileTap={{ scale: 0.97 }}
                              transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 32,
                              }}
                              className="flex items-center gap-2"
                            >
                              <AnimatedButtonLabel
                                state={
                                  isSaving
                                    ? 'loading'
                                    : status === 'saved'
                                      ? 'success'
                                      : status === 'error'
                                        ? 'error'
                                        : 'idle'
                                }
                                idleLabel="Save"
                                loadingLabel="Saving…"
                                successLabel="Saved"
                                errorLabel="Error"
                              />
                            </motion.button>
                          </Button>
                          <Button
                            asChild
                            variant="destructive"
                            disabled={isDeleting}
                          >
                            <motion.button
                              type="button"
                              onClick={() => remove(p)}
                              whileTap={{ scale: 0.97 }}
                              transition={{
                                type: 'spring',
                                stiffness: 420,
                                damping: 32,
                              }}
                              className="flex items-center gap-2"
                            >
                              <AnimatedButtonLabel
                                state={
                                  isDeleting
                                    ? 'loading'
                                    : status === 'deleted'
                                      ? 'success'
                                      : status === 'error'
                                        ? 'error'
                                        : 'idle'
                                }
                                idleLabel="Delete"
                                loadingLabel="Removing…"
                                successLabel="Removed"
                                errorLabel="Error"
                              />
                            </motion.button>
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        This stores an override for {p} in the database. If
                        absent, the app will fall back to environment variables.
                      </p>
                      <AnimatePresence initial={false}>
                        {status === 'error' ? (
                          <motion.p
                            key="error"
                            className="mt-2 flex items-center gap-1 text-xs text-destructive"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.18 }}
                          >
                            <CircleAlert className="h-3.5 w-3.5" />
                            Something went wrong. Try again.
                          </motion.p>
                        ) : null}
                      </AnimatePresence>
                    </motion.div>
                  </CollapsibleContent>
                ) : null}
              </AnimatePresence>
            </Collapsible>
          </motion.div>
        );
      })}
      <Separator />
    </div>
  );
}
