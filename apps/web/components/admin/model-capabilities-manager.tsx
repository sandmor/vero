'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useCatalogSync,
  useManagedModels,
  useModelMutation,
  useProviderMutation,
} from '@/hooks/use-model-capabilities';
import type {
  CatalogEntry,
  ManagedModelCapabilities,
} from '@/lib/ai/model-capabilities';
import type { ModelProviderAssociation } from '@/lib/ai/model-capabilities/types';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  Layers,
  Loader2,
  Package,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddProviderDialog } from './models/add-provider-dialog';
import { CatalogBrowser } from './models/catalog-browser';
import { ModelEditorDialog } from './models/model-editor-dialog';
import { ModelList } from './models/model-list';
import { ProviderPricingDialog } from './models/provider-pricing-dialog';

type ModelCapabilitiesManagerProps = {
  initialModels: ManagedModelCapabilities[];
  initialCatalog?: CatalogEntry[];
};

type StatusMessage = {
  type: 'success' | 'error';
  message: string;
};

function ModelRowSkeleton() {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header / Main Row */}
      <div className="flex items-center gap-4 p-4">
        {/* Icon/Logo */}
        <Skeleton className="h-10 w-10 rounded-lg shrink-0" />

        {/* Info */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <Skeleton className="h-3 w-48" />
        </div>

        {/* Stats */}
        <div className="hidden sm:block w-28">
          <Skeleton className="h-3 w-16 ml-auto" />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Provider List */}
      <div className="border-t bg-muted/20 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-12 rounded-md" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
            <div className="flex items-center gap-3">
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelListSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(4)].map((_, i) => (
        <ModelRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function ModelCapabilitiesManager({
  initialModels,
}: ModelCapabilitiesManagerProps) {
  const [activeTab, setActiveTab] = useState<'models' | 'catalog'>('models');
  const [status, setStatus] = useState<StatusMessage | null>(null);

  // Status clearing timeout
  const statusTimeoutRef = useRef<number | null>(null);
  const setStatusMessage = useCallback((message: StatusMessage | null) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
      statusTimeoutRef.current = null;
    }
    setStatus(message);
    if (message) {
      statusTimeoutRef.current = window.setTimeout(() => {
        setStatus(null);
        statusTimeoutRef.current = null;
      }, 5000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  // API Hooks
  const { data: models = initialModels, isLoading: loadingModels } =
    useManagedModels();

  const { createModel, updateModel, deleteModel } = useModelMutation();
  const { addProvider, updateProvider, removeProvider } = useProviderMutation();
  const { pruneModels } = useCatalogSync();

  // Computed
  const existingModelIds = useMemo(
    () => new Set(models.map((m) => m.id)),
    [models]
  );
  const unusedPersistedCount = useMemo(() => {
    return models.filter((m) => m.isPersisted && !m.inUse).length;
  }, [models]);

  // Dialog States
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingModel, setEditingModel] =
    useState<ManagedModelCapabilities | null>(null);

  // Provider Dialog States
  const [addProviderDialogOpen, setAddProviderDialogOpen] = useState(false);
  const [providerPricingDialogOpen, setProviderPricingDialogOpen] =
    useState(false);
  const [targetModelId, setTargetModelId] = useState<string | null>(null);
  const [targetProvider, setTargetProvider] =
    useState<ModelProviderAssociation | null>(null);

  // Handlers
  const handleEditModel = (model: ManagedModelCapabilities) => {
    setEditingModel(model);
    setEditDialogOpen(true);
  };

  const handleCreateModel = () => {
    setEditingModel(null);
    setEditDialogOpen(true);
  };

  const handleSaveModel = async (data: any) => {
    try {
      const maxOutputTokens = data.maxOutputTokens
        ? parseInt(data.maxOutputTokens, 10)
        : null;
      if (editingModel) {
        // Update
        await updateModel.mutateAsync({
          id: editingModel.id,
          name: data.name,
          supportsTools: data.supportsTools,
          supportedFormats: data.supportedFormats,
          maxOutputTokens,
        });
        setStatusMessage({
          type: 'success',
          message: 'Model updated successfully',
        });
      } else {
        await createModel.mutateAsync({
          id: data.id || data.name.toLowerCase().replace(/\s+/g, '-'),
          name: data.name,
          creator: data.creator,
          supportsTools: data.supportsTools,
          supportedFormats: data.supportedFormats,
          maxOutputTokens,
        });
        setStatusMessage({
          type: 'success',
          message: 'Model created successfully',
        });
      }
      setEditDialogOpen(false);
    } catch (error) {
      setStatusMessage({ type: 'error', message: 'Failed to save model' });
      console.error(error);
    }
  };

  const handleRemoveProvider = async (modelId: string, providerId: string) => {
    const model = models.find((m) => m.id === modelId);
    const provider = model?.providers.find((p) => p.providerId === providerId);

    const enabledProviders =
      model?.providers.filter((p) => p.enabled).length ?? 0;
    const isLastEnabled = provider?.enabled && enabledProviders === 1;

    const needsForce = Boolean(model?.inUse && isLastEnabled);
    const confirmed = window.confirm(
      needsForce
        ? 'This is the last enabled provider for a model that is in user tiers. Remove it and drop the model from tiers?'
        : 'Unlink this provider from the model?'
    );
    if (!confirmed) return;

    try {
      await removeProvider.mutateAsync({
        modelId,
        providerId,
        force: needsForce,
      });
      setStatusMessage({ type: 'success', message: 'Provider removed' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to remove provider';
      setStatusMessage({ type: 'error', message });
    }
  };

  const handleDeleteModel = async (model: ManagedModelCapabilities) => {
    const needsForce = model.inUse;
    const confirmed = window.confirm(
      needsForce
        ? 'This model is currently included in user tiers. Delete it and remove it from tiers?'
        : 'Delete this model?'
    );

    if (!confirmed) return;

    try {
      await deleteModel.mutateAsync({ id: model.id, force: needsForce });
      setStatusMessage({ type: 'success', message: 'Model deleted' });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete model';
      setStatusMessage({ type: 'error', message });
    }
  };

  const handleAddFromCatalog = async (entry: CatalogEntry) => {
    try {
      const modelId = entry.suggestedModelId || entry.providerModelId;

      if (!modelId) {
        setStatusMessage({
          type: 'error',
          message: 'Catalog entry missing id',
        });
        return;
      }

      const alreadyExists = existingModelIds.has(modelId);

      if (!alreadyExists) {
        await createModel.mutateAsync({
          id: modelId,
          name: entry.suggestedName || entry.providerModelId,
          creator: entry.suggestedCreator || 'unknown',
          supportsTools: entry.supportsTools,
          supportedFormats: entry.supportedFormats,
        });
      }

      await addProvider.mutateAsync({
        modelId,
        providerId: entry.providerId,
        providerModelId: entry.providerModelId,
        pricing: entry.pricing || undefined,
        isDefault: true,
      });

      setStatusMessage({
        type: 'success',
        message: alreadyExists
          ? 'Provider linked from catalog'
          : `Added ${entry.suggestedName ?? modelId} from catalog`,
      });
      setActiveTab('models');
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message: 'Failed to add from catalog',
      });
    }
  };

  const handlePrune = async () => {
    try {
      const result = await pruneModels.mutateAsync();
      setStatusMessage({
        type: 'success',
        message: `Removed ${result.removed} unused models`,
      });
    } catch (e) {
      setStatusMessage({
        type: 'error',
        message: 'Failed to remove unused models',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Model Capabilities</h3>
          <p className="text-xs text-muted-foreground">
            Manage models and their provider associations. Sync catalogs to
            discover available models.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onClick={handlePrune}
            disabled={pruneModels.isPending || unusedPersistedCount === 0}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            {pruneModels.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remove unused
          </Button>
        </div>
      </div>

      {/* Status banner */}
      <AnimatePresence>
        {status && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm',
              status.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                : 'border-destructive/20 bg-destructive/10 text-destructive'
            )}
          >
            {status.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'models' | 'catalog')}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <TabsList>
            <TabsTrigger value="models" className="gap-2">
              <Layers className="h-4 w-4" />
              Models ({models.length})
            </TabsTrigger>
            <TabsTrigger value="catalog" className="gap-2">
              <Package className="h-4 w-4" />
              Catalog
            </TabsTrigger>
          </TabsList>

          {activeTab === 'models' && (
            <Button size="sm" onClick={handleCreateModel}>
              Create Custom Model
            </Button>
          )}
        </div>

        <TabsContent value="models" className="space-y-4">
          {loadingModels ? (
            <ModelListSkeleton />
          ) : (
            <ModelList
              models={models}
              onEdit={handleEditModel}
              onDelete={handleDeleteModel}
              onAddProvider={(model) => {
                setTargetModelId(model.id);
                setAddProviderDialogOpen(true);
              }}
              onEditProvider={(model, providerId) => {
                const provider = model.providers.find(
                  (p) => p.providerId === providerId
                );
                if (provider) {
                  setTargetModelId(model.id);
                  setTargetProvider(provider);
                  setProviderPricingDialogOpen(true);
                }
              }}
              onRemoveProvider={(modelId, providerId) => {
                void handleRemoveProvider(modelId, providerId);
              }}
              onSetDefaultProvider={(modelId, providerId) => {
                updateProvider.mutate({
                  modelId,
                  providerId,
                  isDefault: true,
                });
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
          <CatalogBrowser
            existingModelIds={existingModelIds}
            onAdd={handleAddFromCatalog}
          />
        </TabsContent>
      </Tabs>

      <ModelEditorDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        model={editingModel}
        onSave={handleSaveModel}
      />

      <AddProviderDialog
        open={addProviderDialogOpen}
        onOpenChange={setAddProviderDialogOpen}
        modelId={targetModelId}
        onSave={async (data) => {
          if (targetModelId) {
            await addProvider.mutateAsync({
              modelId: targetModelId,
              ...data,
            });
            setStatusMessage({
              type: 'success',
              message: 'Provider linked successfully',
            });
            setAddProviderDialogOpen(false);
          }
        }}
      />

      <ProviderPricingDialog
        open={providerPricingDialogOpen}
        onOpenChange={setProviderPricingDialogOpen}
        modelId={targetModelId || ''}
        provider={targetProvider}
        onSave={async (data) => {
          if (targetModelId && targetProvider) {
            const model = models.find((m) => m.id === targetModelId);
            const enabledCount =
              model?.providers.filter((p) => p.enabled).length ?? 0;
            const nextEnabled = data.enabled ?? targetProvider.enabled;
            const isDisablingLast =
              targetProvider.enabled &&
              nextEnabled === false &&
              enabledCount === 1;
            const needsForce = Boolean(model?.inUse && isDisablingLast);

            if (
              needsForce &&
              !window.confirm(
                'This change disables the last enabled provider for a tiered model. Proceed and remove the model from tiers?'
              )
            ) {
              return;
            }

            await updateProvider.mutateAsync({
              modelId: targetModelId,
              providerId: targetProvider.providerId,
              force: needsForce,
              ...data,
            });
            setStatusMessage({
              type: 'success',
              message: 'Provider updated successfully',
            });
          }
        }}
      />
    </div>
  );
}
