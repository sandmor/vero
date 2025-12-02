'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, CircleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { SUPPORTED_PROVIDERS, displayProviderName } from '@/lib/ai/registry';
import { UserModelManager } from '@/components/shared/user-model-manager';
import { DataExportImport } from '@/components/data-export-import';
import type { UserPreferences } from '@/lib/db/schema';

type FeedbackState = 'idle' | 'saved' | 'deleted' | 'error';

export function UserPreferencesEditor() {
  const router = useRouter();
  const [name, setName] = useState<string>('');
  const [occupation, setOccupation] = useState<string>('');
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [isProfileLoading, setIsProfileLoading] = useState<boolean>(true);

  // API Keys state
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [selectedModels, setSelectedModels] = useState<
    Record<string, string[]>
  >({});
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>(
    () =>
      Object.fromEntries(
        SUPPORTED_PROVIDERS.map((provider) => [provider, 'idle'] as const)
      ) as Record<string, FeedbackState>
  );
  const feedbackTimers = useRef<Record<string, number>>({});

  // Load preferences first (for immediate UI)
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const response = await fetch('/api/user/preferences');
        if (response.ok) {
          const data = await response.json();
          const preferences = data.preferences as UserPreferences | null;
          if (preferences) {
            setName(preferences.name || '');
            setOccupation(preferences.occupation || '');
            setCustomInstructions(preferences.customInstructions || '');
          }
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
        toast({
          type: 'error',
          description: 'Failed to load preferences',
        });
      } finally {
        setIsProfileLoading(false);
      }
    };
    loadPreferences();
  }, []);

  // Load API keys in background (non-blocking)
  useEffect(() => {
    const loadApiData = async () => {
      try {
        const [keysResponse, modelsResponse] = await Promise.all([
          fetch('/api/user/keys'),
          fetch('/api/user/models'),
        ]);

        // Load API keys
        if (keysResponse.ok) {
          const keysData = await keysResponse.json();
          setKeys(keysData.keys || {});
        }

        // Load model selections
        if (modelsResponse.ok) {
          const modelsData = await modelsResponse.json();
          setSelectedModels(modelsData.userSelections || {});
        }
      } catch (error) {
        console.error('Failed to load API data:', error);
        // Don't show toast for background loading errors to avoid spam
      }
    };
    loadApiData();
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (preferences: UserPreferences) => {
      const response = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save preferences');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        type: 'success',
        description: 'Preferences saved successfully',
      });
      router.refresh();
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to save preferences',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/user/preferences', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to clear preferences');
      }

      return response.json();
    },
    onSuccess: () => {
      setName('');
      setOccupation('');
      setCustomInstructions('');
      toast({
        type: 'success',
        description: 'Preferences cleared successfully',
      });
      router.refresh();
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to clear preferences',
      });
    },
  });

  const handleSave = async () => {
    const preferences: UserPreferences = {
      ...(name.trim() && { name: name.trim() }),
      ...(occupation.trim() && { occupation: occupation.trim() }),
      ...(customInstructions.trim() && {
        customInstructions: customInstructions.trim(),
      }),
    };

    try {
      await saveMutation.mutateAsync(preferences);
    } catch {
      // Error handled in onError
    }
  };

  const handleClear = async () => {
    try {
      await deleteMutation.mutateAsync();
    } catch {
      // Error handled in onError
    }
  };

  // API Keys functionality
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

  const saveKeyMutation = useMutation({
    mutationFn: async ({
      providerId,
      apiKey,
    }: {
      providerId: string;
      apiKey: string;
    }) => {
      const modelIds = selectedModels[providerId] || [];
      const response = await fetch('/api/user/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          apiKey,
          modelIds,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to save API key');
      }

      return { providerId };
    },
    onSuccess: (_, variables) => {
      toast({
        type: 'success',
        description: `${displayProviderName(variables.providerId)} saved`,
      });
      setFeedbackState(variables.providerId, 'saved');
      router.refresh();
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : `Failed to save ${displayProviderName(variables.providerId)}`,
      });
      setFeedbackState(variables.providerId, 'error', 2200);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async ({ providerId }: { providerId: string }) => {
      const response = await fetch(
        `/api/user/keys?providerId=${encodeURIComponent(providerId)}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to delete API key');
      }

      return { providerId };
    },
    onSuccess: (_, variables) => {
      setKeys((k) => ({ ...k, [variables.providerId]: '' }));
      toast({
        type: 'success',
        description: `${displayProviderName(variables.providerId)} removed`,
      });
      setFeedbackState(variables.providerId, 'deleted');
      router.refresh();
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error
            ? error.message
            : `Failed to delete ${displayProviderName(variables.providerId)}`,
      });
      setFeedbackState(variables.providerId, 'error', 2200);
    },
  });

  async function saveKey(providerId: string) {
    const apiKey = keys[providerId]?.trim();

    if (!apiKey) {
      toast({
        type: 'error',
        description: 'Enter an API key before saving.',
      });
      return;
    }

    try {
      await saveKeyMutation.mutateAsync({ providerId, apiKey });
    } catch {
      // handled via onError
    }
  }

  async function removeKey(providerId: string) {
    try {
      await deleteKeyMutation.mutateAsync({ providerId });
    } catch {
      // handled via onError
    }
  }

  function handleModelSelectionChange(providerId: string, modelIds: string[]) {
    setSelectedModels((prev) => ({
      ...prev,
      [providerId]: modelIds,
    }));
  }

  if (isProfileLoading) {
    return (
      <div className="space-y-10 px-2 py-6 max-w-5xl mx-auto w-full animate-in fade-in-0 slide-in-from-bottom-4">
        {/* Profile skeleton */}
        <div className="rounded-3xl border border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur">
          <div className="mb-2">
            <Skeleton className="h-6 w-40" />
            <div className="mt-2">
              <Skeleton className="h-4 w-72" />
            </div>
          </div>

          <div className="space-y-4 mt-4">
            <div className="space-y-2">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-4 w-40" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-10 w-1/3" />
              <Skeleton className="h-4 w-40" />
            </div>

            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-4 w-56" />
            </div>

            <div className="flex gap-2 pt-4">
              <Skeleton className="h-10 w-1/2 rounded-lg" />
              <Skeleton className="h-10 w-1/4 rounded-lg" />
            </div>
          </div>
        </div>

        {/* API keys skeleton */}
        <div className="rounded-3xl border border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur">
          <div className="mb-2">
            <Skeleton className="h-6 w-40" />
            <div className="mt-2">
              <Skeleton className="h-4 w-80" />
            </div>
          </div>

          <div className="space-y-4 mt-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-border/60 p-4">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                  <Skeleton className="h-10 md:flex-1 w-full" />
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-10 w-24 rounded-md" />
                    <Skeleton className="h-10 w-24 rounded-md" />
                  </div>
                </div>
                <div className="mt-3">
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 px-2 py-6 max-w-5xl mx-auto w-full animate-in fade-in-0 slide-in-from-bottom-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Personalize your AI assistant by providing your name, occupation, and
        custom instructions. These preferences will be used to tailor responses
        to your specific needs and context.
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1] }}
      >
        <Card className="border-border/60 bg-card/40 backdrop-blur">
          <CardHeader>
            <CardTitle>User Profile</CardTitle>
            <CardDescription>
              Basic information about you that helps personalize the AI
              responses
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How you'd like the AI to address you
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="occupation">Occupation</Label>
              <Input
                id="occupation"
                placeholder="Your occupation or role"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Helps the AI understand your background and expertise
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="customInstructions">Custom Instructions</Label>
              <Textarea
                id="customInstructions"
                placeholder="Any specific instructions for how the AI should interact with you..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Specific preferences for AI behavior, communication style, or
                context
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
                className="flex-1"
              >
                <motion.div
                  whileTap={{ scale: 0.97 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                  }}
                  className="flex items-center gap-2"
                >
                  <AnimatedButtonLabel
                    state={saveMutation.isPending ? 'loading' : 'idle'}
                    idleLabel="Save Preferences"
                    loadingLabel="Saving..."
                  />
                </motion.div>
              </Button>

              <Button
                variant="outline"
                onClick={handleClear}
                disabled={
                  deleteMutation.isPending ||
                  (!name && !occupation && !customInstructions)
                }
              >
                <motion.div
                  whileTap={{ scale: 0.97 }}
                  transition={{
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                  }}
                  className="flex items-center gap-2"
                >
                  <AnimatedButtonLabel
                    state={deleteMutation.isPending ? 'loading' : 'idle'}
                    idleLabel="Clear All"
                    loadingLabel="Clearing..."
                  />
                </motion.div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1], delay: 0.1 }}
      >
        <Card className="border-border/60 bg-card/40 backdrop-blur">
          <CardHeader>
            <CardTitle>API Keys</CardTitle>
            <CardDescription>
              Add your own API keys to use with supported providers. These keys
              are stored securely and used only for your requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {SUPPORTED_PROVIDERS.map((p, index) => {
              const trimmedValue = keys[p]?.trim() ?? '';
              const isSaving =
                saveKeyMutation.isPending &&
                saveKeyMutation.variables?.providerId === p;
              const isDeleting =
                deleteKeyMutation.isPending &&
                deleteKeyMutation.variables?.providerId === p;
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
                          transition={{
                            type: 'spring',
                            stiffness: 420,
                            damping: 32,
                          }}
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
                                  setKeys((k) => ({
                                    ...k,
                                    [p]: e.target.value,
                                  }))
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
                                    onClick={() => saveKey(p)}
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
                                  disabled={isDeleting || !trimmedValue}
                                >
                                  <motion.button
                                    type="button"
                                    onClick={() => removeKey(p)}
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
                            <div className="mt-3">
                              <UserModelManager
                                provider={p}
                                selectedModelIds={selectedModels[p] || []}
                                onModelSelectionChange={(modelIds: string[]) =>
                                  handleModelSelectionChange(p, modelIds)
                                }
                              />
                            </div>

                            <p className="mt-2 text-xs text-muted-foreground">
                              Your {displayProviderName(p)} API key is stored
                              securely and will only be used for the selected
                              models.
                              {selectedModels[p]?.length > 0 ? (
                                <span className="block mt-1 text-primary/70">
                                  <strong>{selectedModels[p].length}</strong>{' '}
                                  model
                                  {selectedModels[p].length === 1
                                    ? ''
                                    : 's'}{' '}
                                  selected for BYOK usage.
                                </span>
                              ) : (
                                <span className="block mt-1 text-muted-foreground/70">
                                  No models selected - global key will be used.
                                </span>
                              )}
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
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1], delay: 0.2 }}
      >
        <DataExportImport />
      </motion.div>
    </div>
  );
}
