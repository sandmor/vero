import { ArrowUpDown, Clock, History, SortAsc } from 'lucide-react';
import { endOfDay, startOfDay, subDays, subMonths, subWeeks } from 'date-fns';
import type { SortOption } from '@/hooks/use-client-search';
import type { DateFilter } from '@/lib/search/search-utils';

// Date filter presets
export type DatePreset = {
  label: string;
  value: string;
  getFilter: () => DateFilter;
};

export const datePresets: DatePreset[] = [
  {
    label: 'Today',
    value: 'today',
    getFilter: () => ({ after: startOfDay(new Date()) }),
  },
  {
    label: 'Yesterday',
    value: 'yesterday',
    getFilter: () => ({
      after: startOfDay(subDays(new Date(), 1)),
      before: endOfDay(subDays(new Date(), 1)),
    }),
  },
  {
    label: 'Last 7 days',
    value: 'week',
    getFilter: () => ({ after: subWeeks(new Date(), 1) }),
  },
  {
    label: 'Last 30 days',
    value: 'month',
    getFilter: () => ({ after: subMonths(new Date(), 1) }),
  },
  {
    label: 'Last 3 months',
    value: '3months',
    getFilter: () => ({ after: subMonths(new Date(), 3) }),
  },
];

export const sortOptions: {
  label: string;
  value: SortOption;
  icon: typeof Clock;
}[] = [
  { label: 'Relevance', value: 'relevance', icon: ArrowUpDown },
  { label: 'Newest first', value: 'newest', icon: Clock },
  { label: 'Oldest first', value: 'oldest', icon: History },
  { label: 'Title A-Z', value: 'title', icon: SortAsc },
];
