import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deserializeChat } from '@/lib/chat/serialization';
import type { CachedChatPayload } from '@/lib/cache/cache-manager';
import type { CachedChatRecord } from '@/lib/cache/types';
import type { Chat } from '@/lib/db/schema';
import { searchIndexService } from '@/lib/search/search-index-service';
import type {
  SortOption,
  WorkerSearchOptions,
  HighlightRange,
} from '@/lib/search/search-index.types';
import {
  type ParsedAdvancedQuery,
  type SearchResult,
  applyDateFilter,
  parseAdvancedQuery,
  type DateFilter,
} from '@/lib/search/search-utils';

export type {
  SortOption,
  HighlightRange,
} from '@/lib/search/search-index.types';

export interface MessageSearchResult {
  id: string;
  chatId: string;
  chatTitle: string;
  createdAt: Date;
  content: string;
  snippet: string;
  highlights: HighlightRange[];
  score: number;
}

export interface UseClientSearchOptions {
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Initial sort option */
  initialSort?: SortOption;
  /** Whether to search message content */
  searchMessages?: boolean;
  /** Controlled state values */
  value?: {
    query: string;
    sortBy: SortOption;
    dateFilter: DateFilter | null;
    onQueryChange: (query: string) => void;
    onSortChange: (sort: SortOption) => void;
    onDateChange: (filter: DateFilter | null) => void;
  };
}

export interface ClientSearchState {
  /** Current search query */
  query: string;
  /** Debounced query (after debounce delay) */
  debouncedQuery: string;
  /** Parsed search query with operators */
  parsedQuery: ParsedAdvancedQuery;
  /** Search results */
  results: SearchResult<Chat>[];
  /** Message-level results */
  messageResults: MessageSearchResult[];
  /** Whether search is in progress */
  isSearching: boolean;
  /** Whether indexes are syncing/rebuilding */
  isIndexing: boolean;
  /** Sort option */
  sortBy: SortOption;
  /** Date filter */
  dateFilter: DateFilter | null;
  /** Total count of results */
  totalCount: number;
  /** Total count of message results */
  messageCount: number;
}

export interface UseClientSearchReturn extends ClientSearchState {
  setQuery: (query: string) => void;
  setSortBy: (sort: SortOption) => void;
  setDateFilter: (filter: DateFilter | null) => void;
  clearSearch: () => void;
  hasActiveFilters: boolean;
}

type SearchKey = string;

class WorkerSearchManager {
  private inFlight = new Map<
    SearchKey,
    Promise<Awaited<ReturnType<typeof searchIndexService.search>>>
  >();

  private makeKey(query: string, options: WorkerSearchOptions): SearchKey {
    const after = options.dateFilter?.after ?? '';
    const before = options.dateFilter?.before ?? '';
    const searchMessages = options.searchMessages ? '1' : '0';
    const sort = options.sortBy ?? 'relevance';
    return [query, sort, after, before, searchMessages].join('||');
  }

  async search(
    query: string,
    options: WorkerSearchOptions,
    cachedChats: CachedChatPayload<CachedChatRecord>[]
  ) {
    const key = this.makeKey(query, options);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = searchIndexService
      .search(query, options, cachedChats)
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

const workerSearchManager = new WorkerSearchManager();

/**
 * Hook for client-side chat search with debouncing, filtering, and sorting
 */
export function useClientSearch(
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  options: UseClientSearchOptions = {}
): UseClientSearchReturn {
  const {
    debounceMs = 150,
    initialSort = 'relevance',
    searchMessages = true,
    value,
  } = options;

  // Internal state (used if not controlled)
  const [internalQuery, setInternalQuery] = useState('');
  const [internalSortBy, setInternalSortBy] = useState<SortOption>(initialSort);
  const [internalDateFilter, setInternalDateFilter] =
    useState<DateFilter | null>(null);

  // Derived state (controlled or internal)
  const query = value ? value.query : internalQuery;
  const sortBy = value ? value.sortBy : internalSortBy;
  const dateFilter = value ? value.dateFilter : internalDateFilter;

  const [debouncedQuery, setDebouncedQuery] = useState(query);
  const [isSearching, setIsSearching] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [results, setResults] = useState<SearchResult<Chat>[]>([]);
  const [messageResults, setMessageResults] = useState<MessageSearchResult[]>(
    []
  );

  const deserializedChats = useMemo(
    () => cachedChats.map((entry) => deserializeChat(entry.data.chat)),
    [cachedChats]
  );

  const chatMap = useMemo(
    () => new Map(deserializedChats.map((chat) => [chat.id, chat])),
    [deserializedChats]
  );

  // Keep index in sync with encrypted cache (non-blocking)
  // We run sync in the background without blocking the UI.
  // The isIndexing flag is only set for visual feedback, not for blocking.
  useEffect(() => {
    let cancelled = false;

    // Only show indexing indicator if we have no cached results yet
    // This prevents UI blocking on subsequent syncs
    const showIndicator = cachedChats.length === 0;
    if (showIndicator) {
      setIsIndexing(true);
    }

    searchIndexService
      .syncChats(cachedChats)
      .catch((error) => {
        console.warn('Failed to sync search index', error);
      })
      .finally(() => {
        if (!cancelled && showIndicator) setIsIndexing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cachedChats]);

  // Handlers
  const setQuery = useCallback(
    (newQuery: string) => {
      if (value) {
        value.onQueryChange(newQuery);
      } else {
        setInternalQuery(newQuery);
      }
    },
    [value]
  );

  const setSortBy = useCallback(
    (newSort: SortOption) => {
      if (value) {
        value.onSortChange(newSort);
      } else {
        setInternalSortBy(newSort);
      }
    },
    [value]
  );

  const setDateFilter = useCallback(
    (newFilter: DateFilter | null) => {
      if (value) {
        value.onDateChange(newFilter);
      } else {
        setInternalDateFilter(newFilter);
      }
    },
    [value]
  );

  // Debounce the query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query === debouncedQuery) {
      setIsSearching(false);
      return;
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
  }, [query, debounceMs, debouncedQuery]);

  // Parse the query
  const parsedQuery = useMemo(
    () => parseAdvancedQuery(debouncedQuery),
    [debouncedQuery]
  );

  // Local sort helper for empty-query scenarios
  const sortChatsWithoutQuery = useCallback(
    (chatsToSort: Chat[]) => {
      const copy = [...chatsToSort];
      switch (sortBy) {
        case 'relevance':
        case 'newest':
          return copy.sort(
            (a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
        case 'oldest':
          return copy.sort(
            (a, b) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        case 'title':
          return copy.sort((a, b) => a.title.localeCompare(b.title));
        default:
          return copy;
      }
    },
    [sortBy]
  );

  // Execute search in the web worker
  useEffect(() => {
    let cancelled = false;

    // When query is empty, return locally filtered chats
    if (!debouncedQuery) {
      const filtered = dateFilter
        ? applyDateFilter(deserializedChats, dateFilter)
        : deserializedChats;
      const sorted = sortChatsWithoutQuery(filtered).map((chat) => ({
        item: chat,
        score: 0,
        matches: [],
      }));

      setResults(sorted);
      setMessageResults([]);
      setIsSearching(false);
      return undefined;
    }

    const serializedDateFilter = dateFilter
      ? {
          after: dateFilter.after?.toISOString(),
          before: dateFilter.before?.toISOString(),
        }
      : null;

    const searchOptions: WorkerSearchOptions = {
      sortBy,
      dateFilter: serializedDateFilter,
      searchMessages,
    };

    setIsSearching(true);

    workerSearchManager
      .search(debouncedQuery, searchOptions, cachedChats)
      .then(({ chatResults, messageResults: workerMessages }) => {
        if (cancelled) return;

        // Base chat results (title matches)
        const mappedChats = chatResults
          .map((result) => {
            const chat = chatMap.get(result.chatId);
            return chat
              ? ({
                  item: chat,
                  score: result.score,
                  matches: [],
                } as SearchResult<Chat>)
              : null;
          })
          .filter(Boolean) as SearchResult<Chat>[];

        // When searching content, also rank chats by their message hits
        if (searchMessages) {
          const chatResultMap = new Map<string, SearchResult<Chat>>();
          mappedChats.forEach((result) =>
            chatResultMap.set(result.item.id, { ...result })
          );

          const messageChatScores = new Map<string, number>();

          const mappedMessages: MessageSearchResult[] = workerMessages.map(
            (message) => ({
              id: message.messageId,
              chatId: message.chatId,
              chatTitle: message.chatTitle,
              createdAt: new Date(message.createdAt),
              content: message.content,
              snippet: message.snippet,
              highlights: message.highlights,
              score: message.score,
            })
          );

          // Track the highest-scoring message per chat
          mappedMessages.forEach((message) => {
            const chatId = message.chatId;
            const current = messageChatScores.get(chatId) ?? -Infinity;
            if (message.score > current) {
              messageChatScores.set(chatId, message.score);
            }
          });

          // Merge message-backed chats into the chat results list
          messageChatScores.forEach((score, chatId) => {
            const chat = chatMap.get(chatId);
            if (!chat) return;

            const existing = chatResultMap.get(chatId);
            if (existing) {
              // Lift score if message match is stronger
              if (score > existing.score) {
                chatResultMap.set(chatId, { ...existing, score });
              }
              return;
            }

            chatResultMap.set(chatId, {
              item: chat,
              score,
              matches: [],
            });
          });

          const mergedChatResults = Array.from(chatResultMap.values()).sort(
            (a, b) => b.score - a.score
          );

          setResults(mergedChatResults);
          setMessageResults(mappedMessages);
        } else {
          setResults(mappedChats);
          setMessageResults([]);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Search worker failed', error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    debouncedQuery,
    cachedChats,
    chatMap,
    dateFilter,
    deserializedChats,
    searchMessages,
    sortBy,
    sortChatsWithoutQuery,
  ]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setDebouncedQuery('');
    setDateFilter(null);
    setSortBy(initialSort);
  }, [initialSort, setQuery, setDateFilter, setSortBy]);

  const hasActiveFilters = useMemo(
    () => Boolean(debouncedQuery || dateFilter || sortBy !== 'relevance'),
    [debouncedQuery, dateFilter, sortBy]
  );

  return {
    query,
    debouncedQuery,
    parsedQuery,
    results,
    messageResults,
    isSearching: isSearching && query !== debouncedQuery,
    isIndexing,
    sortBy,
    dateFilter,
    totalCount: results.length,
    messageCount: messageResults.length,
    setQuery,
    setSortBy,
    setDateFilter,
    clearSearch,
    hasActiveFilters,
  };
}
