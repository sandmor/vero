import { useEffect, useRef, useState } from 'react';
import type { CachedChatPayload } from '@/lib/cache/cache-manager';
import type { CachedChatRecord } from '@/lib/cache/types';
import { searchIndexService } from '@/lib/search/search-index-service';
import type { MessageSearchResult } from '@/lib/search/client-message-search';
import type { SortOption } from '@/lib/search/search-index.types';
import type { DateFilter } from '@/lib/search/search-utils';

interface UseClientMessageSearchOptions {
  debounceMs?: number;
  sortBy?: SortOption;
  dateFilter?: DateFilter | null;
}

export function useClientMessageSearch(
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  options: UseClientMessageSearchOptions = {
    debounceMs: 300,
    sortBy: 'relevance',
    dateFilter: null,
  }
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const { debounceMs = 300, sortBy = 'relevance', dateFilter = null } = options;

  useEffect(() => {
    let cancelled = false;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    debounceRef.current = setTimeout(() => {
      const run = async () => {
        const serializedDate = dateFilter
          ? {
              after: dateFilter.after?.toISOString(),
              before: dateFilter.before?.toISOString(),
            }
          : null;

        try {
          await searchIndexService.syncChats(cachedChats);
          const { messageResults } = await searchIndexService.search(
            trimmed,
            { sortBy, dateFilter: serializedDate },
            cachedChats
          );

          if (cancelled) return;

          const mapped: MessageSearchResult[] = messageResults.map(
            (message) => ({
              id: message.messageId,
              chatId: message.chatId,
              chatTitle: message.chatTitle,
              createdAt: new Date(message.createdAt),
              content: message.content,
              snippet: message.snippet,
              score: message.score,
            })
          );

          // Sort results
          if (sortBy === 'newest') {
            mapped.sort(
              (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
            );
          } else if (sortBy === 'oldest') {
            mapped.sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
            );
          } else if (sortBy === 'title') {
            mapped.sort((a, b) => a.chatTitle.localeCompare(b.chatTitle));
          }

          setResults(mapped);
        } catch (error) {
          if (!cancelled) {
            console.warn('Message search failed', error);
          }
        } finally {
          if (!cancelled) setIsSearching(false);
        }
      };

      run();
    }, debounceMs);

    return () => {
      cancelled = true;
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
