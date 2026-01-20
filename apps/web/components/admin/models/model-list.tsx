'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ManagedModelCapabilities } from '@/lib/ai/model-capabilities';
import { AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ModelRow } from './model-row';

type ModelListProps = {
  models: ManagedModelCapabilities[];
  onEdit: (model: ManagedModelCapabilities) => void;
  onDelete: (model: ManagedModelCapabilities) => void;
  onAddProvider: (model: ManagedModelCapabilities) => void;
  onEditProvider: (model: ManagedModelCapabilities, providerId: string) => void;
  onRemoveProvider: (modelId: string, providerId: string) => void;
  onSetDefaultProvider: (modelId: string, providerId: string) => void;
};

export function ModelList({
  models,
  onEdit,
  onDelete,
  onAddProvider,
  onEditProvider,
  onRemoveProvider,
  onSetDefaultProvider,
}: ModelListProps) {
  const [search, setSearch] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('all');

  const creators = useMemo(() => {
    const list = Array.from(new Set(models.map((m) => m.creator || 'unknown')));
    list.sort();
    return list;
  }, [models]);

  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      const matchesSearch =
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.id.toLowerCase().includes(search.toLowerCase());
      const matchesCreator =
        creatorFilter === 'all' || (m.creator || 'unknown') === creatorFilter;
      return matchesSearch && matchesCreator;
    });
  }, [models, search, creatorFilter]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={creatorFilter} onValueChange={setCreatorFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by creator" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Creators</SelectItem>
            {creators.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-4">
        <AnimatePresence>
          {filteredModels.map((model) => (
            <ModelRow
              key={model.id}
              model={model}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddProvider={onAddProvider}
              onEditProvider={onEditProvider}
              onRemoveProvider={onRemoveProvider}
              onSetDefaultProvider={onSetDefaultProvider}
            />
          ))}
        </AnimatePresence>
        {filteredModels.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            No models found matching your criteria.
          </div>
        )}
      </div>
    </div>
  );
}
