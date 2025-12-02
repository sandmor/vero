'use client';

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw,
  Database,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Edit,
  Trash2,
  Wand2,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AnimatedButtonLabel } from '@/components/ui/animated-button';
import { useFeedbackState } from '@/hooks/use-feedback-state';
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
import type {
  ManagedModelCapabilities,
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities';
import { cn } from '@/lib/utils';
import { displayProviderName } from '@/lib/ai/registry';

type StatusMessage = {
  type: 'success' | 'error';
  message: string;
};

const ALL_FORMATS: ModelFormat[] = ['text', 'image', 'file', 'audio', 'video'];

type PricingViewMode = 'perMillion' | 'perThousand' | 'perToken';

const PRICING_VIEW_CONFIG: Record<
  PricingViewMode,
  {
    label: string;
    shortLabel: string;
    description: string;
    displayMultiplier: number;
    step: string;
  }
> = {
  perMillion: {
    label: 'per million tokens',
    shortLabel: '/M',
    description: '1,000,000 token batch',
    displayMultiplier: 1,
    step: '0.000001',
  },
  perThousand: {
    label: 'per thousand tokens',
    shortLabel: '/K',
    description: '1,000 token batch',
    displayMultiplier: 1 / 1_000,
    step: '0.0000001',
  },
  perToken: {
    label: 'per token',
    shortLabel: '/token',
    description: 'Single token',
    displayMultiplier: 1 / 1_000_000,
    step: '0.0000000001',
  },
};

type PricingField = {
  key: keyof ModelPricing;
  label: string;
  tokenBased: boolean;
};

const PRICING_FIELDS: PricingField[] = [
  { key: 'prompt', label: 'Prompt', tokenBased: true },
  { key: 'completion', label: 'Completion', tokenBased: true },
  { key: 'reasoning', label: 'Reasoning', tokenBased: true },
  { key: 'cacheRead', label: 'Cache read', tokenBased: true },
  { key: 'cacheWrite', label: 'Cache write', tokenBased: true },
  { key: 'image', label: 'Image', tokenBased: false },
];

const TOKEN_SUMMARY_FIELDS = PRICING_FIELDS.filter((field) => field.tokenBased);
const IMAGE_SUMMARY_FIELD = PRICING_FIELDS.find(
  (field) => field.key === 'image'
);

type PricingRange = {
  min: number;
  median: number;
  max: number;
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function convertPriceForView(value: number, view: PricingViewMode): number {
  return value * PRICING_VIEW_CONFIG[view].displayMultiplier;
}

function convertPriceFromView(value: number, view: PricingViewMode): number {
  return value / PRICING_VIEW_CONFIG[view].displayMultiplier;
}

function formatCurrencyValue(value: number): string {
  return currencyFormatter.format(value);
}

function formatNumberForInput(value: number): string {
  const fixed = value.toFixed(12);
  const normalized = fixed.replace(/\.0+$/, '').replace(/(\.[0-9]*?)0+$/, '$1');
  return normalized === '-0' ? '0' : normalized;
}

function computeRange(values: number[]): PricingRange | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    min: sorted[0],
    median,
    max: sorted[sorted.length - 1],
  };
}

function formatRangeForView(
  range: PricingRange,
  view: PricingViewMode
): string {
  const config = PRICING_VIEW_CONFIG[view];
  const min = formatCurrencyValue(convertPriceForView(range.min, view));
  const max = formatCurrencyValue(convertPriceForView(range.max, view));
  const median = formatCurrencyValue(convertPriceForView(range.median, view));

  if (Math.abs(range.max - range.min) < 1e-12) {
    return `${median} ${config.shortLabel}`;
  }

  return `${min} – ${max} ${config.shortLabel} (median ${median})`;
}

function formatImageRange(range: PricingRange): string {
  const min = formatCurrencyValue(range.min);
  const max = formatCurrencyValue(range.max);
  const median = formatCurrencyValue(range.median);

  if (Math.abs(range.max - range.min) < 1e-8) {
    return `${median} / image`;
  }

  return `${min} – ${max} / image (median ${median})`;
}

type PricingStats = {
  pricedCount: number;
  missingCount: number;
  ranges: Partial<Record<keyof ModelPricing, PricingRange>>;
};

function computePricingStats(models: ManagedModelCapabilities[]): PricingStats {
  const ranges: Partial<Record<keyof ModelPricing, PricingRange>> = {};

  const pricedModels = models.filter((model) => {
    if (!model.pricing) return false;
    return Object.values(model.pricing).some(isFiniteNumber);
  });

  const pricedCount = pricedModels.length;
  const missingCount = models.length - pricedCount;

  // Compute ranges for each pricing field
  for (const field of PRICING_FIELDS) {
    const values = pricedModels
      .map((model) => model.pricing?.[field.key])
      .filter(isFiniteNumber);
    if (values.length > 0) {
      const range = computeRange(values);
      if (range) {
        ranges[field.key] = range;
      }
    }
  }

  return { pricedCount, missingCount, ranges };
}

type ModelManagerMode = 'admin' | 'user';

type BaseModelManagerProps = {
  initialModels: ManagedModelCapabilities[];
  mode: ModelManagerMode;
  provider?: string; // For user mode - restrict to specific provider
  selectedModelIds?: string[]; // For user mode - which models are selected
  onModelSelectionChange?: (modelIds: string[]) => void; // For user mode
  onModelsChange?: (models: ManagedModelCapabilities[]) => void; // For admin mode
  onRefresh?: () => void | Promise<void>; // For refreshing models after sync
};

export function BaseModelManager({
  initialModels,
  mode,
  provider,
  selectedModelIds = [],
  onModelSelectionChange,
  onModelsChange,
  onRefresh,
}: BaseModelManagerProps) {
  const [models, setModels] =
    useState<ManagedModelCapabilities[]>(initialModels);
  const [filteredModels, setFilteredModels] =
    useState<ManagedModelCapabilities[]>(initialModels);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>(
    provider || 'all'
  );
  const [pricingView, setPricingView] = useState<PricingViewMode>('perMillion');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    supportsTools: false,
    supportedFormats: [] as ModelFormat[],
    pricing: null as ModelPricing | null,
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(
    null
  );
  const [addModelDialogOpen, setAddModelDialogOpen] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  const pricingViewConfig = PRICING_VIEW_CONFIG[pricingView];
  const pricingViewOptions: PricingViewMode[] = [
    'perMillion',
    'perThousand',
    'perToken',
  ];

  const [, setSaveFeedback] = useFeedbackState();

  const activeProviderForSync =
    mode === 'admin'
      ? selectedProvider !== 'all'
        ? selectedProvider
        : null
      : (provider ?? null);

  // Filter models based on search and provider
  useEffect(() => {
    let filtered = models;

    if (selectedProvider !== 'all') {
      filtered = filtered.filter(
        (model) => model.provider === selectedProvider
      );
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (model) =>
          model.name.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query) ||
          model.provider.toLowerCase().includes(query)
      );
    }

    setFilteredModels(filtered);
  }, [models, selectedProvider, searchQuery]);

  // Update models when initialModels changes
  useEffect(() => {
    setModels(initialModels);
  }, [initialModels]);

  const providers = useMemo(() => {
    const uniqueProviders = [...new Set(models.map((model) => model.provider))];
    return uniqueProviders.sort();
  }, [models]);

  const pricingStats = useMemo(() => computePricingStats(models), [models]);

  const unusedPersistedCount = useMemo(() => {
    // For user mode, we don't show unused models
    if (mode === 'user') return 0;
    return models.filter((model) => !model.inUse && model.isPersisted).length;
  }, [models, mode]);

  const hasUnused = unusedPersistedCount > 0;

  const refreshModels = useCallback(async () => {
    if (onRefresh) {
      // Use the provided refresh function (for user mode)
      await onRefresh();
      return;
    }

    // Default admin mode refresh
    try {
      const response = await fetch('/api/admin/model-capabilities');
      if (response.ok) {
        const data = await response.json();
        setModels(data.models || []);
        onModelsChange?.(data.models || []);
      }
    } catch (error) {
      console.error('Failed to refresh models:', error);
    }
  }, [onRefresh, onModelsChange]);

  const openEditDialog = (model: ManagedModelCapabilities) => {
    setActiveModelId(model.id);
    setEditForm({
      name: model.name,
      supportsTools: model.supportsTools,
      supportedFormats: [...model.supportedFormats],
      pricing: model.pricing ? { ...model.pricing } : null,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setActiveModelId(null);
    setEditForm({
      name: '',
      supportsTools: false,
      supportedFormats: [],
      pricing: null,
    });
    setSaving(false);
    setResetting(false);
  };

  const toggleFormat = (format: ModelFormat) => {
    setEditForm((prev) => {
      const includes = prev.supportedFormats.includes(format);
      return {
        ...prev,
        supportedFormats: includes
          ? prev.supportedFormats.filter((f) => f !== format)
          : [...prev.supportedFormats, format],
      };
    });
  };

  const handleSaveModel = async () => {
    if (!activeModelId) return;

    setSaving(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          modelId: activeModelId,
          name: editForm.name,
          supportsTools: editForm.supportsTools,
          supportedFormats: editForm.supportedFormats,
          pricing: editForm.pricing,
        }),
      });

      const data = await response.json();

      if (response.ok && data.model) {
        await refreshModels();
        setStatusMessage({
          type: 'success',
          message: `Updated capabilities for ${data.model.name}`,
        });
        closeDialog();
        setSaveFeedback('success', 1600);
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to update model capabilities',
        });
        setSaveFeedback('error', 2200);
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while saving model',
      });
      setSaveFeedback('error', 2200);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncProviderCatalog = async (providerId: string) => {
    setSyncingProvider(providerId);
    setStatusMessage(null);

    try {
      const apiEndpoint =
        mode === 'admin'
          ? '/api/admin/model-capabilities'
          : '/api/user/model-capabilities';

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-provider-catalog',
          provider: providerId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setStatusMessage({
          type: 'error',
          message:
            data.error ||
            `Failed to sync ${displayProviderName(providerId)} catalog`,
        });
        return;
      }

      await refreshModels();

      const syncedCount = typeof data.synced === 'number' ? data.synced : 0;
      const errors: string[] = Array.isArray(data.errors) ? data.errors : [];

      if (syncedCount > 0) {
        setStatusMessage({
          type: 'success',
          message: `Synced ${syncedCount} ${displayProviderName(providerId)} model${syncedCount === 1 ? '' : 's'}${errors.length ? ` (${errors.length} warnings)` : ''}`,
        });
      } else if (errors.length > 0) {
        setStatusMessage({
          type: 'error',
          message: errors[0],
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: `No ${displayProviderName(providerId)} models were synchronized.`,
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : `Network error while syncing ${displayProviderName(providerId)} catalog`,
      });
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleRemoveUnused = async () => {
    setCleaning(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-unused' }),
      });

      const data = await response.json();

      if (response.ok) {
        await refreshModels();
        setStatusMessage({
          type: 'success',
          message:
            data.removed > 0
              ? `Removed ${data.removed} unused model${data.removed === 1 ? '' : 's'}`
              : 'No unused models to remove',
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to remove unused models',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while removing unused models',
      });
    } finally {
      setCleaning(false);
    }
  };

  const handleResetOpenRouter = async () => {
    if (
      !activeModelId ||
      models.find((m) => m.id === activeModelId)?.provider !== 'openrouter'
    )
      return;

    setResetting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-openrouter',
          modelId: activeModelId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.model) {
        const refreshed = data.model;
        setEditForm({
          name: refreshed.name,
          supportsTools: refreshed.supportsTools,
          supportedFormats: [...refreshed.supportedFormats],
          pricing: refreshed.pricing ? { ...refreshed.pricing } : null,
        });
        setStatusMessage({
          type: 'success',
          message: `Reset ${refreshed.name} to latest OpenRouter data`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to sync pricing from OpenRouter',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while syncing pricing',
      });
    } finally {
      setResetting(false);
    }
  };

  const handleSyncPricing = async (modelId: string) => {
    setResetting(true);
    setStatusMessage(null);
    try {
      const response = await fetch('/api/user/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-pricing-tokenlens',
          modelId,
        }),
      });

      const data = await response.json();

      if (response.ok && data.pricing) {
        // Update the model in the list with new pricing
        setModels((prevModels) =>
          prevModels.map((model) =>
            model.id === modelId ? { ...model, pricing: data.pricing } : model
          )
        );
        setStatusMessage({
          type: 'success',
          message: `Updated pricing for ${models.find((m) => m.id === modelId)?.name || modelId}`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to sync pricing',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while syncing pricing',
      });
    } finally {
      setResetting(false);
    }
  };

  const getPricingDisplayValue = useCallback(
    (field: keyof ModelPricing, tokenBased: boolean) => {
      const pricing = editForm.pricing;
      if (!pricing) return '';
      const rawValue = pricing[field];
      if (!isFiniteNumber(rawValue)) return '';
      const displayValue = tokenBased
        ? convertPriceForView(rawValue, pricingView)
        : rawValue;
      return formatNumberForInput(displayValue);
    },
    [editForm.pricing, pricingView]
  );

  const handlePricingFieldChange = useCallback(
    (field: keyof ModelPricing, tokenBased: boolean) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        setEditForm((prev) => {
          const nextPricing = { ...(prev.pricing ?? {}) } as ModelPricing;

          if (raw === '') {
            delete nextPricing[field];
          } else {
            const parsed = Number.parseFloat(raw);
            if (Number.isNaN(parsed)) {
              return prev;
            }
            nextPricing[field] = tokenBased
              ? convertPriceFromView(parsed, pricingView)
              : parsed;
          }

          return {
            ...prev,
            pricing: nextPricing,
          };
        });
      },
    [pricingView]
  );

  const handleAddModel = async () => {
    if (!newModelId.trim()) return;

    setAddingModel(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add-model',
          modelId: newModelId.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok && data.model) {
        await refreshModels();
        setStatusMessage({
          type: 'success',
          message: `Added model ${data.model.name}`,
        });
        setAddModelDialogOpen(false);
        setNewModelId('');
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to add model',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while adding model',
      });
    } finally {
      setAddingModel(false);
    }
  };

  const handleModelToggle = (modelId: string) => {
    if (mode !== 'user' || !onModelSelectionChange) return;

    const isSelected = selectedModelIds.includes(modelId);
    if (isSelected) {
      onModelSelectionChange(selectedModelIds.filter((id) => id !== modelId));
    } else {
      onModelSelectionChange([...selectedModelIds, modelId]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">
            {mode === 'admin' ? 'Model Capabilities' : 'Available Models'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {mode === 'admin'
              ? 'Models from all tiers are listed. Edit capabilities, sync provider data, or remove unused entries.'
              : 'Choose models to use with your API key. Add new models from external services.'}
          </p>
        </div>
        {mode === 'admin' && (
          <div className="flex items-center gap-3">
            <Button
              onClick={() => setAddModelDialogOpen(true)}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Model
            </Button>
            <Button
              onClick={handleRemoveUnused}
              disabled={cleaning || !hasUnused}
              size="sm"
              variant="outline"
              className="gap-2"
              title={
                hasUnused
                  ? `Remove ${unusedPersistedCount} unused model${unusedPersistedCount === 1 ? '' : 's'}`
                  : 'No unused persisted models to remove'
              }
            >
              {cleaning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Remove unused
            </Button>
          </div>
        )}
      </div>

      {/* Status Message */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm',
              statusMessage.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
            )}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span>{statusMessage.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters and Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64"
          />
        </div>

        {mode === 'admin' && (
          <Select value={selectedProvider} onValueChange={setSelectedProvider}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Providers</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {displayProviderName(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {activeProviderForSync && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              onClick={() => handleSyncProviderCatalog(activeProviderForSync)}
              disabled={syncingProvider === activeProviderForSync}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              {syncingProvider === activeProviderForSync ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync {displayProviderName(activeProviderForSync)}
            </Button>
          </div>
        )}
      </div>

      {/* Pricing Stats */}
      {mode === 'admin' && (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/10 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Pricing set {pricingStats.pricedCount}/{models.length}
            </Badge>
            {pricingStats.missingCount > 0 && (
              <Badge variant="outline" className="text-xs">
                Missing pricing {pricingStats.missingCount}
              </Badge>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>View token prices</span>
              <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
                {pricingViewOptions.map((mode) => {
                  const option = PRICING_VIEW_CONFIG[mode];
                  return (
                    <Button
                      key={mode}
                      size="sm"
                      variant={pricingView === mode ? 'default' : 'ghost'}
                      className="h-7 px-2 text-xs"
                      onClick={() => setPricingView(mode)}
                    >
                      {option.shortLabel}
                    </Button>
                  );
                })}
              </div>
              <span className="text-[11px] text-muted-foreground">
                {pricingViewConfig.label}
              </span>
            </div>
          </div>
          {TOKEN_SUMMARY_FIELDS.some(
            (field) => pricingStats.ranges[field.key] !== undefined
          ) && (
            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {TOKEN_SUMMARY_FIELDS.map((field) => {
                const range = pricingStats.ranges[field.key];
                if (!range) return null;
                return (
                  <div
                    key={field.key}
                    className="rounded-md border border-border/60 bg-background px-2 py-1"
                  >
                    <span className="font-medium text-foreground">
                      {field.label}:
                    </span>{' '}
                    {formatRangeForView(range, pricingView)}
                  </div>
                );
              })}
              {pricingStats.ranges.image && (
                <div className="rounded-md border border-border/60 bg-background px-2 py-1">
                  <span className="font-medium text-foreground">
                    {IMAGE_SUMMARY_FIELD?.label}:
                  </span>{' '}
                  {formatImageRange(pricingStats.ranges.image)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Models List */}
      <div className="space-y-2">
        {filteredModels.map((model) => {
          const isSelected =
            mode === 'user' && selectedModelIds.includes(model.id);
          return (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex items-center gap-4 rounded-lg border border-border/60 bg-card p-4 transition-all',
                mode === 'user' && 'cursor-pointer hover:bg-accent/50',
                isSelected && 'border-primary bg-primary/5'
              )}
              onClick={() => mode === 'user' && handleModelToggle(model.id)}
            >
              {mode === 'user' && (
                <Checkbox
                  checked={isSelected}
                  onChange={() => handleModelToggle(model.id)}
                  className="mt-0.5"
                />
              )}

              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">{model.name}</h4>
                  <Badge variant="outline" className="text-xs">
                    {displayProviderName(model.provider)}
                  </Badge>
                  {model.inUse && (
                    <Badge variant="secondary" className="text-xs">
                      In use
                    </Badge>
                  )}
                </div>

                <div className="text-sm text-muted-foreground">{model.id}</div>

                <div className="flex flex-wrap gap-1">
                  {model.supportsTools && (
                    <Badge variant="secondary" className="text-xs">
                      🔧 Tools
                    </Badge>
                  )}
                  {model.supportedFormats.map((format) => (
                    <Badge key={format} variant="outline" className="text-xs">
                      {format}
                    </Badge>
                  ))}
                </div>

                {model.pricing && (
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {PRICING_FIELDS.map((field) => {
                      const value = model.pricing?.[field.key];
                      if (!isFiniteNumber(value)) return null;

                      const displayValue = field.tokenBased
                        ? formatCurrencyValue(
                            convertPriceForView(value, pricingView)
                          )
                        : formatCurrencyValue(value);

                      return (
                        <span key={field.key}>
                          {field.label}: {displayValue}
                          {field.tokenBased
                            ? pricingViewConfig.shortLabel
                            : '/img'}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {mode === 'admin' && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditDialog(model);
                    }}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Button>
                </div>
              )}

              {mode === 'user' && !model.pricing && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSyncPricing(model.id);
                    }}
                    disabled={resetting}
                    className="gap-2"
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Sync Pricing
                  </Button>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Model Capabilities</DialogTitle>
            <DialogDescription>
              Update the capabilities and pricing for {editForm.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="supportsTools"
                  checked={editForm.supportsTools}
                  onCheckedChange={(checked) =>
                    setEditForm((prev) => ({
                      ...prev,
                      supportsTools: !!checked,
                    }))
                  }
                />
                <Label htmlFor="supportsTools">Supports Tools</Label>
              </div>
            </div>

            <div>
              <Label>Supported Formats</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {ALL_FORMATS.map((format) => (
                  <div key={format} className="flex items-center space-x-2">
                    <Checkbox
                      id={`format-${format}`}
                      checked={editForm.supportedFormats.includes(format)}
                      onCheckedChange={() => toggleFormat(format)}
                    />
                    <Label
                      htmlFor={`format-${format}`}
                      className="text-sm capitalize"
                    >
                      {format}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Pricing</Label>
              <div className="mt-2 space-y-3">
                {PRICING_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center gap-2">
                    <Label className="w-24 text-sm">{field.label}</Label>
                    <Input
                      type="number"
                      step={field.tokenBased ? pricingViewConfig.step : '0.01'}
                      value={getPricingDisplayValue(
                        field.key,
                        field.tokenBased
                      )}
                      onChange={handlePricingFieldChange(
                        field.key,
                        field.tokenBased
                      )}
                      placeholder="Not set"
                      className="flex-1"
                    />
                    <span className="w-16 text-xs text-muted-foreground">
                      {field.tokenBased ? pricingViewConfig.shortLabel : '/img'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={handleSaveModel} disabled={saving}>
              <AnimatedButtonLabel
                state={saving ? 'loading' : 'idle'}
                idleLabel="Save Changes"
                loadingLabel="Saving…"
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Model Dialog */}
      <Dialog open={addModelDialogOpen} onOpenChange={setAddModelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Model</DialogTitle>
            <DialogDescription>
              Add a new model by its ID. The model will be fetched from the
              provider's API.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="modelId">Model ID</Label>
            <Input
              id="modelId"
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="e.g., openrouter:x-ai/grok-4"
              className="mt-2"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddModelDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddModel}
              disabled={addingModel || !newModelId.trim()}
            >
              <AnimatedButtonLabel
                state={addingModel ? 'loading' : 'idle'}
                idleLabel="Add Model"
                loadingLabel="Adding…"
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
