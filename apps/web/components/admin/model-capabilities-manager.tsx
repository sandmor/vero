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
import type {
  ManagedModelCapabilities,
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities';
import { cn } from '@/lib/utils';

type ModelCapabilitiesManagerProps = {
  initialModels: ManagedModelCapabilities[];
};

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

  const tokenKeys: Array<keyof ModelPricing> = [
    'prompt',
    'completion',
    'reasoning',
    'cacheRead',
    'cacheWrite',
  ];

  for (const key of tokenKeys) {
    const values = pricedModels
      .map((model) => model.pricing?.[key])
      .filter(isFiniteNumber);
    const range = computeRange(values);
    if (range) ranges[key] = range;
  }

  const imageValues = pricedModels
    .map((model) => model.pricing?.image)
    .filter(isFiniteNumber);
  const imageRange = computeRange(imageValues);
  if (imageRange) {
    ranges.image = imageRange;
  }

  return {
    pricedCount: pricedModels.length,
    missingCount: models.length - pricedModels.length,
    ranges,
  };
}

export function ModelCapabilitiesManager({
  initialModels,
}: ModelCapabilitiesManagerProps) {
  const [models, setModels] =
    useState<ManagedModelCapabilities[]>(initialModels);
  const [pricingView, setPricingView] =
    useState<PricingViewMode>('perThousand');
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(
    () => initialModels[0]?.provider ?? null
  );
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    supportsTools: boolean;
    supportedFormats: ModelFormat[];
    pricing: ModelPricing | null;
  }>({ name: '', supportsTools: false, supportedFormats: [], pricing: null });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveFeedback, setSaveFeedback] = useFeedbackState();
  const statusTimeoutRef = useRef<number | null>(null);

  const modelsByProvider = useMemo(() => {
    return models.reduce(
      (acc, model) => {
        if (!acc[model.provider]) {
          acc[model.provider] = [];
        }
        acc[model.provider].push(model);
        return acc;
      },
      {} as Record<string, ManagedModelCapabilities[]>
    );
  }, [models]);

  // Count persisted models that are not referenced by any tier
  const unusedPersistedCount = useMemo(() => {
    return models.filter((m) => m.isPersisted && !m.inUse).length;
  }, [models]);
  const hasUnused = unusedPersistedCount > 0;

  const activeModel = activeModelId
    ? (models.find((model) => model.id === activeModelId) ?? null)
    : null;

  const pricingStats = useMemo(() => computePricingStats(models), [models]);
  const pricingViewConfig = PRICING_VIEW_CONFIG[pricingView];
  const pricingViewOptions = useMemo(
    () => Object.keys(PRICING_VIEW_CONFIG) as PricingViewMode[],
    []
  );

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

  const refreshModels = useCallback(async () => {
    const response = await fetch('/api/admin/model-capabilities');
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }
    const data = (await response.json()) as {
      models: ManagedModelCapabilities[];
    };
    setModels(data.models);
    return data.models;
  }, []);

  useEffect(() => {
    const handleTierUpdate = () => {
      refreshModels()
        .then(() => {
          setStatusMessage({
            type: 'success',
            message: 'Model capabilities refreshed after tier changes.',
          });
        })
        .catch((error) => {
          console.error('Failed to refresh models after tier update:', error);
          setStatusMessage({
            type: 'error',
            message: 'Could not refresh models after tier changes.',
          });
        });
    };

    window.addEventListener('settings:tiers-updated', handleTierUpdate);
    return () => {
      window.removeEventListener('settings:tiers-updated', handleTierUpdate);
    };
  }, [refreshModels, setStatusMessage]);

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

  const handleSyncOpenRouter = async () => {
    setSyncingProvider('openrouter');
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync-openrouter' }),
      });

      const data = await response.json();

      if (response.ok) {
        await refreshModels();
        setStatusMessage({
          type: 'success',
          message: `Synced ${data.synced ?? 0} OpenRouter models${data.errors?.length ? ` (${data.errors.length} warnings)` : ''}`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to sync OpenRouter models',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while syncing',
      });
    } finally {
      setSyncingProvider(null);
    }
  };

  const handleSyncTokenLens = useCallback(
    async (provider: string) => {
      setSyncingProvider(provider);
      setStatusMessage(null);

      try {
        const response = await fetch('/api/admin/model-capabilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync-tokenlens',
            provider,
          }),
        });

        const data = await response.json();

        if (response.ok) {
          await refreshModels();
          const syncedCount = typeof data.synced === 'number' ? data.synced : 0;
          const errors: string[] = Array.isArray(data.errors)
            ? data.errors
            : [];

          if (syncedCount === 0 && errors.length > 0) {
            setStatusMessage({
              type: 'error',
              message:
                errors[0] ??
                `No ${provider} models were synchronized from TokenLens.`,
            });
          } else {
            setStatusMessage({
              type: 'success',
              message: `Synced ${syncedCount} ${provider} model${syncedCount === 1 ? '' : 's'} from TokenLens${errors.length ? ` (${errors.length} warnings)` : ''}`,
            });
          }
        } else {
          setStatusMessage({
            type: 'error',
            message: data.error || 'Failed to sync from TokenLens',
          });
        }
      } catch (error) {
        setStatusMessage({
          type: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Network error while syncing',
        });
      } finally {
        setSyncingProvider(null);
      }
    },
    [refreshModels, setStatusMessage]
  );

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
            : 'Network error while removing models',
      });
    } finally {
      setCleaning(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!activeModel) return;

    setSaving(true);
    setSaveFeedback('loading');
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          capabilities: {
            id: activeModel.id,
            name: editForm.name.trim() || activeModel.name,
            provider: activeModel.provider,
            supportsTools: editForm.supportsTools,
            supportedFormats: editForm.supportedFormats,
            pricing: editForm.pricing,
          },
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await refreshModels();
        setStatusMessage({
          type: 'success',
          message: `Updated capabilities for ${data.model?.name ?? activeModel.name}`,
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

  const handleResetOpenRouter = async () => {
    if (!activeModel || activeModel.provider !== 'openrouter') return;

    setResetting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reset-openrouter',
          modelId: activeModel.id,
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
          message: `Reset ${refreshed.name} from OpenRouter${data.errors?.length ? ` (${data.errors.length} warnings)` : ''}`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to reset from OpenRouter',
        });
      }
    } catch (error) {
      setStatusMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Network error while syncing',
      });
    } finally {
      setResetting(false);
    }
  };

  const handleSyncPricingFromTokenLens = async () => {
    if (!activeModel) return;

    setResetting(true);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/model-capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync-pricing-tokenlens',
          modelId: activeModel.id,
        }),
      });

      const data = await response.json();

      if (response.ok && data.pricing) {
        setEditForm((prev) => ({
          ...prev,
          pricing: { ...data.pricing },
        }));
        setStatusMessage({
          type: 'success',
          message: `Synced pricing from TokenLens for ${activeModel.name}`,
        });
      } else {
        setStatusMessage({
          type: 'error',
          message: data.error || 'Failed to sync pricing from TokenLens',
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

          const normalized = Object.keys(nextPricing).length
            ? nextPricing
            : null;

          return {
            ...prev,
            pricing: normalized,
          };
        });
      },
    [pricingView]
  );

  const clearPricing = useCallback(() => {
    setEditForm((prev) => ({ ...prev, pricing: null }));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Model Capabilities</h3>
          <p className="text-xs text-muted-foreground">
            Models from all tiers are listed. Edit capabilities, sync provider
            data, or remove unused entries.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            Remove unused models
          </Button>
        </div>
      </div>

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
          </div>
        )}
        {IMAGE_SUMMARY_FIELD && pricingStats.ranges.image && (
          <div className="text-[11px] text-muted-foreground">
            <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1">
              <span className="font-medium text-foreground">
                {IMAGE_SUMMARY_FIELD.label}:
              </span>
              <span>{formatImageRange(pricingStats.ranges.image)}</span>
            </div>
          </div>
        )}
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

      {/* Models by Provider */}
      <div className="space-y-3">
        {Object.entries(modelsByProvider).map(([provider, providerModels]) => {
          const isOpenRouter = provider === 'openrouter';
          const persistedCount = providerModels.filter(
            (m) => m.isPersisted
          ).length;
          const providerPricedCount = providerModels.filter((m) =>
            m.pricing ? Object.values(m.pricing).some(isFiniteNumber) : false
          ).length;

          return (
            <div
              key={provider}
              className="overflow-hidden rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/20">
                <button
                  onClick={() =>
                    setExpandedProvider((prev) =>
                      prev === provider ? null : provider
                    )
                  }
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <Database className="h-5 w-5 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <p className="font-medium capitalize">{provider}</p>
                    <p className="text-xs text-muted-foreground">
                      {providerModels.length} models
                      {persistedCount !== providerModels.length
                        ? ` • ${providerModels.length - persistedCount} fallback`
                        : ''}
                      {providerPricedCount > 0
                        ? ` • ${providerPricedCount} priced`
                        : ''}
                    </p>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  {isOpenRouter ? (
                    <Button
                      onClick={handleSyncOpenRouter}
                      disabled={syncingProvider === provider}
                      variant="secondary"
                      size="sm"
                      className="gap-2"
                    >
                      {syncingProvider === provider ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Sync OpenRouter
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleSyncTokenLens(provider)}
                      disabled={syncingProvider === provider}
                      variant="secondary"
                      size="sm"
                      className="gap-2"
                    >
                      {syncingProvider === provider ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Sync TokenLens
                    </Button>
                  )}
                  {expandedProvider === provider ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {expandedProvider === provider && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-border/60"
                  >
                    <div className="max-h-96 space-y-3 overflow-y-auto p-4">
                      {providerModels.map((model) => (
                        <div
                          key={model.id}
                          className={cn(
                            'space-y-3 rounded-xl border border-border/40 bg-muted/20 p-3',
                            !model.inUse && 'border-dashed border-amber-500/40',
                            !model.isPersisted && 'bg-amber-500/10'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="truncate text-sm font-medium">
                                {model.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {model.id}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Badge
                                variant={model.inUse ? 'default' : 'outline'}
                                className="text-xs"
                              >
                                {model.inUse ? 'In tier' : 'Unused'}
                              </Badge>
                              {!model.isPersisted && (
                                <Badge variant="secondary" className="text-xs">
                                  Not saved
                                </Badge>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditDialog(model)}
                                className="gap-1"
                              >
                                <Edit className="h-3 w-3" />
                                Edit
                              </Button>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant={
                                model.supportsTools ? 'default' : 'outline'
                              }
                              className="text-xs"
                            >
                              {model.supportsTools
                                ? '🔧 Tools enabled'
                                : 'Tools disabled'}
                            </Badge>
                            {model.supportedFormats.map((format) => (
                              <Badge
                                key={format}
                                variant="secondary"
                                className="text-xs capitalize"
                              >
                                {format}
                              </Badge>
                            ))}
                          </div>

                          {model.pricing ? (
                            <div className="mt-2 rounded-lg bg-muted/40 p-3 text-xs">
                              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                                {PRICING_FIELDS.map((field) => {
                                  const rawValue = model.pricing?.[field.key];
                                  if (!isFiniteNumber(rawValue)) return null;
                                  const displayValue = field.tokenBased
                                    ? convertPriceForView(rawValue, pricingView)
                                    : rawValue;
                                  const suffix = field.tokenBased
                                    ? pricingViewConfig.shortLabel
                                    : field.key === 'image'
                                      ? '/image'
                                      : '';
                                  return (
                                    <div
                                      key={`${model.id}-${field.key}`}
                                      className="flex items-start justify-between gap-4"
                                    >
                                      <span className="text-muted-foreground">
                                        {field.label}:
                                      </span>
                                      <div className="text-right">
                                        <span className="font-mono text-xs font-semibold text-foreground">
                                          {formatCurrencyValue(displayValue)}
                                        </span>
                                        {suffix && (
                                          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            {suffix}
                                          </span>
                                        )}
                                        {field.tokenBased &&
                                          pricingView !== 'perMillion' && (
                                            <p className="text-[10px] text-muted-foreground">
                                              {formatCurrencyValue(rawValue)} /M
                                            </p>
                                          )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-2 rounded-lg border border-dashed border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
                              <div className="flex items-center justify-between gap-2">
                                <span>
                                  No pricing configured for this model.
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openEditDialog(model)}
                                  className="h-7 px-2 text-xs"
                                >
                                  Add pricing
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit capabilities</DialogTitle>
            {activeModel && (
              <DialogDescription>
                Update capability metadata for{' '}
                <span className="font-medium">{activeModel.name}</span>.
              </DialogDescription>
            )}
          </DialogHeader>

          {activeModel && (
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Model name
                </Label>
                <Input
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id={`tools-${activeModel.id}`}
                  checked={editForm.supportsTools}
                  onCheckedChange={(checked) =>
                    setEditForm((prev) => ({
                      ...prev,
                      supportsTools: checked === true,
                    }))
                  }
                />
                <Label htmlFor={`tools-${activeModel.id}`} className="text-sm">
                  Supports tools
                </Label>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Supported formats
                </Label>
                <div className="flex flex-wrap gap-2">
                  {ALL_FORMATS.map((format) => (
                    <Badge
                      key={format}
                      variant={
                        editForm.supportedFormats.includes(format)
                          ? 'default'
                          : 'outline'
                      }
                      className="cursor-pointer capitalize"
                      onClick={() => toggleFormat(format)}
                    >
                      {format}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Label className="text-sm font-medium">
                      Pricing ({pricingViewConfig.label})
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Enter costs per {pricingViewConfig.description}. Values
                      are stored per million tokens and converted for display.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={clearPricing}
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      disabled={!editForm.pricing}
                    >
                      Clear pricing
                    </Button>
                    <Button
                      onClick={handleSyncPricingFromTokenLens}
                      disabled={resetting}
                      size="sm"
                      variant="ghost"
                      className="gap-2 text-xs"
                    >
                      {resetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Sync TokenLens
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PRICING_FIELDS.map((field) => (
                    <div key={`edit-${field.key}`}>
                      <Label
                        htmlFor={`pricing-${field.key}`}
                        className="text-xs text-muted-foreground"
                      >
                        {field.label}{' '}
                        {field.tokenBased
                          ? `(${pricingViewConfig.shortLabel})`
                          : '($)'}
                      </Label>
                      <Input
                        id={`pricing-${field.key}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step={
                          field.tokenBased ? pricingViewConfig.step : '0.01'
                        }
                        placeholder="0"
                        value={getPricingDisplayValue(
                          field.key,
                          field.tokenBased
                        )}
                        onChange={handlePricingFieldChange(
                          field.key,
                          field.tokenBased
                        )}
                        className="mt-1"
                      />
                      {field.tokenBased &&
                        pricingView !== 'perMillion' &&
                        isFiniteNumber(editForm.pricing?.[field.key]) && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            ={' '}
                            {formatCurrencyValue(
                              editForm.pricing?.[field.key] as number
                            )}{' '}
                            /M tokens
                          </p>
                        )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Leave blank to hide cost information for this model. Toggle
                  the view above to switch between million, thousand, or token
                  units while editing.
                </p>
              </div>

              {activeModel.provider === 'openrouter' && (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
                  <p className="mb-2 flex items-center gap-2 font-medium text-foreground">
                    <Wand2 className="h-4 w-4" />
                    Reset from OpenRouter
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Refresh this model from the latest OpenRouter catalog. This
                    will overwrite the current name, tool support, and formats.
                  </p>
                  <Button
                    onClick={handleResetOpenRouter}
                    disabled={resetting}
                    size="sm"
                    variant="outline"
                    className="gap-2"
                  >
                    {resetting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Reset from OpenRouter
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeDialog}
              disabled={saving || resetting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving}
              className="relative gap-2"
            >
              <AnimatedButtonLabel
                state={saveFeedback}
                idleLabel="Save changes"
                loadingLabel="Saving…"
                successLabel="Saved"
                errorLabel="Error"
              />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
