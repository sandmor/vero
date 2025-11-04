'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModelSelector } from '@/components/admin/model-selector';
import { Button } from '@/components/ui/button';
import type { ManagedModelCapabilities } from '@/lib/ai/model-capabilities';
import type { ChatModelOption } from '@/lib/ai/models';
import { parseCompositeModelId } from '@/lib/ai/models';

type UserModelManagerProps = {
  provider: string;
  selectedModelIds: string[];
  onModelSelectionChange: (modelIds: string[]) => void;
};

function toChatModelOption(model: ManagedModelCapabilities): ChatModelOption {
  const { model: slug } = parseCompositeModelId(model.id);
  return {
    id: model.id,
    provider: model.provider,
    model: slug,
    name: model.name,
    description: undefined,
    capabilities: {
      supportsTools: model.supportsTools,
      supportedFormats: model.supportedFormats,
    },
    isBYOK: true,
  };
}

export function UserModelManager({
  provider,
  selectedModelIds,
  onModelSelectionChange,
}: UserModelManagerProps) {
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/user/model-capabilities');
      if (!response.ok) {
        throw new Error('Failed to load model catalog');
      }
      const data = await response.json();
      const catalog: ManagedModelCapabilities[] = data.models || [];
      setModels(catalog.map(toChatModelOption));
    } catch (err) {
      console.error('Failed to load models:', err);
      setError(
        err instanceof Error ? err.message : 'Unable to load model catalog'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/10 py-6 text-xs text-muted-foreground">
          Loading models…
        </div>
      );
    }

    if (error) {
      return (
        <div className="space-y-3">
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={loadModels}
          >
            Try again
          </Button>
        </div>
      );
    }

    return (
      <ModelSelector
        provider={provider}
        availableModels={models}
        selectedModelIds={selectedModelIds}
        onModelSelectionChange={onModelSelectionChange}
      />
    );
  }, [
    error,
    loadModels,
    loading,
    models,
    onModelSelectionChange,
    provider,
    selectedModelIds,
  ]);

  return content;
}
