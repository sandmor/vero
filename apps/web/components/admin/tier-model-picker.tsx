'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Server,
  Wrench,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { displayProviderName } from '@/lib/ai/registry';
import { displayCreatorName, getCreatorInfo } from '@/lib/ai/creators';
import { parseModelId } from '@/lib/ai/model-id';
import type { CatalogEntry } from '@/lib/ai/model-capabilities/types';

// ============================================================================
// Types
// ============================================================================

type ProviderInfo = {
  providerId: string;
  providerModelId: string;
  displayName: string;
};

type ModelForSelection = {
  id: string; // The canonical model ID (suggestedModelId or derived from providerModelId)
  name: string;
  creator: string;
  supportsTools: boolean;
  supportedFormats: string[];
  providers: ProviderInfo[];
  // Catalog entry info for creating Model/ModelProvider when adding to tier
  catalogEntry: CatalogEntry;
  // Flag indicating this is a custom platform model (vs regular catalog model)
  isCustomPlatformModel?: boolean;
  // Display name for custom provider (only set for custom platform models)
  customProviderName?: string;
};

// ============================================================================
// Utilities
// ============================================================================

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

function deriveModelDisplay(modelId: string): {
  creator: string;
  name: string;
} {
  const parsed = parseModelId(modelId);
  if (!parsed) {
    return { creator: 'unknown', name: modelId };
  }
  return { creator: parsed.creator, name: parsed.modelName };
}

// ============================================================================
// Component: ProviderBadges
// ============================================================================

function ProviderBadges({
  providers,
  compact = false,
}: {
  providers: ProviderInfo[];
  compact?: boolean;
}) {
  if (providers.length === 0) return null;

  if (compact && providers.length > 2) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Server className="h-3 w-3" />
              {providers.length} providers
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Available via: {providers.map((p) => p.displayName).join(', ')}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <span className="inline-flex flex-wrap gap-1">
      {providers.map((p) => (
        <Badge
          key={p.providerId}
          variant="outline"
          className="text-[9px] px-1.5 py-0 h-4"
        >
          {p.displayName}
        </Badge>
      ))}
    </span>
  );
}

// ============================================================================
// Component: SelectedModelTag
// ============================================================================

function SelectedModelTag({
  model,
  onRemove,
}: {
  model: ModelForSelection | null;
  modelId: string;
  onRemove: () => void;
}) {
  if (!model) {
    return null;
  }

  const creatorInfo = getCreatorInfo(model.creator);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="group inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/80 px-2.5 py-1.5 text-sm transition-colors hover:border-border"
    >
      <span className="text-muted-foreground text-xs">{creatorInfo.name}</span>
      <span className="text-foreground font-medium">{model.name}</span>
      {model.supportsTools && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Wrench className="h-3 w-3 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Supports tool calling</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {model.providers.length > 0 && (
        <ProviderBadges providers={model.providers} compact />
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
// Component: OrphanedModelTag
// ============================================================================

function OrphanedModelTag({
  modelId,
  onRemove,
}: {
  modelId: string;
  onRemove: () => void;
}) {
  const { creator, name } = deriveModelDisplay(modelId);
  const creatorInfo = getCreatorInfo(creator);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="group inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 px-2.5 py-1.5 text-sm transition-colors hover:border-amber-500/60"
    >
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertTriangle className="h-3 w-3 text-amber-600" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Model not found in registry or has no providers.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="text-muted-foreground text-xs">{creatorInfo.name}</span>
      <span className="text-foreground font-medium">
        {humanizeModelName(name)}
      </span>
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
// Component: ModelRow
// ============================================================================

function ModelRow({
  model,
  isSelected,
  onToggle,
}: {
  model: ModelForSelection;
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
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{model.name}</span>
          {model.isCustomPlatformModel && (
            <Badge
              variant="secondary"
              className="text-[9px] px-1.5 py-0 h-4 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
            >
              Custom
            </Badge>
          )}
          {model.supportsTools && (
            <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground truncate">
            {model.id}
          </span>
          {model.customProviderName && (
            <span className="text-[10px] text-violet-600 dark:text-violet-400">
              via {model.customProviderName}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0">
        <ProviderBadges providers={model.providers} />
      </div>
    </button>
  );
}

// ============================================================================
// Component: CreatorSection
// ============================================================================

function CreatorSection({
  creator,
  models,
  selectedSet,
  onAdd,
  onRemove,
}: {
  creator: string;
  models: ModelForSelection[];
  selectedSet: Set<string>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const creatorInfo = getCreatorInfo(creator);
  const selectedCount = models.filter((m) => selectedSet.has(m.id)).length;

  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/50 transition-colors"
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </motion.div>
        <span className="font-medium text-sm flex-1">{creatorInfo.name}</span>
        <span className="text-xs text-muted-foreground">
          {selectedCount > 0 && (
            <Badge variant="secondary" className="mr-2 text-[10px]">
              {selectedCount} selected
            </Badge>
          )}
          {models.length} models
        </span>
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
              {models.map((model) => {
                const isSelected = selectedSet.has(model.id);
                return (
                  <ModelRow
                    key={model.id}
                    model={model}
                    isSelected={isSelected}
                    onToggle={() =>
                      isSelected ? onRemove(model.id) : onAdd(model.id)
                    }
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Component: TierModelPicker
// ============================================================================

export type TierModelPickerProps = {
  value: string[];
  onChange: (models: string[]) => void;
  /** Callback to get catalog entries for models being added (for creating Model/ModelProvider) */
  onModelsAdded?: (entries: CatalogEntry[]) => void;
  name?: string;
};

export function TierModelPicker({
  value,
  onChange,
  onModelsAdded,
  name,
}: TierModelPickerProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);

  // Fetch the full catalog from ProviderCatalog table
  const { data: catalog, isFetching: loading } = useQuery<CatalogEntry[]>({
    queryKey: ['admin', 'model-capabilities', 'catalog'],
    queryFn: async () => {
      const res = await fetch('/api/admin/model-capabilities?include=catalog');
      if (!res.ok) throw new Error('Failed to load catalog');
      const json = await res.json();
      // API returns { models, catalog } when include=catalog
      if (json.catalog && Array.isArray(json.catalog)) {
        return json.catalog as CatalogEntry[];
      }
      return [];
    },
    staleTime: 60_000,
  });

  // Listen for refresh events
  useEffect(() => {
    function handler() {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'model-capabilities'],
      });
    }
    window.addEventListener('catalog:refresh', handler);
    window.addEventListener('settings:tiers-updated', handler);
    return () => {
      window.removeEventListener('catalog:refresh', handler);
      window.removeEventListener('settings:tiers-updated', handler);
    };
  }, [queryClient]);

  // Transform catalog entries to selection format, grouping by canonical model ID
  const { modelsForSelection, catalogByModelId } = useMemo(() => {
    if (!catalog)
      return {
        modelsForSelection: [],
        catalogByModelId: new Map<string, CatalogEntry>(),
      };

    // Group catalog entries by their canonical model ID
    const byModelId = new Map<string, CatalogEntry[]>();
    for (const entry of catalog) {
      const modelId = entry.suggestedModelId ?? entry.providerModelId;
      if (!modelId) continue;
      const existing = byModelId.get(modelId) ?? [];
      existing.push(entry);
      byModelId.set(modelId, existing);
    }

    // Build selection models from grouped entries
    const models: ModelForSelection[] = [];
    const catalogMap = new Map<string, CatalogEntry>();

    for (const [modelId, entries] of byModelId) {
      const primary = entries[0];
      // Store the first catalog entry for this model ID (for creating Model/ModelProvider)
      catalogMap.set(modelId, primary);

      // Check if this is a custom platform model (extended catalog entry)
      const isCustomPlatformModel =
        (primary as any).isCustomPlatformModel === true;
      const customProviderName = (primary as any).customProviderName as
        | string
        | undefined;

      models.push({
        id: modelId,
        name: primary.suggestedName ?? modelId,
        creator: primary.suggestedCreator ?? 'unknown',
        supportsTools: primary.supportsTools,
        supportedFormats: primary.supportedFormats,
        providers: entries.map((e) => ({
          providerId: e.providerId,
          providerModelId: e.providerModelId,
          displayName:
            isCustomPlatformModel && customProviderName
              ? customProviderName
              : displayProviderName(e.providerId),
        })),
        catalogEntry: primary,
        isCustomPlatformModel,
        customProviderName,
      });
    }

    return { modelsForSelection: models, catalogByModelId: catalogMap };
  }, [catalog]);

  // Create lookup map
  const modelMap = useMemo(() => {
    const map = new Map<string, ModelForSelection>();
    for (const m of modelsForSelection) {
      map.set(m.id, m);
    }
    return map;
  }, [modelsForSelection]);

  // Group models by creator
  const modelsByCreator = useMemo(() => {
    const grouped = new Map<string, ModelForSelection[]>();
    for (const model of modelsForSelection) {
      const existing = grouped.get(model.creator) ?? [];
      existing.push(model);
      grouped.set(model.creator, existing);
    }
    const sorted = new Map<string, ModelForSelection[]>();
    for (const [creator, models] of [...grouped.entries()].sort(([a], [b]) =>
      displayCreatorName(a).localeCompare(displayCreatorName(b))
    )) {
      sorted.set(
        creator,
        models.sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    return sorted;
  }, [modelsForSelection]);

  // Filter by search
  const filteredByCreator = useMemo(() => {
    if (!search.trim()) return modelsByCreator;
    const lowerSearch = search.toLowerCase();
    const filtered = new Map<string, ModelForSelection[]>();
    for (const [creator, models] of modelsByCreator) {
      const matchingModels = models.filter(
        (m) =>
          m.name.toLowerCase().includes(lowerSearch) ||
          m.id.toLowerCase().includes(lowerSearch) ||
          displayCreatorName(creator).toLowerCase().includes(lowerSearch) ||
          m.providers.some((p) =>
            p.displayName.toLowerCase().includes(lowerSearch)
          )
      );
      if (matchingModels.length > 0) {
        filtered.set(creator, matchingModels);
      }
    }
    return filtered;
  }, [modelsByCreator, search]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  // Separate valid and orphaned selections
  const { validSelections, orphanedSelections } = useMemo(() => {
    const valid: string[] = [];
    const orphaned: string[] = [];
    for (const id of value) {
      if (modelMap.has(id)) {
        valid.push(id);
      } else {
        orphaned.push(id);
      }
    }
    return { validSelections: valid, orphanedSelections: orphaned };
  }, [value, modelMap]);

  const addModel = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) return;
      const entry = catalogByModelId.get(id);
      if (entry && onModelsAdded) {
        onModelsAdded([entry]);
      }
      onChange([...value, id]);
    },
    [value, onChange, selectedSet, catalogByModelId, onModelsAdded]
  );

  const removeModel = useCallback(
    (id: string) => {
      onChange(value.filter((m) => m !== id));
    },
    [value, onChange]
  );

  const addAll = useCallback(() => {
    const newIds = modelsForSelection
      .filter((m) => !selectedSet.has(m.id))
      .map((m) => m.id);
    if (newIds.length > 0 && onModelsAdded) {
      const entries = newIds
        .map((id) => catalogByModelId.get(id))
        .filter((e): e is CatalogEntry => e !== undefined);
      if (entries.length > 0) {
        onModelsAdded(entries);
      }
    }
    const next = new Set([...value, ...newIds]);
    onChange(Array.from(next));
  }, [
    modelsForSelection,
    value,
    onChange,
    selectedSet,
    catalogByModelId,
    onModelsAdded,
  ]);

  const removeAll = useCallback(() => {
    onChange([]);
  }, [onChange]);

  return (
    <div className="space-y-4">
      {/* Hidden inputs for form submission */}
      {name &&
        value.map((id, i) => (
          <input key={`${id}-${i}`} type="hidden" name={name} value={id} />
        ))}

      {/* Selected Models Display */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {validSelections.length} model
            {validSelections.length !== 1 ? 's' : ''} selected
            {orphanedSelections.length > 0 && (
              <span className="text-amber-600 ml-1">
                ({orphanedSelections.length} invalid)
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowBrowser(!showBrowser)}
              className="text-xs"
            >
              {showBrowser ? 'Hide' : 'Browse'} Models
              <ChevronDown
                className={cn(
                  'ml-1 h-3 w-3 transition-transform',
                  showBrowser && 'rotate-180'
                )}
              />
            </Button>
          </div>
        </div>

        {/* Selected Tags */}
        <div className="min-h-10 rounded-lg border border-dashed border-border/60 bg-muted/30 p-2">
          {value.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No models selected. Browse the model registry to add models.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <AnimatePresence mode="popLayout">
                {validSelections.map((id) => (
                  <SelectedModelTag
                    key={id}
                    modelId={id}
                    model={modelMap.get(id) ?? null}
                    onRemove={() => removeModel(id)}
                  />
                ))}
                {orphanedSelections.map((id) => (
                  <OrphanedModelTag
                    key={id}
                    modelId={id}
                    onRemove={() => removeModel(id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Model Browser */}
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
              {/* Info banner */}
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                <Server className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  Browse the synced provider catalog. Selected models will
                  automatically have their Model and provider associations
                  created when you save the tier.
                </p>
              </div>

              {/* Search and Bulk Actions */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models or providers..."
                    className="pl-8 text-sm"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={addAll}
                  disabled={loading}
                  className="text-xs"
                >
                  Add All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={removeAll}
                  disabled={value.length === 0}
                  className="text-xs"
                >
                  Clear
                </Button>
              </div>

              {/* Model List */}
              <ScrollArea className="h-80">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Loading catalog...
                    </span>
                  </div>
                ) : filteredByCreator.size === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {search
                      ? 'No models match your search'
                      : 'Catalog is empty. Sync the catalog in the Model Capabilities section first.'}
                  </div>
                ) : (
                  <div className="divide-y divide-border/40 rounded-md border border-border/40">
                    {Array.from(filteredByCreator.entries()).map(
                      ([creator, models]) => (
                        <CreatorSection
                          key={creator}
                          creator={creator}
                          models={models}
                          selectedSet={selectedSet}
                          onAdd={addModel}
                          onRemove={removeModel}
                        />
                      )
                    )}
                  </div>
                )}
              </ScrollArea>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
