import { useState, useEffect, useRef, useMemo } from 'react';
import { type CachedChatPayload } from '@/lib/cache/cache-manager';
import { type CachedChatRecord } from '@/lib/cache/types';
import { searchCachedMessages, type MessageSearchResult } from '@/lib/search/client-message-search';
import type { DateFilter } from '@/lib/search/search-utils';
import type { SortOption } from './use-client-search';

interface UseClientMessageSearchOptions {
  debounceMs?: number;
  sortBy?: SortOption;
  dateFilter?: DateFilter | null;
}

export function useClientMessageSearch(
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  options: UseClientMessageSearchOptions = { debounceMs: 300, sortBy: 'relevance', dateFilter: null }
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const { debounceMs = 300, sortBy = 'relevance', dateFilter = null } = options;

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query || query.trim().length === 0) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(() => {
      // Perform search synchronously (it's in-memory)
      let searchResults = searchCachedMessages(
        cachedChats, 
        query, 
        {
          fuzzy: true,
          prefixMatch: true,
        },
        dateFilter || undefined
      );

      // Sort results
      if (sortBy === 'newest') {
        searchResults.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      } else if (sortBy === 'oldest') {
        searchResults.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      } else if (sortBy === 'title') {
        searchResults.sort((a, b) => a.chatTitle.localeCompare(b.chatTitle));
      } else {
        // relevance (default) - already sorted by score in searchCachedMessages
      }
      
      setResults(searchResults);
      setIsSearching(false);
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, cachedChats, debounceMs, sortBy, dateFilter]);

  return {
    query,
    setQuery,
    results,
    isSearching,
  };
}
