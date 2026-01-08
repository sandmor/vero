'use client';

import { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Key,
  Plus,
  Search,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { displayProviderName, isAggregatorProvider } from '@/lib/ai/registry';
import { displayCreatorName, getCreatorInfo } from '@/lib/ai/creators';
import { buildModelId, parseModelId } from '@/lib/ai/model-id';
import type { ChatModelOption } from '@/lib/ai/models';

// ============================================================================
// Types
// ============================================================================

export type ByokModelSelectorProps = {
  /** The provider this BYOK key is for (e.g., 'openrouter', 'openai', 'google') */
  provider: string;
  /** Models available from the platform catalog that this provider can serve */
  availableModels: ChatModelOption[];
  /** Currently selected model IDs */
  selectedModelIds: string[];
  /** Callback when selection changes */
  onModelSelectionChange: (modelIds: string[]) => void;
  className?: string;
};

type ModelOption = {
  id: string; // Canonical ID (creator:modelName)
  creator: string;
  modelName: string;
  displayName: string;
  isPlatformModel: boolean; // Whether this is from the platform catalog
  supportsTools?: boolean;
  formats?: string[];
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Build the correct canonical model ID from user input
 * Handles both direct providers and aggregators differently
 */
function normalizeModelInput(provider: string, input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // If already has a colon, validate and return as-is
  if (trimmed.includes(':')) {
    const parsed = parseModelId(trimmed);
    if (!parsed) return null;
    return trimmed;
  }

  // For aggregators (like OpenRouter), we need creator/model format
  if (isAggregatorProvider(provider)) {
    // If it has a slash, it's in creator/model format
    if (trimmed.includes('/')) {
      const slashIdx = trimmed.indexOf('/');
      const creator = trimmed.slice(0, slashIdx);
      const modelName = trimmed.slice(slashIdx + 1);
      if (!creator || !modelName) return null;
      return buildModelId(creator, modelName);
    }
    // Can't determine creator without the slash for aggregators
    return null;
  }

  // For direct providers (openai, google), creator = provider
  return buildModelId(provider, trimmed);
}

/**
 * Get the provider-specific model ID from a canonical ID
 * This is what we'd pass to the provider's API
 */
function toProviderModelId(
  provider: string,
  canonicalId: string
): string | null {
  const parsed = parseModelId(canonicalId);
  if (!parsed) return null;

  if (isAggregatorProvider(provider)) {
    // OpenRouter uses creator/model format
    return `${parsed.creator}/${parsed.modelName}`;
  }

  // Direct providers just use the model name
  // (only if the creator matches the provider)
  if (parsed.creator === provider) {
    return parsed.modelName;
  }

  // If creator doesn't match provider, this model can't be served directly
  // For OpenRouter, any creator works; for direct providers, only their own models
  return null;
}

/**
 * Check if a provider can serve a model
 */
function canProviderServeModel(provider: string, canonicalId: string): boolean {
  const parsed = parseModelId(canonicalId);
  if (!parsed) return false;

  // Aggregators can serve any model
  if (isAggregatorProvider(provider)) return true;

  // Direct providers can only serve their own models
  return parsed.creator === provider;
}

function humanizeModelName(name: string): string {
  const cleaned = name.replace(/[-_]/g, ' ');
  return cleaned
    .split(' ')
    .map((word) => {
      if (word.length <= 2) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// ============================================================================
// Component: SelectedModelChip
// ============================================================================

function SelectedModelChip({
  model,
  onRemove,
}: {
  model: ModelOption;
  onRemove: () => void;
}) {
  const creatorInfo = getCreatorInfo(model.creator);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
        model.isPlatformModel
          ? 'border-border/60 bg-background/80 hover:border-border'
          : 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 hover:border-amber-500/60'
      )}
    >
      <span className="text-muted-foreground text-xs">{creatorInfo.name}</span>
      <span className="text-foreground font-medium">
        {humanizeModelName(model.modelName)}
      </span>
      {!model.isPlatformModel && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="text-[9px] px-1 py-0 h-4 border-amber-500/40 text-amber-700 dark:text-amber-400"
              >
                Custom
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Custom model not in platform catalog</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded-sm p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

// ============================================================================
// Component: ModelListItem
// ============================================================================

function ModelListItem({
  model,
  isSelected,
  onToggle,
}: {
  model: ModelOption;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
        isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'
      )}
    >
      <div
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
          isSelected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/30'
        )}
      >
        {isSelected && <Check className="h-3 w-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="truncate font-medium">{model.displayName}</span>
        <span className="text-[10px] text-muted-foreground ml-2">
          {model.id}
        </span>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {model.supportsTools && (
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
            Tools
          </Badge>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// Component: CreatorGroup
// ============================================================================

function CreatorGroup({
  creator,
  models,
  selectedSet,
  onToggle,
}: {
  creator: string;
  models: ModelOption[];
  selectedSet: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const creatorInfo = getCreatorInfo(creator);
  const selectedCount = models.filter((m) => selectedSet.has(m.id)).length;

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors"
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </motion.div>
        <span className="font-medium text-sm flex-1">{creatorInfo.name}</span>
        {selectedCount > 0 && (
          <Badge variant="secondary" className="text-[10px]">
            {selectedCount}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{models.length}</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 px-2 pb-2">
              {models.map((model) => (
                <ModelListItem
                  key={model.id}
                  model={model}
                  isSelected={selectedSet.has(model.id)}
                  onToggle={() => onToggle(model.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Component: ByokModelSelector
// ============================================================================

export function ByokModelSelector({
  provider,
  availableModels,
  selectedModelIds,
  onModelSelectionChange,
  className,
}: ByokModelSelectorProps) {
  const [search, setSearch] = useState('');
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);

  const providerName = displayProviderName(provider);
  const isAggregator = isAggregatorProvider(provider);

  // Build options from available models that this provider can serve
  const modelOptions = useMemo((): ModelOption[] => {
    return availableModels
      .filter((m) => canProviderServeModel(provider, m.id))
      .map((m) => ({
        id: m.id,
        creator: m.creator,
        modelName: m.model,
        displayName: m.name,
        isPlatformModel: true,
        supportsTools: m.capabilities?.supportsTools,
        formats: m.capabilities?.supportedFormats,
      }));
  }, [availableModels, provider]);

  // Build selected model objects (including custom ones not in catalog)
  const selectedModels = useMemo((): ModelOption[] => {
    const catalogMap = new Map(modelOptions.map((m) => [m.id, m]));

    return selectedModelIds.map((id) => {
      const catalogModel = catalogMap.get(id);
      if (catalogModel) return catalogModel;

      // Custom model not in catalog
      const parsed = parseModelId(id);
      return {
        id,
        creator: parsed?.creator ?? 'unknown',
        modelName: parsed?.modelName ?? id,
        displayName: humanizeModelName(parsed?.modelName ?? id),
        isPlatformModel: false,
      };
    });
  }, [selectedModelIds, modelOptions]);

  // Group by creator for browsing
  const modelsByCreator = useMemo(() => {
    const grouped = new Map<string, ModelOption[]>();
    for (const model of modelOptions) {
      const existing = grouped.get(model.creator) ?? [];
      existing.push(model);
      grouped.set(model.creator, existing);
    }
    // Sort
    const sorted = new Map<string, ModelOption[]>();
    for (const [creator, models] of [...grouped.entries()].sort(([a], [b]) =>
      displayCreatorName(a).localeCompare(displayCreatorName(b))
    )) {
      sorted.set(
        creator,
        models.sort((a, b) => a.displayName.localeCompare(b.displayName))
      );
    }
    return sorted;
  }, [modelOptions]);

  // Filter by search
  const filteredByCreator = useMemo(() => {
    if (!search.trim()) return modelsByCreator;
    const lowerSearch = search.toLowerCase();
    const filtered = new Map<string, ModelOption[]>();
    for (const [creator, models] of modelsByCreator) {
      const matching = models.filter(
        (m) =>
          m.displayName.toLowerCase().includes(lowerSearch) ||
          m.id.toLowerCase().includes(lowerSearch) ||
          displayCreatorName(creator).toLowerCase().includes(lowerSearch)
      );
      if (matching.length > 0) {
        filtered.set(creator, matching);
      }
    }
    return filtered;
  }, [modelsByCreator, search]);

  const selectedSet = useMemo(
    () => new Set(selectedModelIds),
    [selectedModelIds]
  );

  const toggleModel = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) {
        onModelSelectionChange(selectedModelIds.filter((m) => m !== id));
      } else {
        onModelSelectionChange([...selectedModelIds, id]);
      }
    },
    [selectedModelIds, selectedSet, onModelSelectionChange]
  );

  const removeModel = useCallback(
    (id: string) => {
      onModelSelectionChange(selectedModelIds.filter((m) => m !== id));
    },
    [selectedModelIds, onModelSelectionChange]
  );

  const addCustomModel = useCallback(() => {
    setCustomError(null);
    const normalized = normalizeModelInput(provider, customInput);

    if (!normalized) {
      if (isAggregator) {
        setCustomError(
          'Format: creator:model-name or creator/model-name (e.g., anthropic:claude-3.5-sonnet)'
        );
      } else {
        setCustomError(`Format: model-name or ${provider}:model-name`);
      }
      return;
    }

    if (!canProviderServeModel(provider, normalized)) {
      setCustomError(`${providerName} cannot serve this model`);
      return;
    }

    if (!selectedSet.has(normalized)) {
      onModelSelectionChange([...selectedModelIds, normalized]);
    }
    setCustomInput('');
  }, [
    provider,
    customInput,
    isAggregator,
    providerName,
    selectedSet,
    selectedModelIds,
    onModelSelectionChange,
  ]);

  const clearAll = useCallback(() => {
    onModelSelectionChange([]);
  }, [onModelSelectionChange]);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs">
        <Key className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
        <div>
          <p className="font-medium text-primary">BYOK Model Selection</p>
          <p className="text-muted-foreground mt-0.5">
            {isAggregator ? (
              <>
                Select models to use with your {providerName} API key. You can
                access any model {providerName} supports, including custom ones.
              </>
            ) : (
              <>
                Select {providerName} models to use with your own API key
                instead of the platform key.
              </>
            )}
          </p>
        </div>
      </div>

      {/* Selected Models */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {selectedModelIds.length} model
            {selectedModelIds.length !== 1 ? 's' : ''} selected
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              disabled={selectedModelIds.length === 0}
              className="h-7 text-xs"
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowBrowser(!showBrowser)}
              className="h-7 text-xs"
            >
              {showBrowser ? 'Hide' : 'Browse'}
              <ChevronDown
                className={cn(
                  'ml-1 h-3 w-3 transition-transform',
                  showBrowser && 'rotate-180'
                )}
              />
            </Button>
          </div>
        </div>

        <div className="min-h-10 rounded-lg border border-dashed border-border/60 bg-muted/20 p-2">
          {selectedModels.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-1">
              No models selected. Platform key will be used.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence mode="popLayout">
                {selectedModels.map((model) => (
                  <SelectedModelChip
                    key={model.id}
                    model={model}
                    onRemove={() => removeModel(model.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Browse / Add Panel */}
      <AnimatePresence>
        {showBrowser && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search platform models..."
                  className="pl-8 text-sm h-8"
                />
              </div>

              {/* Model List */}
              <ScrollArea className="h-48">
                {filteredByCreator.size === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {search
                      ? 'No models match your search'
                      : 'No platform models available'}
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 rounded-md border border-border/40">
                    {Array.from(filteredByCreator.entries()).map(
                      ([creator, models]) => (
                        <CreatorGroup
                          key={creator}
                          creator={creator}
                          models={models}
                          selectedSet={selectedSet}
                          onToggle={toggleModel}
                        />
                      )
                    )}
                  </div>
                )}
              </ScrollArea>

              {/* Custom Model Input */}
              <div className="border-t border-border/40 pt-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Add a custom model
                  {isAggregator && ' (include creator, e.g., openai:gpt-4o)'}
                </p>
                <div className="flex gap-2">
                  <Input
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      setCustomError(null);
                    }}
                    placeholder={
                      isAggregator
                        ? 'creator:model or creator/model'
                        : `${provider}:model-name or model-name`
                    }
                    className="text-sm h-8"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomModel();
                      }
                    }}
                  />
                  <ButtonWithFeedback
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={addCustomModel}
                    disabled={!customInput.trim()}
                    className="h-8"
                  >
                    <Plus className="h-4 w-4" />
                  </ButtonWithFeedback>
                </div>
                {customError && (
                  <p className="text-[10px] text-destructive mt-1">
                    {customError}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
