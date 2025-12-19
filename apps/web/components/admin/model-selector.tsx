'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { displayProviderName } from '@/lib/ai/registry';
import type { ChatModelOption } from '@/lib/ai/models';
import { cn } from '@/lib/utils';

export type ModelSelectorProps = {
  provider: string;
  availableModels: ChatModelOption[];
  selectedModelIds: string[];
  onModelSelectionChange: (modelIds: string[]) => void;
  className?: string;
};

type SelectedModel = {
  id: string;
  label: string;
  description?: string | null;
  supportsTools?: boolean;
  formats?: string[];
  isBYOK?: boolean;
};

function buildOption(model: ChatModelOption): ComboOption {
  const baseLabel = model.name || model.id;
  return {
    value: model.id,
    label: model.isBYOK ? `${baseLabel} · BYOK` : baseLabel,
  };
}

function buildSelected(model: ChatModelOption): SelectedModel {
  return {
    id: model.id,
    label: model.name || model.id,
    description: model.description ?? null,
    supportsTools: model.capabilities?.supportsTools ?? false,
    formats: model.capabilities?.supportedFormats ?? undefined,
    isBYOK: model.isBYOK,
  };
}

export function ModelSelector({
  provider,
  availableModels,
  selectedModelIds,
  onModelSelectionChange,
  className,
}: ModelSelectorProps) {
  const [customModel, setCustomModel] = useState('');

  const providerModels = useMemo(() => {
    return availableModels
      .filter((model) => model.provider === provider)
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [availableModels, provider]);

  const options = useMemo(
    () => providerModels.map(buildOption),
    [providerModels]
  );

  const selectedModels = useMemo(() => {
    const map = new Map(
      providerModels.map((model) => [model.id, model] as const)
    );
    return selectedModelIds.map((id) => {
      const model = map.get(id);
      return model
        ? buildSelected(model)
        : ({ id, label: id, description: null } as SelectedModel);
    });
  }, [providerModels, selectedModelIds]);

  const selectedSet = useMemo(
    () => new Set(selectedModelIds),
    [selectedModelIds]
  );

  const addModel = (modelId: string | null) => {
    if (!modelId) return;
    if (selectedSet.has(modelId)) return;
    onModelSelectionChange([...selectedModelIds, modelId]);
  };

  const removeModel = (modelId: string) => {
    if (!selectedSet.has(modelId)) return;
    onModelSelectionChange(selectedModelIds.filter((id) => id !== modelId));
  };

  const clearModels = () => {
    if (selectedModelIds.length === 0) return;
    onModelSelectionChange([]);
  };

  const handleCustomAdd = () => {
    const raw = customModel.trim();
    if (!raw) return;
    const normalized = raw.includes(':') ? raw : `${provider}:${raw}`;
    if (!selectedSet.has(normalized)) {
      onModelSelectionChange([...selectedModelIds, normalized]);
    }
    setCustomModel('');
  };

  const providerName = displayProviderName(provider);

  return (
    <div
      className={cn(
        'space-y-4 rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur-sm',
        className
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {providerName} models
        </p>
        <p className="text-xs text-muted-foreground">
          Use the picker to add models from your {providerName} catalog. Paste a
          custom slug if it is not listed yet.
        </p>
      </div>

      <div className="space-y-2">
        <Combobox
          options={options}
          value={null}
          onChange={addModel}
          placeholder={`Add ${providerName} model…`}
          emptyText="No models found"
        />
        <div className="flex gap-2">
          <Input
            value={customModel}
            onChange={(event) => setCustomModel(event.target.value)}
            placeholder={`${provider}:${options[0]?.label ?? 'model-id'}`}
            className="text-xs"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleCustomAdd();
              }
            }}
          />
          <ButtonWithFeedback
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleCustomAdd}
            disabled={!customModel.trim()}
          >
            Add custom
          </ButtonWithFeedback>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {selectedModelIds.length} selected • {options.length} in catalog
          </span>
          <ButtonWithFeedback
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={clearModels}
            disabled={selectedModelIds.length === 0}
          >
            Clear all
          </ButtonWithFeedback>
        </div>

        {selectedModels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            No models selected. Global key will be used.
          </div>
        ) : (
          <div className="space-y-2">
            {selectedModels.map((model) => (
              <div
                key={model.id}
                className="flex items-start justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {model.label}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {model.id}
                  </p>
                  {model.description && (
                    <p className="text-xs text-muted-foreground/80 line-clamp-2">
                      {model.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {model.isBYOK && (
                      <Badge variant="outline" className="text-[10px]">
                        BYOK
                      </Badge>
                    )}
                    {model.supportsTools && (
                      <Badge variant="secondary" className="text-[10px]">
                        Tools
                      </Badge>
                    )}
                    {model.formats && model.formats.length > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {model.formats.join(', ')}
                      </Badge>
                    )}
                  </div>
                </div>
                <ButtonWithFeedback
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => removeModel(model.id)}
                >
                  Remove
                </ButtonWithFeedback>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
