'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Edit2,
  Plus,
  Server,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { getAllProviders, displayProviderName } from '@/lib/ai/registry';
import { CreatorLogo } from '@/components/creator-logo';

// Get providers that support BYOK for the API keys section
const byokProviders = getAllProviders().filter((p) => p.supportsByok);

type FeedbackState = 'idle' | 'saved' | 'deleted' | 'error';

type ProviderKeyInfo = {
  hasKey: boolean;
  updatedAt: string;
};

type CustomProvider = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

type ByokModel = {
  id: string;
  fullModelId: string;
  sourceType: 'platform' | 'custom';
  providerId: string | null;
  customProviderId: string | null;
  providerModelId: string;
  displayName: string;
  supportsTools: boolean;
  maxOutputTokens: number | null;
  createdAt: string;
  updatedAt: string;
};

type CustomProviderFormData = {
  slug: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

type ModelFormData = {
  sourceType: 'platform' | 'custom';
  providerId: string;
  customProviderId: string;
  providerModelId: string;
  displayName: string;
  supportsTools: boolean;
  maxOutputTokens: string;
};

const defaultModelForm: ModelFormData = {
  sourceType: 'platform',
  providerId: '',
  customProviderId: '',
  providerModelId: '',
  displayName: '',
  supportsTools: true,
  maxOutputTokens: '',
};

const defaultCustomProviderForm: CustomProviderFormData = {
  slug: '',
  name: '',
  baseUrl: '',
  apiKey: '',
};

export function ByokManager() {
  const queryClient = useQueryClient();

  // Provider keys state
  const [providerOpen, setProviderOpen] = useState<Record<string, boolean>>({});
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
  const feedbackTimers = useRef<Record<string, number>>({});

  // Custom providers dialog
  const [showCustomProviderDialog, setShowCustomProviderDialog] =
    useState(false);
  const [editingCustomProvider, setEditingCustomProvider] =
    useState<CustomProvider | null>(null);
  const [customProviderForm, setCustomProviderForm] =
    useState<CustomProviderFormData>(defaultCustomProviderForm);

  // Model creation/edit dialog
  const [showModelDialog, setShowModelDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<ByokModel | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormData>(defaultModelForm);

  // Queries
  const { data: providerKeysData, isLoading: isLoadingKeys } = useQuery({
    queryKey: ['byok-provider-keys'],
    queryFn: async () => {
      const res = await fetch('/api/user/byok/provider-keys');
      if (!res.ok) throw new Error('Failed to load provider keys');
      return res.json() as Promise<{ keys: Record<string, ProviderKeyInfo> }>;
    },
  });

  const { data: customProvidersData, isLoading: isLoadingCustomProviders } =
    useQuery({
      queryKey: ['byok-custom-providers'],
      queryFn: async () => {
        const res = await fetch('/api/user/byok/custom-providers');
        if (!res.ok) throw new Error('Failed to load custom providers');
        return res.json() as Promise<{ providers: CustomProvider[] }>;
      },
    });

  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['byok-models'],
    queryFn: async () => {
      const res = await fetch('/api/user/byok/models');
      if (!res.ok) throw new Error('Failed to load models');
      return res.json() as Promise<{ models: ByokModel[] }>;
    },
  });

  // Feedback management
  useEffect(() => {
    return () => {
      Object.values(feedbackTimers.current).forEach((timer) =>
        window.clearTimeout(timer)
      );
    };
  }, []);

  const setFeedbackState = useCallback(
    (id: string, state: FeedbackState, ttl = 1600) => {
      setFeedback((prev) => ({ ...prev, [id]: state }));
      if (state === 'idle') return;
      if (feedbackTimers.current[id]) {
        window.clearTimeout(feedbackTimers.current[id]);
      }
      feedbackTimers.current[id] = window.setTimeout(() => {
        setFeedback((prev) => ({ ...prev, [id]: 'idle' }));
        delete feedbackTimers.current[id];
      }, ttl);
    },
    []
  );

  // Provider key mutations
  const saveKeyMutation = useMutation({
    mutationFn: async ({
      providerId,
      apiKey,
    }: {
      providerId: string;
      apiKey: string;
    }) => {
      const res = await fetch('/api/user/byok/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId, apiKey }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to save key');
      }
      return { providerId };
    },
    onSuccess: (_, variables) => {
      toast({
        type: 'success',
        description: `${displayProviderName(variables.providerId)} saved`,
      });
      setFeedbackState(variables.providerId, 'saved');
      queryClient.invalidateQueries({ queryKey: ['byok-provider-keys'] });
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description: error instanceof Error ? error.message : 'Failed to save',
      });
      setFeedbackState(variables.providerId, 'error', 2200);
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async ({ providerId }: { providerId: string }) => {
      const res = await fetch(
        `/api/user/byok/provider-keys?providerId=${encodeURIComponent(providerId)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete key');
      }
      return { providerId };
    },
    onSuccess: (_, variables) => {
      setProviderKeys((k) => ({ ...k, [variables.providerId]: '' }));
      toast({
        type: 'success',
        description: `${displayProviderName(variables.providerId)} removed`,
      });
      setFeedbackState(variables.providerId, 'deleted');
      queryClient.invalidateQueries({ queryKey: ['byok-provider-keys'] });
      queryClient.invalidateQueries({ queryKey: ['byok-models'] });
    },
    onError: (error, variables) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to delete',
      });
      setFeedbackState(variables.providerId, 'error', 2200);
    },
  });

  // Custom provider mutations
  const createCustomProviderMutation = useMutation({
    mutationFn: async (data: CustomProviderFormData) => {
      const res = await fetch('/api/user/byok/custom-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create provider');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Custom provider created' });
      closeCustomProviderDialog();
      queryClient.invalidateQueries({ queryKey: ['byok-custom-providers'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to create',
      });
    },
  });

  const updateCustomProviderMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & Partial<CustomProviderFormData>) => {
      const res = await fetch('/api/user/byok/custom-providers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...data }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to update provider');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Custom provider updated' });
      closeCustomProviderDialog();
      queryClient.invalidateQueries({ queryKey: ['byok-custom-providers'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to update',
      });
    },
  });

  const deleteCustomProviderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/user/byok/custom-providers?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete provider');
      }
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Custom provider deleted' });
      queryClient.invalidateQueries({ queryKey: ['byok-custom-providers'] });
      queryClient.invalidateQueries({ queryKey: ['byok-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to delete',
      });
    },
  });

  // Model mutations
  const createModelMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const payload = {
        sourceType: data.sourceType,
        providerId:
          data.sourceType === 'platform' ? data.providerId : undefined,
        customProviderId:
          data.sourceType === 'custom' ? data.customProviderId : undefined,
        providerModelId: data.providerModelId,
        displayName: data.displayName,
        supportsTools: data.supportsTools,
        maxOutputTokens: data.maxOutputTokens
          ? parseInt(data.maxOutputTokens, 10)
          : null,
      };
      const res = await fetch('/api/user/byok/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to create model');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Model added' });
      closeModelDialog();
      queryClient.invalidateQueries({ queryKey: ['byok-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to create',
      });
    },
  });

  const updateModelMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & Partial<ModelFormData>) => {
      const payload = {
        id,
        displayName: data.displayName,
        supportsTools: data.supportsTools,
        maxOutputTokens: data.maxOutputTokens
          ? parseInt(data.maxOutputTokens, 10)
          : null,
      };
      const res = await fetch('/api/user/byok/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to update model');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Model updated' });
      closeModelDialog();
      queryClient.invalidateQueries({ queryKey: ['byok-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to update',
      });
    },
  });

  const deleteModelMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/user/byok/models?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete model');
      }
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Model removed' });
      queryClient.invalidateQueries({ queryKey: ['byok-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to delete',
      });
    },
  });

  // Dialog management
  const openCustomProviderDialog = (provider?: CustomProvider) => {
    if (provider) {
      setEditingCustomProvider(provider);
      setCustomProviderForm({
        slug: provider.slug,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: '',
      });
    } else {
      setEditingCustomProvider(null);
      setCustomProviderForm(defaultCustomProviderForm);
    }
    setShowCustomProviderDialog(true);
  };

  const closeCustomProviderDialog = () => {
    setShowCustomProviderDialog(false);
    setEditingCustomProvider(null);
    setCustomProviderForm(defaultCustomProviderForm);
  };

  const openModelDialog = (model?: ByokModel) => {
    if (model) {
      setEditingModel(model);
      setModelForm({
        sourceType: model.sourceType,
        providerId: model.providerId || '',
        customProviderId: model.customProviderId || '',
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        supportsTools: model.supportsTools,
        maxOutputTokens: model.maxOutputTokens?.toString() || '',
      });
    } else {
      setEditingModel(null);
      setModelForm(defaultModelForm);
    }
    setShowModelDialog(true);
  };

  const closeModelDialog = () => {
    setShowModelDialog(false);
    setEditingModel(null);
    setModelForm(defaultModelForm);
  };

  const saveKey = async (providerId: string) => {
    const apiKey = providerKeys[providerId]?.trim();
    if (!apiKey) {
      toast({ type: 'error', description: 'Enter an API key before saving.' });
      return;
    }
    await saveKeyMutation.mutateAsync({ providerId, apiKey });
  };

  const removeKey = async (providerId: string) => {
    await deleteKeyMutation.mutateAsync({ providerId });
  };

  const handleCustomProviderSubmit = async () => {
    if (editingCustomProvider) {
      await updateCustomProviderMutation.mutateAsync({
        id: editingCustomProvider.id,
        name: customProviderForm.name,
        baseUrl: customProviderForm.baseUrl,
        apiKey: customProviderForm.apiKey || undefined,
      });
    } else {
      await createCustomProviderMutation.mutateAsync(customProviderForm);
    }
  };

  const handleModelSubmit = async () => {
    if (editingModel) {
      await updateModelMutation.mutateAsync({
        id: editingModel.id,
        displayName: modelForm.displayName,
        supportsTools: modelForm.supportsTools,
        maxOutputTokens: modelForm.maxOutputTokens,
      });
    } else {
      await createModelMutation.mutateAsync(modelForm);
    }
  };

  // Get providers with keys for model creation
  const providersWithKeys = byokProviders.filter(
    (p) => providerKeysData?.keys[p.id]?.hasKey
  );

  const isLoading =
    isLoadingKeys || isLoadingCustomProviders || isLoadingModels;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in-0">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  const canAddModel =
    providersWithKeys.length > 0 ||
    (customProvidersData?.providers.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      {/* Platform Provider Keys */}
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-bold tracking-tight">
            Platform API Keys
          </CardTitle>
          <CardDescription>
            Add your own API keys for OpenAI, Google, xAI, or OpenRouter to use
            your own accounts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {byokProviders.map((provider, index) => {
            const p = provider.id;
            const hasExistingKey = providerKeysData?.keys[p]?.hasKey;
            const trimmedValue = providerKeys[p]?.trim() ?? '';
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
                  open={providerOpen[p] ?? false}
                  onOpenChange={(o) =>
                    setProviderOpen((s) => ({ ...s, [p]: o }))
                  }
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      asChild
                      variant="outline"
                      className="w-full justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-4 h-auto text-left transition-all hover:bg-muted/50 hover:border-primary/20 group"
                    >
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.99 }}
                        className="flex w-full items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background border border-border/40 shadow-sm group-hover:scale-105 transition-transform">
                            <CreatorLogo
                              creatorSlug={p}
                              className="h-6 w-6"
                              size={24}
                            />
                          </div>
                          <div className="flex flex-col text-left">
                            <span className="text-base font-semibold tracking-tight">
                              {displayProviderName(p)}
                            </span>
                            {hasExistingKey ? (
                              <span className="text-[10px] text-emerald-600/80 font-medium">
                                Configured
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/60">
                                Not set
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <AnimatePresence initial={false} mode="popLayout">
                            {(status === 'saved' || status === 'deleted') && (
                              <motion.span
                                key="status-pill"
                                className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500"
                                initial={{ opacity: 0, scale: 0.85 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {status === 'deleted' ? 'Removed' : 'Saved'}
                              </motion.span>
                            )}
                          </AnimatePresence>
                          <ChevronDown className="h-4 w-4 text-muted-foreground/50 transition-transform data-[state=open]:rotate-180 group-hover:text-foreground" />
                        </div>
                      </motion.button>
                    </Button>
                  </CollapsibleTrigger>

                  <AnimatePresence initial={false}>
                    {providerOpen[p] && (
                      <CollapsibleContent forceMount asChild>
                        <motion.div
                          key="content"
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="mt-3 rounded-2xl border border-border/60 bg-background/60 p-4 shadow-sm backdrop-blur"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-center">
                            <Input
                              type="password"
                              placeholder={`${displayProviderName(p)} API key`}
                              value={providerKeys[p] || ''}
                              onChange={(e) =>
                                setProviderKeys((k) => ({
                                  ...k,
                                  [p]: e.target.value,
                                }))
                              }
                              className="md:flex-1"
                            />
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={() => saveKey(p)}
                                disabled={
                                  isSaving ||
                                  isDeleting ||
                                  trimmedValue.length === 0
                                }
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
                              </Button>
                              {hasExistingKey && (
                                <Button
                                  variant="destructive"
                                  onClick={() => removeKey(p)}
                                  disabled={isDeleting || isSaving}
                                >
                                  <AnimatedButtonLabel
                                    state={isDeleting ? 'loading' : 'idle'}
                                    idleLabel="Delete"
                                    loadingLabel="Removing…"
                                  />
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            Your {displayProviderName(p)} API key is stored
                            securely. After saving, add models below to use
                            them.
                          </p>
                          <AnimatePresence initial={false}>
                            {status === 'error' && (
                              <motion.p
                                key="error"
                                className="mt-2 flex items-center gap-1 text-xs text-destructive"
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                              >
                                <CircleAlert className="h-3.5 w-3.5" />
                                Something went wrong. Try again.
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      </CollapsibleContent>
                    )}
                  </AnimatePresence>
                </Collapsible>
              </motion.div>
            );
          })}
        </CardContent>
      </Card>

      {/* Custom Providers */}
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold tracking-tight">
                Custom Providers
              </CardTitle>
              <CardDescription>
                Add OpenAI-compatible endpoints like Ollama, vLLM, or other
                self-hosted models.
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => openCustomProviderDialog()}
            >
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!customProvidersData?.providers.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No custom providers yet</p>
              <p className="text-xs mt-1">
                Add a custom provider to connect to self-hosted models
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {customProvidersData.providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{provider.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {provider.slug} • {provider.baseUrl}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openCustomProviderDialog(provider)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        deleteCustomProviderMutation.mutateAsync(provider.id)
                      }
                      disabled={deleteCustomProviderMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* BYOK Models */}
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold tracking-tight">
                Your Models
              </CardTitle>
              <CardDescription>
                Models configured with your API keys. These appear in the model
                selector.
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!canAddModel}
              onClick={() => openModelDialog()}
            >
              <Plus className="h-4 w-4" />
              Add Model
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!modelsData?.models.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No models configured yet</p>
              <p className="text-xs mt-1">
                Add a provider API key first, then add models to use
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {modelsData.models.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{model.displayName}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        {model.sourceType === 'platform'
                          ? displayProviderName(model.providerId!)
                          : 'Custom'}
                      </Badge>
                      {!model.supportsTools && (
                        <Badge variant="outline" className="text-[10px]">
                          No tools
                        </Badge>
                      )}
                      {model.maxOutputTokens && (
                        <Badge variant="outline" className="text-[10px]">
                          Max {model.maxOutputTokens} tokens
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {model.fullModelId}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openModelDialog(model)}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteModelMutation.mutateAsync(model.id)}
                      disabled={deleteModelMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Custom Provider Dialog */}
      <Dialog
        open={showCustomProviderDialog}
        onOpenChange={(open) => {
          if (!open) closeCustomProviderDialog();
          else setShowCustomProviderDialog(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCustomProvider
                ? 'Edit Custom Provider'
                : 'Add Custom Provider'}
            </DialogTitle>
            <DialogDescription>
              {editingCustomProvider
                ? 'Update your OpenAI-compatible API endpoint configuration.'
                : 'Add an OpenAI-compatible API endpoint to use with your own models.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="slug">Slug</Label>
              <Input
                id="slug"
                placeholder="my-ollama"
                value={customProviderForm.slug}
                onChange={(e) =>
                  setCustomProviderForm((f) => ({
                    ...f,
                    slug: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ''),
                  }))
                }
                disabled={!!editingCustomProvider}
              />
              <p className="text-xs text-muted-foreground">
                A unique identifier (lowercase letters, numbers, hyphens)
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                placeholder="My Ollama Server"
                value={customProviderForm.name}
                onChange={(e) =>
                  setCustomProviderForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                placeholder="http://localhost:11434/v1"
                value={customProviderForm.baseUrl}
                onChange={(e) =>
                  setCustomProviderForm((f) => ({
                    ...f,
                    baseUrl: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                The OpenAI-compatible API base URL
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">
                API Key{' '}
                {editingCustomProvider && '(leave empty to keep existing)'}
              </Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={
                  editingCustomProvider ? '••••••••' : 'Optional API key'
                }
                value={customProviderForm.apiKey}
                onChange={(e) =>
                  setCustomProviderForm((f) => ({
                    ...f,
                    apiKey: e.target.value,
                  }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeCustomProviderDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleCustomProviderSubmit}
              disabled={
                createCustomProviderMutation.isPending ||
                updateCustomProviderMutation.isPending ||
                !customProviderForm.name ||
                !customProviderForm.baseUrl ||
                (!editingCustomProvider && !customProviderForm.slug)
              }
            >
              {createCustomProviderMutation.isPending ||
              updateCustomProviderMutation.isPending
                ? 'Saving…'
                : editingCustomProvider
                  ? 'Save Changes'
                  : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Dialog */}
      <Dialog
        open={showModelDialog}
        onOpenChange={(open) => {
          if (!open) closeModelDialog();
          else setShowModelDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingModel ? 'Edit Model' : 'Add Model'}
            </DialogTitle>
            <DialogDescription>
              {editingModel
                ? 'Update your model configuration.'
                : "Add a model from a provider you've configured."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {!editingModel && (
              <>
                <div className="space-y-2">
                  <Label>Provider Type</Label>
                  <Select
                    value={modelForm.sourceType}
                    onValueChange={(value: 'platform' | 'custom') => {
                      setModelForm((f) => ({
                        ...f,
                        sourceType: value,
                        providerId: '',
                        customProviderId: '',
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="platform"
                        disabled={providersWithKeys.length === 0}
                      >
                        Platform Provider
                      </SelectItem>
                      <SelectItem
                        value="custom"
                        disabled={!customProvidersData?.providers.length}
                      >
                        Custom Provider
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {modelForm.sourceType === 'platform' ? (
                  <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select
                      value={modelForm.providerId}
                      onValueChange={(value) =>
                        setModelForm((f) => ({ ...f, providerId: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {providersWithKeys.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {displayProviderName(p.id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Custom Provider</Label>
                    <Select
                      value={modelForm.customProviderId}
                      onValueChange={(value) =>
                        setModelForm((f) => ({ ...f, customProviderId: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select custom provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {customProvidersData?.providers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="providerModelId">Model ID</Label>
                  <Input
                    id="providerModelId"
                    placeholder="gpt-4o, llama-3.1-70b, etc."
                    value={modelForm.providerModelId}
                    onChange={(e) =>
                      setModelForm((f) => ({
                        ...f,
                        providerModelId: e.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The model ID as used by the provider's API
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="GPT-4o, Llama 3.1 70B, etc."
                value={modelForm.displayName}
                onChange={(e) =>
                  setModelForm((f) => ({ ...f, displayName: e.target.value }))
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="supportsTools">Supports Tools</Label>
                <p className="text-xs text-muted-foreground">
                  Enable if this model supports function calling
                </p>
              </div>
              <Switch
                id="supportsTools"
                checked={modelForm.supportsTools}
                onCheckedChange={(checked) =>
                  setModelForm((f) => ({ ...f, supportsTools: checked }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxOutputTokens">
                Maximum Output Tokens (optional)
              </Label>
              <Input
                id="maxOutputTokens"
                type="number"
                placeholder="Leave empty to use global setting"
                value={modelForm.maxOutputTokens}
                onChange={(e) =>
                  setModelForm((f) => ({
                    ...f,
                    maxOutputTokens: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Override the global max output tokens setting for this model
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModelDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleModelSubmit}
              disabled={
                createModelMutation.isPending ||
                updateModelMutation.isPending ||
                !modelForm.displayName ||
                (!editingModel &&
                  (!modelForm.providerModelId ||
                    (modelForm.sourceType === 'platform' &&
                      !modelForm.providerId) ||
                    (modelForm.sourceType === 'custom' &&
                      !modelForm.customProviderId)))
              }
            >
              {createModelMutation.isPending || updateModelMutation.isPending
                ? 'Saving…'
                : editingModel
                  ? 'Save Changes'
                  : 'Add Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
