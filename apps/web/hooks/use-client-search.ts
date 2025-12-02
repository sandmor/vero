import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chat } from '@/lib/db/schema';
import {
  search,
  type SearchOptions,
  type SearchResult,
  type ParsedQuery,
  parseSearchQuery,
  applyDateFilter,
  type DateFilter,
} from '@/lib/search/search-utils';

export type SortOption = 'relevance' | 'newest' | 'oldest' | 'title';

export interface UseClientSearchOptions {
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Search options */
  searchOptions?: SearchOptions;
  /** Initial sort option */
  initialSort?: SortOption;
  /** Whether to search in message content (from bootstrap data) */
  searchMessages?: boolean;
}

export interface ClientSearchState {
  /** Current search query */
  query: string;
  /** Debounced query (after debounce delay) */
  debouncedQuery: string;
  /** Parsed search query with operators */
  parsedQuery: ParsedQuery;
  /** Search results */
  results: SearchResult<Chat>[];
  /** Whether search is in progress */
  isSearching: boolean;
  /** Sort option */
  sortBy: SortOption;
  /** Date filter */
  dateFilter: DateFilter | null;
  /** Total count of results */
  totalCount: number;
}

export interface UseClientSearchReturn extends ClientSearchState {
  setQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setDateFilter: (filter: DateFilter | null) => void;
  clearSearch: () => void;
  hasActiveFilters: boolean;
}

/**
 * Hook for client-side chat search with debouncing, filtering, and sorting
 */
export function useClientSearch(
  chats: Chat[],
  options: UseClientSearchOptions = {}
): UseClientSearchReturn {
  const {
    debounceMs = 150,
    searchOptions = { fuzzy: true, prefixMatch: true },
    initialSort = 'relevance',
  } = options;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>(initialSort);
  const [dateFilter, setDateFilter] = useState<DateFilter | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce the query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setIsSearching(false);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, debounceMs]);

  // Parse the query
  const parsedQuery = useMemo(
    () => parseSearchQuery(debouncedQuery),
    [debouncedQuery]
  );

  // Apply date filter
  const dateFilteredChats = useMemo(() => {
    if (!dateFilter) return chats;
    return applyDateFilter(chats, dateFilter);
  }, [chats, dateFilter]);

  // Perform search
  const searchResults = useMemo(() => {
    if (!debouncedQuery) {
      // When no query, return all chats (respecting date filter)
      return dateFilteredChats.map((chat) => ({
        item: chat,
        score: 0,
        matches: [],
      }));
    }

    return search<Chat>(
      dateFilteredChats,
      debouncedQuery,
      ['title'],
      searchOptions
    );
  }, [dateFilteredChats, debouncedQuery, searchOptions]);

  // Sort results
  const sortedResults = useMemo(() => {
    const results = [...searchResults];

    switch (sortBy) {
      case 'relevance':
        // Already sorted by relevance from search
        if (debouncedQuery) return results;
        // If no query, fall through to newest
        return results.sort(
          (a, b) =>
            new Date(b.item.createdAt).getTime() -
            new Date(a.item.createdAt).getTime()
        );

      case 'newest':
        return results.sort(
          (a, b) =>
            new Date(b.item.createdAt).getTime() -
            new Date(a.item.createdAt).getTime()
        );

      case 'oldest':
        return results.sort(
          (a, b) =>
            new Date(a.item.createdAt).getTime() -
            new Date(b.item.createdAt).getTime()
        );

      case 'title':
        return results.sort((a, b) => a.item.title.localeCompare(b.item.title));

      default:
        return results;
    }
  }, [searchResults, sortBy, debouncedQuery]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setDateFilter(null);
    setSortBy(initialSort);
  }, [initialSort]);

  const hasActiveFilters = useMemo(
    () => Boolean(debouncedQuery || dateFilter || sortBy !== 'relevance'),
    [debouncedQuery, dateFilter, sortBy]
  );

  return {
    query,
    debouncedQuery,
    parsedQuery,
    results: sortedResults,
    isSearching: isSearching && query !== debouncedQuery,
    sortBy,
    dateFilter,
    totalCount: sortedResults.length,
    setQuery,
    setSortBy,
    setDateFilter,
    clearSearch,
    hasActiveFilters,
  };
}

/**
 * Hook for managing search history in localStorage
 */
export function useSearchHistory(maxItems = 10) {
  const STORAGE_KEY = 'chat-search-history';

  const [history, setHistory] = useState<string[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setHistory(parsed.slice(0, maxItems));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [maxItems]);

  const addToHistory = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed || trimmed.length < 2) return;

      setHistory((prev) => {
        const filtered = prev.filter(
          (item) => item.toLowerCase() !== trimmed.toLowerCase()
        );
        const updated = [trimmed, ...filtered].slice(0, maxItems);

        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // Ignore localStorage errors
        }

        return updated;
      });
    },
    [maxItems]
  );

  const removeFromHistory = useCallback((query: string) => {
    setHistory((prev) => {
      const updated = prev.filter(
        (item) => item.toLowerCase() !== query.toLowerCase()
      );

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // Ignore localStorage errors
      }

      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  return {
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
  };
}
