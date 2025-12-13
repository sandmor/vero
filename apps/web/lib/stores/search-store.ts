import { create } from 'zustand';
import type { SortOption } from '@/hooks/use-client-search';
import type { DateFilter } from '@/lib/search/search-utils';

interface SearchState {
  isModalOpen: boolean;
  query: string;
  sortBy: SortOption;
  dateFilter: DateFilter | null;

  setModalOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setDateFilter: (filter: DateFilter | null) => void;
  resetFilters: () => void;
}

export const useSearchStore = create<SearchState>((set) => ({
  isModalOpen: false,
  query: '',
  sortBy: 'relevance',
  dateFilter: null,

  setModalOpen: (open) => set({ isModalOpen: open }),
  setQuery: (query) => set({ query }),
  setSortBy: (sortBy) => set({ sortBy }),
  setDateFilter: (dateFilter) => set({ dateFilter }),
  resetFilters: () =>
    set({
      query: '',
      sortBy: 'relevance',
      dateFilter: null,
    }),
}));
