'use client';

import { useState, useMemo } from 'react';
import { Search, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { useCatalogSync } from '@/hooks/use-model-capabilities';
import { useQuery } from '@tanstack/react-query';
import { displayProviderName } from '@/lib/ai/registry';
import { CreatorLogo } from '@/components/creator-logo';
import type { CatalogEntry } from '@/lib/ai/model-capabilities';

type CatalogBrowserProps = {
  existingModelIds: Set<string>;
  onAdd: (entry: CatalogEntry) => void;
};

export function CatalogBrowser({
  existingModelIds,
  onAdd,
}: CatalogBrowserProps) {
  const [search, setSearch] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const {
    data: catalog = [],
    isLoading,
    refetch,
  } = useQuery<CatalogEntry[]>({
    queryKey: ['admin', 'catalog'],
    queryFn: async () => {
      const res = await fetch('/api/admin/model-capabilities?include=catalog');
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const json = await res.json();
      if (Array.isArray(json)) {
        return [];
      }
      if (Array.isArray(json.catalog)) {
        return json.catalog as CatalogEntry[];
      }
      return [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { syncCatalog } = useCatalogSync();

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      // Sync all sources: OpenRouter + all models.dev providers
      await syncCatalog.mutateAsync({ source: 'all' });
      await refetch();
    } catch (error) {
      console.error('Sync failed', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredCatalog = useMemo(() => {
    if (!catalog) return [];
    const s = search.toLowerCase();
    return catalog
      .filter(
        (e) =>
          e.suggestedName?.toLowerCase().includes(s) ||
          e.suggestedModelId?.toLowerCase().includes(s) ||
          e.providerModelId.toLowerCase().includes(s)
      )
      .slice(0, 100); // Limit display
  }, [catalog, search]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search catalog..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <ButtonWithFeedback
          variant="outline"
          onClick={handleSync}
          disabled={isSyncing}
          className="gap-2"
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync Catalog
        </ButtonWithFeedback>
      </div>

      {/* List */}
      <div className="space-y-2 max-h-150 overflow-y-auto border rounded-md p-2">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCatalog.length === 0 ? (
          <div className="text-center p-8 text-muted-foreground">
            No models found. Try syncing or adjusting your search.
          </div>
        ) : (
          filteredCatalog.map((entry) => {
            const candidateId = entry.suggestedModelId ?? entry.providerModelId;
            const isAdded = candidateId ? existingModelIds.has(candidateId) : false;

            return (
              <div
                key={`${entry.providerId}:${entry.providerModelId}`}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded bg-muted/50">
                    <CreatorLogo
                      creatorSlug={entry.suggestedCreator || 'unknown'}
                      className="h-5 w-5 object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate text-sm">
                      {entry.suggestedName || entry.suggestedModelId}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-2 items-center">
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {displayProviderName(entry.providerId)}
                      </Badge>
                      <span className="truncate">{entry.providerModelId}</span>
                    </div>
                  </div>
                </div>
                <ButtonWithFeedback
                  size="sm"
                  variant="ghost"
                  disabled={isAdded}
                  onClick={() => onAdd(entry)}
                >
                  {isAdded ? (
                    'Added'
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-1" /> Add
                    </>
                  )}
                </ButtonWithFeedback>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
