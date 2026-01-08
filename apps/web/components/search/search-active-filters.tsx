'use client';

import { ArrowUpDown, Calendar, Type, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { datePresets, sortOptions } from '@/lib/search/search-constants';
import type { DateFilter } from '@/lib/search/search-utils';
import type { SortOption } from '@/hooks/use-client-search';
import type { SearchScope } from '@/lib/stores/search-store';

interface SearchActiveFiltersProps {
  dateFilter: DateFilter | null;
  sortBy: SortOption;
  searchScope?: SearchScope;
  onClearDate: () => void;
  onResetSort: () => void;
  onResetScope?: () => void;
}

export function SearchActiveFilters({
  dateFilter,
  sortBy,
  searchScope = 'content',
  onClearDate,
  onResetSort,
  onResetScope,
}: SearchActiveFiltersProps) {
  const hasFilters =
    dateFilter || sortBy !== 'relevance' || searchScope === 'titles';

  if (!hasFilters) return null;

  const getDateLabel = () => {
    if (!dateFilter) return null;

    const preset = datePresets.find((p) => {
      const filter = p.getFilter();
      return (
        filter.after?.getTime() === dateFilter.after?.getTime() &&
        filter.before?.getTime() === dateFilter.before?.getTime()
      );
    });

    if (preset) return preset.label;

    if (dateFilter.after && dateFilter.before) {
      return `${format(dateFilter.after, 'MMM d')} - ${format(dateFilter.before, 'MMM d')}`;
    }
    if (dateFilter.after) {
      return `After ${format(dateFilter.after, 'MMM d')}`;
    }
    if (dateFilter.before) {
      return `Before ${format(dateFilter.before, 'MMM d')}`;
    }
    return null;
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {searchScope === 'titles' && onResetScope && (
        <Badge
          variant="secondary"
          className="gap-1 text-xs cursor-pointer hover:bg-secondary/80"
          onClick={onResetScope}
        >
          <Type className="h-3 w-3" />
          Titles only
          <X className="h-3 w-3" />
        </Badge>
      )}
      {dateFilter && (
        <Badge
          variant="secondary"
          className="gap-1 text-xs cursor-pointer hover:bg-secondary/80"
          onClick={onClearDate}
        >
          <Calendar className="h-3 w-3" />
          {getDateLabel()}
          <X className="h-3 w-3" />
        </Badge>
      )}
      {sortBy !== 'relevance' && (
        <Badge
          variant="secondary"
          className="gap-1 text-xs cursor-pointer hover:bg-secondary/80"
          onClick={onResetSort}
        >
          <ArrowUpDown className="h-3 w-3" />
          {sortOptions.find((o) => o.value === sortBy)?.label}
          <X className="h-3 w-3" />
        </Badge>
      )}
    </div>
  );
}
