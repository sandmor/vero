'use client';

import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { Edit2, Plus, Trash2, Power, PowerOff, Cpu } from 'lucide-react';

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
import type {
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities/types';

type PlatformProvider = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
};

type PlatformModel = {
  id: string;
  modelSlug: string;
  displayName: string;
  providerId: string;
  providerSlug: string;
  providerName: string;
  providerEnabled: boolean;
  providerModelId: string;
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  maxOutputTokens: number | null;
  pricing: ModelPricing | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type ModelFormData = {
  modelSlug: string;
  displayName: string;
  providerId: string;
  providerModelId: string;
  supportsTools: boolean;
  supportedFormats: ModelFormat[];
  maxOutputTokens: string;
};

const defaultFormData: ModelFormData = {
  modelSlug: '',
  displayName: '',
  providerId: '',
  providerModelId: '',
  supportsTools: true,
  supportedFormats: ['text'],
  maxOutputTokens: '',
};

export function PlatformModelsManager() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingModel, setEditingModel] = useState<PlatformModel | null>(null);
  const [formData, setFormData] = useState<ModelFormData>(defaultFormData);

  // Query providers
  const { data: providersData } = useQuery({
    queryKey: ['platform-providers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/platform-providers');
      if (!res.ok) throw new Error('Failed to load providers');
      return res.json() as Promise<{ providers: PlatformProvider[] }>;
    },
  });

  // Query models
  const { data: modelsData, isLoading } = useQuery({
    queryKey: ['platform-models'],
    queryFn: async () => {
      const res = await fetch('/api/admin/platform-models');
      if (!res.ok) throw new Error('Failed to load models');
      return res.json() as Promise<{ models: PlatformModel[] }>;
    },
  });

  const enabledProviders = useMemo(
    () => (providersData?.providers ?? []).filter((p) => p.enabled),
    [providersData]
  );

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: ModelFormData) => {
      const payload = {
        ...data,
        maxOutputTokens: data.maxOutputTokens
          ? parseInt(data.maxOutputTokens, 10)
          : null,
      };
      const res = await fetch('/api/admin/platform-models', {
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
      toast({ type: 'success', description: 'Model created' });
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to create',
      });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      ...data
    }: { id: string } & Partial<ModelFormData> & { enabled?: boolean }) => {
      const payload = {
        id,
        ...data,
        maxOutputTokens: data.maxOutputTokens
          ? parseInt(data.maxOutputTokens, 10)
          : data.maxOutputTokens,
      };
      const res = await fetch('/api/admin/platform-models', {
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
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to update',
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(
        `/api/admin/platform-models?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Model deleted' });
      queryClient.invalidateQueries({ queryKey: ['platform-models'] });
    },
    onError: (error) => {
      toast({
        type: 'error',
        description:
          error instanceof Error ? error.message : 'Failed to delete',
      });
    },
  });

  const openDialog = useCallback((model?: PlatformModel) => {
    if (model) {
      setEditingModel(model);
      setFormData({
        modelSlug: model.modelSlug,
        displayName: model.displayName,
        providerId: model.providerId,
        providerModelId: model.providerModelId,
        supportsTools: model.supportsTools,
        supportedFormats: model.supportedFormats,
        maxOutputTokens: model.maxOutputTokens?.toString() ?? '',
      });
    } else {
      setEditingModel(null);
      setFormData(defaultFormData);
    }
    setShowDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowDialog(false);
    setEditingModel(null);
    setFormData(defaultFormData);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (editingModel) {
      await updateMutation.mutateAsync({
        id: editingModel.id,
        displayName: formData.displayName,
        providerModelId: formData.providerModelId,
        supportsTools: formData.supportsTools,
        maxOutputTokens: formData.maxOutputTokens,
      });
    } else {
      await createMutation.mutateAsync(formData);
    }
  }, [editingModel, formData, createMutation, updateMutation]);

  const toggleEnabled = useCallback(
    async (model: PlatformModel) => {
      await updateMutation.mutateAsync({
        id: model.id,
        enabled: !model.enabled,
      });
    },
    [updateMutation]
  );

  if (isLoading) {
    return (
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </CardContent>
      </Card>
    );
  }

  const models = modelsData?.models ?? [];
  const canAddModel = enabledProviders.length > 0;

  return (
    <>
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold tracking-tight">
                Platform Custom Models
              </CardTitle>
              <CardDescription>
                Define custom models that appear as standard platform models to
                users.
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => openDialog()}
              disabled={!canAddModel}
            >
              <Plus className="h-4 w-4" />
              Add Model
            </Button>
          </div>
          {!canAddModel && (
            <p className="text-xs text-amber-600 mt-2">
              Add an enabled provider first to create models.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {models.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Cpu className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No custom models configured</p>
              <p className="text-xs mt-1">
                Add a model to make it available to all users
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {models.map((model) => (
                  <motion.div
                    key={model.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">
                          {model.displayName}
                        </p>
                        <Badge
                          variant={model.enabled ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {model.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {model.providerName}
                        </Badge>
                        {!model.providerEnabled && (
                          <Badge variant="destructive" className="text-[10px]">
                            Provider Disabled
                          </Badge>
                        )}
                        {!model.supportsTools && (
                          <Badge variant="outline" className="text-[10px]">
                            No Tools
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {model.modelSlug} → {model.providerModelId}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleEnabled(model)}
                        disabled={updateMutation.isPending}
                      >
                        {model.enabled ? (
                          <Power className="h-4 w-4" />
                        ) : (
                          <PowerOff className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openDialog(model)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutateAsync(model.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingModel ? 'Edit Model' : 'Add Custom Model'}
            </DialogTitle>
            <DialogDescription>
              {editingModel
                ? 'Update the model configuration.'
                : 'Define a new platform model that will appear to all users.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            {!editingModel && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="modelSlug">Model Slug</Label>
                  <Input
                    id="modelSlug"
                    placeholder="e.g., mycorp:custom-gpt-4"
                    value={formData.modelSlug}
                    onChange={(e) =>
                      setFormData((f) => ({ ...f, modelSlug: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The unique identifier users will see. Cannot be changed
                    later.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="providerId">Provider</Label>
                  <Select
                    value={formData.providerId}
                    onValueChange={(value) =>
                      setFormData((f) => ({ ...f, providerId: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} ({provider.slug})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="e.g., Custom GPT-4 Turbo"
                value={formData.displayName}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, displayName: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="providerModelId">Provider Model ID</Label>
              <Input
                id="providerModelId"
                placeholder="e.g., gpt-4-turbo-preview"
                value={formData.providerModelId}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    providerModelId: e.target.value,
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">
                The model ID used when calling the provider's API.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Supports Tools</Label>
                <p className="text-xs text-muted-foreground">
                  Enable if the model supports function calling.
                </p>
              </div>
              <Switch
                checked={formData.supportsTools}
                onCheckedChange={(checked) =>
                  setFormData((f) => ({ ...f, supportsTools: checked }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxOutputTokens">
                Max Output Tokens (optional)
              </Label>
              <Input
                id="maxOutputTokens"
                type="number"
                placeholder="Leave empty for default"
                value={formData.maxOutputTokens}
                onChange={(e) =>
                  setFormData((f) => ({
                    ...f,
                    maxOutputTokens: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              <AnimatedButtonLabel
                state={
                  createMutation.isPending || updateMutation.isPending
                    ? 'loading'
                    : 'idle'
                }
                idleLabel={editingModel ? 'Save Changes' : 'Add Model'}
                loadingLabel="Saving..."
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
