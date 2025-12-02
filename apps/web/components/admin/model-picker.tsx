'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { SUPPORTED_PROVIDERS, displayProviderName } from '@/lib/ai/registry';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export function ModelPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (models: string[]) => void;
}) {
  const [openStates, setOpenStates] = useState<Record<string, boolean>>({});
  const [optionsByProvider, setOptionsByProvider] = useState<
    Record<string, ComboOption[]>
  >({});
  const queryClient = useQueryClient();
  const { data: catalog, isFetching: loading } = useQuery<Record<string, any>>({
    queryKey: ['admin', 'model-catalog'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/models`);
      if (!res.ok) throw new Error('Failed to load model catalog');
      return res.json();
    },
    staleTime: 5 * 60_000,
  });
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  // Build options when catalog changes
  useEffect(() => {
    if (!catalog) return;
    const map: Record<string, ComboOption[]> = {};
    for (const p of SUPPORTED_PROVIDERS) {
      const entry = catalog[p];
      const modelIds = entry?.models ? Object.keys(entry.models).sort() : [];
      map[p] = modelIds.map((m: string) => ({ value: `${p}:${m}`, label: m }));
    }
    setOptionsByProvider(map);
  }, [catalog]);

  // Listen for global refresh event dispatched elsewhere in the admin UI
  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent)?.detail as
        | { force?: boolean }
        | undefined;
      if (detail?.force) {
        // Hard refetch ignoring cache (e.g., provider keys changed)
        queryClient.invalidateQueries({ queryKey: ['admin', 'model-catalog'] });
        queryClient.removeQueries({
          queryKey: ['admin', 'model-catalog'],
          exact: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['admin', 'model-catalog'] });
    }
    window.addEventListener('catalog:refresh', handler as EventListener);
    return () =>
      window.removeEventListener('catalog:refresh', handler as EventListener);
  }, [queryClient]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  function addModel(id: string | null) {
    if (!id) return;
    if (selectedSet.has(id)) return;
    onChange([...value, id]);
  }

  function normalizeCustomModel(provider: string, raw: string): string | null {
    const input = raw.trim();
    if (!input) return null;
    // Allow either plain model slug or full composite id
    if (input.includes(':')) {
      // If they provided provider:model form, validate provider matches
      const [p, rest] = input.split(':', 2);
      if (!rest) return null;
      if (p !== provider) {
        // Wrong provider prefix; reject
        return null;
      }
      return `${p}:${rest}`;
    }
    // Plain slug -> compose
    return `${provider}:${input}`;
  }

  function addCustomModel(provider: string) {
    const raw = customInputs[provider] || '';
    const id = normalizeCustomModel(provider, raw);
    if (!id) return; // silently ignore invalid for now
    if (selectedSet.has(id)) return;
    onChange([...value, id]);
    setCustomInputs((s) => ({ ...s, [provider]: '' }));
  }

  function removeModel(id: string) {
    onChange(value.filter((m) => m !== id));
  }

  const addAllForProvider = useCallback(
    (p: string) => {
      const opts = optionsByProvider[p] || [];
      const ids = opts.map((o) => o.value);
      const next = new Set(value);
      ids.forEach((id) => next.add(id));
      onChange(Array.from(next));
    },
    [optionsByProvider, value, onChange]
  );

  const removeAllForProvider = useCallback(
    (p: string) => {
      const opts = optionsByProvider[p] || [];
      const idSet = new Set(opts.map((o) => o.value));
      onChange(value.filter((id) => !idSet.has(id)));
    },
    [optionsByProvider, value, onChange]
  );

  const addAllProviders = useCallback(() => {
    const next = new Set(value);
    for (const p of SUPPORTED_PROVIDERS) {
      const opts = optionsByProvider[p] || [];
      opts.forEach((o) => next.add(o.value));
    }
    onChange(Array.from(next));
  }, [optionsByProvider, value, onChange]);

  const removeAllProviders = useCallback(() => {
    onChange([]);
  }, [onChange]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Choose models for this tier
      </p>
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="text-xs">
              {id}
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 h-5 px-1"
                onClick={() => removeModel(id)}
              >
                ✕
              </Button>
            </Badge>
          ))}
          {value.length === 0 && (
            <span className="text-xs text-muted-foreground">
              No models selected
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={addAllProviders}
            disabled={loading}
          >
            Add all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={removeAllProviders}
            disabled={loading}
          >
            Remove all
          </Button>
        </div>
      </div>
      <Separator />
      <div className="space-y-2">
        {SUPPORTED_PROVIDERS.map((p) => {
          const open = openStates[p] ?? false;
          const opts = optionsByProvider[p] || [];
          const entry = catalog?.[p];
          const providerName = entry?.name || displayProviderName(p);
          const doc = entry?.doc as string | undefined;
          return (
            <Collapsible
              key={p}
              open={open}
              onOpenChange={(o) => setOpenStates((s) => ({ ...s, [p]: o }))}
            >
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span className="font-medium">
                    {providerName}
                    {doc && (
                      <a
                        href={doc}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 text-xs underline text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Docs
                      </a>
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 transition-transform data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 border rounded-md p-3 space-y-3">
                {opts.length > 0 ? (
                  <Combobox
                    options={opts}
                    value={null}
                    onChange={(v) => addModel(v)}
                    placeholder={`Add ${p} model…`}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {loading
                      ? 'Loading models…'
                      : 'No models found in catalog. You can still add a custom model below.'}
                  </p>
                )}
                <div className="flex gap-2 items-center pt-1">
                  <input
                    className="flex-1 rounded-md border px-2 py-1 text-xs bg-background"
                    placeholder={`Custom ${p} model slug or ${p}:model…`}
                    value={customInputs[p] || ''}
                    onChange={(e) =>
                      setCustomInputs((s) => ({ ...s, [p]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomModel(p);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => addCustomModel(p)}
                    disabled={loading || !(customInputs[p] || '').trim()}
                  >
                    Add
                  </Button>
                </div>
                {customInputs[p] &&
                  customInputs[p].includes(':') &&
                  !customInputs[p].startsWith(`${p}:`) && (
                    <p className="text-[10px] text-red-500">
                      Prefix must be {p}:
                    </p>
                  )}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{opts.length} models</span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => addAllForProvider(p)}
                      disabled={loading || opts.length === 0}
                    >
                      Add all {p}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => removeAllForProvider(p)}
                      disabled={loading || opts.length === 0}
                    >
                      Remove all {p}
                    </Button>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
