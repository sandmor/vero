'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  CheckCircle2,
  Edit2,
  Plus,
  Server,
  Trash2,
  Power,
  PowerOff,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/toast';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';

type PlatformProvider = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  enabled: boolean;
  modelCount: number;
  createdAt: string;
  updatedAt: string;
};

type ProviderFormData = {
  slug: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

const defaultFormData: ProviderFormData = {
  slug: '',
  name: '',
  baseUrl: '',
  apiKey: '',
};

export function PlatformProvidersManager() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<PlatformProvider | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>(defaultFormData);

  // Query providers
  const { data, isLoading } = useQuery({
    queryKey: ['platform-providers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/platform-providers');
      if (!res.ok) throw new Error('Failed to load providers');
      return res.json() as Promise<{ providers: PlatformProvider[] }>;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: ProviderFormData) => {
      const res = await fetch('/api/admin/platform-providers', {
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
      toast({ type: 'success', description: 'Provider created' });
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
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
    }: { id: string } & Partial<ProviderFormData> & { enabled?: boolean }) => {
      const res = await fetch('/api/admin/platform-providers', {
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
      toast({ type: 'success', description: 'Provider updated' });
      closeDialog();
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
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
        `/api/admin/platform-providers?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      toast({ type: 'success', description: 'Provider deleted' });
      queryClient.invalidateQueries({ queryKey: ['platform-providers'] });
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

  const openDialog = useCallback((provider?: PlatformProvider) => {
    if (provider) {
      setEditingProvider(provider);
      setFormData({
        slug: provider.slug,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: '',
      });
    } else {
      setEditingProvider(null);
      setFormData(defaultFormData);
    }
    setShowDialog(true);
  }, []);

  const closeDialog = useCallback(() => {
    setShowDialog(false);
    setEditingProvider(null);
    setFormData(defaultFormData);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (editingProvider) {
      await updateMutation.mutateAsync({
        id: editingProvider.id,
        name: formData.name,
        baseUrl: formData.baseUrl,
        apiKey: formData.apiKey || undefined,
      });
    } else {
      await createMutation.mutateAsync(formData);
    }
  }, [editingProvider, formData, createMutation, updateMutation]);

  const toggleEnabled = useCallback(
    async (provider: PlatformProvider) => {
      await updateMutation.mutateAsync({
        id: provider.id,
        enabled: !provider.enabled,
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

  const providers = data?.providers ?? [];

  return (
    <>
      <Card className="border-border/40 bg-card/50 backdrop-blur shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold tracking-tight">
                Platform Custom Providers
              </CardTitle>
              <CardDescription>
                Add OpenAI-compatible endpoints to serve custom models.
              </CardDescription>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => openDialog()}>
              <Plus className="h-4 w-4" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No custom providers configured</p>
              <p className="text-xs mt-1">
                Add a provider to serve custom platform models
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {providers.map((provider) => (
                  <motion.div
                    key={provider.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-card/60 px-4 py-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium truncate">{provider.name}</p>
                        <Badge
                          variant={provider.enabled ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {provider.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                        {provider.modelCount > 0 && (
                          <Badge variant="outline" className="text-[10px]">
                            {provider.modelCount} model
                            {provider.modelCount !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {provider.hasApiKey && (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-emerald-600"
                          >
                            API Key Set
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {provider.slug} • {provider.baseUrl}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => toggleEnabled(provider)}
                        disabled={updateMutation.isPending}
                      >
                        {provider.enabled ? (
                          <Power className="h-4 w-4" />
                        ) : (
                          <PowerOff className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => openDialog(provider)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteMutation.mutateAsync(provider.id)}
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
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {editingProvider ? 'Edit Provider' : 'Add Custom Provider'}
            </DialogTitle>
            <DialogDescription>
              {editingProvider
                ? 'Update the provider configuration.'
                : 'Add an OpenAI-compatible endpoint to serve platform models.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!editingProvider && (
              <div className="space-y-2">
                <Label htmlFor="slug">Provider Slug</Label>
                <Input
                  id="slug"
                  placeholder="e.g., local-ollama"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData((f) => ({ ...f, slug: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase alphanumeric with hyphens. Cannot be changed later.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                placeholder="e.g., Local Ollama"
                value={formData.name}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseUrl">Base URL</Label>
              <Input
                id="baseUrl"
                placeholder="e.g., http://localhost:11434/v1"
                value={formData.baseUrl}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, baseUrl: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                OpenAI-compatible API base URL.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key (optional)</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={
                  editingProvider
                    ? 'Leave empty to keep current'
                    : 'Optional API key'
                }
                value={formData.apiKey}
                onChange={(e) =>
                  setFormData((f) => ({ ...f, apiKey: e.target.value }))
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
                idleLabel={editingProvider ? 'Save Changes' : 'Add Provider'}
                loadingLabel="Saving..."
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
