'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpDown,
  Calendar,
  ChevronDown,
  Clock,
  History,
  Loader2,
  Search,
  SortAsc,
  X,
} from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Chat } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { ChatItem } from './sidebar-history-item';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { deserializeChat } from '@/lib/chat/serialization';
import {
  useClientSearch,
  useSearchHistory,
  type SortOption,
} from '@/hooks/use-client-search';
import { generateSuggestions } from '@/lib/search/search-utils';
import type { DateFilter } from '@/lib/search/search-utils';
import { subDays, subWeeks, subMonths, format, startOfDay, endOfDay } from 'date-fns';

type SearchResults = {
  chats: Chat[];
  total: number;
};

const COMPACT_LIMIT = 8;
const PAGE_SIZE = 20;

async function fetchChatSearch(
  query: string,
  limit: number,
  offset = 0
): Promise<SearchResults & { nextOffset: number | null }> {
  if (!query)
    return {
      chats: [],
      total: 0,
      nextOffset: null,
    };

  const res = await fetch(
    `/api/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`
  );

  if (!res.ok) {
    throw new Error('Failed to search chats');
  }

  const data: SearchResults = await res.json();

  return {
    ...data,
    nextOffset:
      data.chats.length < limit || data.total <= offset + data.chats.length
        ? null
        : offset + data.chats.length,
  };
}

// Date filter presets
type DatePreset = {
  label: string;
  value: string;
  getFilter: () => DateFilter;
};

const datePresets: DatePreset[] = [
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

const sortOptions: { label: string; value: SortOption; icon: typeof Clock }[] = [
  { label: 'Relevance', value: 'relevance', icon: ArrowUpDown },
  { label: 'Newest first', value: 'newest', icon: Clock },
  { label: 'Oldest first', value: 'oldest', icon: History },
  { label: 'Title A-Z', value: 'title', icon: SortAsc },
];

// Search suggestions dropdown
function SearchSuggestions({
  query,
  history,
  onSelect,
  onRemove,
  visible,
}: {
  query: string;
  history: string[];
  onSelect: (suggestion: string) => void;
  onRemove: (suggestion: string) => void;
  visible: boolean;
}) {
  const suggestions = useMemo(
    () => generateSuggestions(query, history, 5),
    [query, history]
  );

  if (!visible || (suggestions.length === 0 && history.length === 0)) {
    return null;
  }

  const showHistory = !query && history.length > 0;
  const items = showHistory ? history.slice(0, 5) : suggestions;

  if (items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover p-1 shadow-md"
    >
      <div className="text-xs text-muted-foreground px-2 py-1">
        {showHistory ? 'Recent searches' : 'Suggestions'}
      </div>
      {items.map((item) => (
        <div
          key={item}
          className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer group"
          onClick={() => onSelect(item)}
        >
          <div className="flex items-center gap-2">
            {showHistory ? (
              <History className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Search className="h-3 w-3 text-muted-foreground" />
            )}
            <span>{item}</span>
          </div>
          {showHistory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </motion.div>
  );
}

// Active filters display
function ActiveFilters({
  dateFilter,
  sortBy,
  onClearDate,
  onResetSort,
}: {
  dateFilter: DateFilter | null;
  sortBy: SortOption;
  onClearDate: () => void;
  onResetSort: () => void;
}) {
  const hasFilters = dateFilter || sortBy !== 'relevance';

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

export function ChatSearch({
  currentChatId,
  onDelete,
  onRename,
}: {
  currentChatId?: string;
  onDelete: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cacheSyncRef = useRef<string | null>(null);
  const {
    cachedChats,
    ready: isCacheReady,
    refreshCache,
    status: cacheStatus,
    error: cacheError,
  } = useEncryptedCache();

  // Deserialize cached chats
  const cachedChatEntities = useMemo(
    () => cachedChats.map((entry) => deserializeChat(entry.data.chat)),
    [cachedChats]
  );

  // Client-side search with enhanced capabilities
  const {
    query: searchQuery,
    debouncedQuery,
    results: clientResults,
    isSearching,
    sortBy,
    dateFilter,
    totalCount: clientTotalCount,
    setQuery: setSearchQuery,
    setSortBy,
    setDateFilter,
    clearSearch,
    hasActiveFilters,
  } = useClientSearch(cachedChatEntities, {
    debounceMs: 150,
    searchOptions: {
      fuzzy: true,
      prefixMatch: true,
      caseSensitive: false,
    },
  });

  // Search history for suggestions
  const { history, addToHistory, removeFromHistory } = useSearchHistory();

  // Server search for comprehensive results
  const {
    data: serverResults,
    isLoading: isServerLoading,
    isFetching: isServerFetching,
    isError: isServerError,
  } = useQuery<SearchResults>({
    queryKey: ['chat', 'search', debouncedQuery, 'compact'],
    queryFn: async () => {
      const response = await fetchChatSearch(debouncedQuery, COMPACT_LIMIT);
      return {
        chats: response.chats,
        total: response.total,
      };
    },
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  });

  // Dialog infinite query for full results
  const {
    data: dialogPages,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isError: isInfiniteError,
    isLoading: isInfiniteLoading,
    isRefetching,
  } = useInfiniteQuery<SearchResults & { nextOffset: number | null }>({
    queryKey: ['chat', 'search', debouncedQuery, 'infinite'],
    queryFn: async ({ pageParam = 0 }) =>
      fetchChatSearch(
        debouncedQuery,
        PAGE_SIZE,
        typeof pageParam === 'number' ? pageParam : 0
      ),
    getNextPageParam: (lastPage) =>
      lastPage && lastPage.nextOffset !== null
        ? lastPage.nextOffset
        : undefined,
    enabled: isDialogOpen && debouncedQuery.length > 0,
    staleTime: 30_000,
    initialPageParam: 0,
  });

  const dialogChats = dialogPages?.pages.flatMap((page) => page?.chats ?? []) ?? [];
  const dialogTotal = dialogPages?.pages[0]?.total ?? 0;
  const isDialogLoading = isDialogOpen && isInfiniteLoading;
  const isDialogFetching = isDialogOpen && (isFetchingNextPage || isRefetching);
  const isDialogError = isDialogOpen && (isInfiniteError || isServerError);

  // Sync cache when server returns results not in cache
  useEffect(() => {
    if (!isCacheReady) return;
    if (!debouncedQuery) return;
    if (!serverResults?.chats?.length) return;

    const cachedIds = new Set(cachedChatEntities.map((chat) => chat.id));
    const hasMissing = serverResults.chats.some((chat) => !cachedIds.has(chat.id));

    if (hasMissing) {
      const signature = `${debouncedQuery}-compact-${serverResults.chats.map((c) => c.id).join(',')}`;
      if (cacheSyncRef.current !== signature) {
        cacheSyncRef.current = signature;
        void refreshCache();
      }
    }
  }, [isCacheReady, debouncedQuery, serverResults, cachedChatEntities, refreshCache]);

  useEffect(() => {
    if (!isCacheReady) return;
    if (!debouncedQuery) return;
    if (!dialogChats.length) return;

    const cachedIds = new Set(cachedChatEntities.map((chat) => chat.id));
    const hasMissing = dialogChats.some((chat) => !cachedIds.has(chat.id));

    if (hasMissing) {
      const signature = `${debouncedQuery}-infinite-${dialogChats.map((c) => c.id).join(',')}`;
      if (cacheSyncRef.current !== signature) {
        cacheSyncRef.current = signature;
        void refreshCache();
      }
    }
  }, [isCacheReady, debouncedQuery, dialogChats, cachedChatEntities, refreshCache]);

  // Combine client and server results for display
  const compactResults = useMemo(() => {
    if (!debouncedQuery) return [] as Chat[];

    const map = new Map<string, Chat>();

    // Add client results first (from cache - instant)
    clientResults.slice(0, COMPACT_LIMIT).forEach((result) => {
      map.set(result.item.id, result.item);
    });

    // Add server results (may have additional matches)
    (serverResults?.chats ?? []).forEach((chat) => {
      map.set(chat.id, chat);
    });

    return Array.from(map.values()).slice(0, COMPACT_LIMIT);
  }, [clientResults, serverResults, debouncedQuery]);

  const totalResults = Math.max(serverResults?.total ?? 0, clientTotalCount);

  // Handle search submission (save to history)
  const handleSearchSubmit = useCallback(() => {
    if (debouncedQuery) {
      addToHistory(debouncedQuery);
    }
    setShowSuggestions(false);
  }, [debouncedQuery, addToHistory]);

  const handleClear = useCallback(() => {
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      setSearchQuery(suggestion);
      setShowSuggestions(false);
      addToHistory(suggestion);
    },
    [setSearchQuery, addToHistory]
  );

  // Close dialog when query is cleared
  useEffect(() => {
    if (!debouncedQuery) {
      setIsDialogOpen(false);
    }
  }, [debouncedQuery]);

  // Reset cache sync ref when cache is not ready
  useEffect(() => {
    if (!isCacheReady) {
      cacheSyncRef.current = null;
    }
  }, [isCacheReady]);

  // Track mounted state to prevent hydration flash
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const showResults = debouncedQuery.length > 0;
  const hasResults = compactResults.length > 0;
  const showViewAll = hasResults && totalResults > compactResults.length;

  // Determine if search should be expanded (focused, has query, or has active filters)
  // Only expand after mounted to prevent hydration flash
  const shouldExpand = isMounted && (isExpanded || showResults || hasActiveFilters);

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't collapse if dropdown or popover is open (they render in portals)
      if (isDropdownOpen || isPopoverOpen) return;

      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        !searchQuery &&
        !hasActiveFilters
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [searchQuery, hasActiveFilters, isDropdownOpen, isPopoverOpen]);

  // Get match positions for highlighting
  const getMatchPositions = useCallback(
    (chatId: string) => {
      const result = clientResults.find((r) => r.item.id === chatId);
      if (!result) return [];
      const titleMatch = result.matches.find((m) => m.field === 'title');
      return titleMatch?.positions ?? [];
    },
    [clientResults]
  );

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div ref={containerRef} className="flex flex-col gap-2 px-2">
          {/* Search input with suggestions */}
          <div className="relative">
            <motion.div
              className="relative"
              initial={false}
              animate={{
                boxShadow: shouldExpand
                  ? '0 0 0 2px hsl(var(--ring) / 0.2)'
                  : '0 0 0 0px transparent',
              }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ borderRadius: '0.375rem' }}
            >
              <Search
                className={cn(
                  'absolute top-2.5 left-2 transition-colors duration-200',
                  shouldExpand ? 'text-foreground' : 'text-muted-foreground'
                )}
                size={16}
              />
              <Input
                className={cn(
                  'h-9 w-full pl-8 transition-all duration-200',
                  shouldExpand ? 'pr-20' : 'pr-8'
                )}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => {
                  setIsExpanded(true);
                  setShowSuggestions(true);
                }}
                onBlur={() => {
                  // Delay to allow click on suggestions
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSearchSubmit();
                  }
                  if (e.key === 'Escape') {
                    setShowSuggestions(false);
                    if (!searchQuery && !hasActiveFilters) {
                      setIsExpanded(false);
                    }
                    inputRef.current?.blur();
                  }
                }}
                placeholder="Search conversations..."
                ref={inputRef}
                type="text"
                value={searchQuery}
              />

              {/* Action buttons - only show when expanded */}
              <AnimatePresence>
                {shouldExpand && (
                  <motion.div
                    className="absolute right-1 top-1 flex items-center gap-0.5"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    {(isSearching || isServerLoading) && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
                    )}

                    {/* Sort dropdown */}
                    <TooltipProvider delayDuration={300}>
                      <DropdownMenu onOpenChange={setIsDropdownOpen}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  'h-7 w-7',
                                  sortBy !== 'relevance' && 'text-primary'
                                )}
                              >
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Sort results</TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {sortOptions.map((option) => (
                            <DropdownMenuItem
                              key={option.value}
                              onClick={() => setSortBy(option.value)}
                              className={cn(
                                'cursor-pointer',
                                sortBy === option.value && 'bg-accent'
                              )}
                            >
                              <option.icon className="mr-2 h-4 w-4" />
                              {option.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TooltipProvider>

                    {/* Date filter dropdown */}
                    <TooltipProvider delayDuration={300}>
                      <Popover onOpenChange={setIsPopoverOpen}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  'h-7 w-7',
                                  dateFilter && 'text-primary'
                                )}
                              >
                                <Calendar className="h-3.5 w-3.5" />
                              </Button>
                            </PopoverTrigger>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">Filter by date</TooltipContent>
                        </Tooltip>
                        <PopoverContent align="end" className="w-48 p-1">
                          <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                            Date range
                          </div>
                          {datePresets.map((preset) => (
                            <button
                              key={preset.value}
                              onClick={() => setDateFilter(preset.getFilter())}
                              className={cn(
                                'w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent',
                                dateFilter?.after?.getTime() ===
                                preset.getFilter().after?.getTime() &&
                                'bg-accent'
                              )}
                            >
                              {preset.label}
                            </button>
                          ))}
                          {dateFilter && (
                            <>
                              <div className="h-px bg-border my-1" />
                              <button
                                onClick={() => setDateFilter(null)}
                                className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent text-muted-foreground"
                              >
                                Clear filter
                              </button>
                            </>
                          )}
                        </PopoverContent>
                      </Popover>
                    </TooltipProvider>

                    {/* Clear button */}
                    {searchQuery && (
                      <Button
                        className="h-7 w-7 p-0"
                        onClick={handleClear}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <X size={14} />
                        <span className="sr-only">Clear search</span>
                      </Button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Suggestions dropdown */}
            <AnimatePresence>
              {showSuggestions && shouldExpand && (
                <SearchSuggestions
                  query={searchQuery}
                  history={history}
                  onSelect={handleSuggestionSelect}
                  onRemove={removeFromHistory}
                  visible={showSuggestions}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Active filters - only show when expanded and has filters */}
          <AnimatePresence>
            {shouldExpand && hasActiveFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <ActiveFilters
                  dateFilter={dateFilter}
                  sortBy={sortBy}
                  onClearDate={() => setDateFilter(null)}
                  onResetSort={() => setSortBy('relevance')}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Search tips - shown when expanded but no active search */}
          <AnimatePresence>
            {shouldExpand && !showResults && !hasActiveFilters && (
              <motion.div
                className="text-xs text-muted-foreground space-y-1 px-1 overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <p className="font-medium">Search tips:</p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  <li><code className="bg-muted px-1 rounded">&quot;exact phrase&quot;</code> for exact matches</li>
                  <li><code className="bg-muted px-1 rounded">-exclude</code> to exclude terms</li>
                  <li>Use filters for date ranges</li>
                </ul>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Cache status messages */}
          {cacheStatus === 'initializing' && (
            <div className="rounded-md border border-border/40 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Syncing cache for faster search results…
            </div>
          )}

          {cacheStatus === 'error' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Local cache unavailable
              {cacheError ? `: ${cacheError.message}` : ''}.
            </div>
          )}

          {/* Search results */}
          <AnimatePresence initial={false}>
            {showResults && (
              <motion.section
                key="results"
                className={cn(
                  'rounded-md border border-border/40 bg-muted/40 p-2 shadow-sm',
                  !hasResults && 'border-dashed'
                )}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {(isServerLoading || isServerFetching) && !hasResults && (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching conversations…
                  </div>
                )}

                {isServerError && !isServerLoading && !isServerFetching && !hasResults && (
                  <div className="py-4 text-center text-sm text-destructive">
                    Something went wrong while searching. Please try again.
                  </div>
                )}

                {!isServerError && !isServerLoading && !isServerFetching && !hasResults && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No conversations found for &quot;{debouncedQuery}&quot;.
                  </div>
                )}

                {!isServerError && hasResults && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                      <span>
                        Showing {compactResults.length} of {totalResults} result
                        {totalResults === 1 ? '' : 's'}
                      </span>
                      {isCacheReady && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          Instant
                        </Badge>
                      )}
                    </div>
                    <SidebarMenu>
                      {compactResults.map((chat) => (
                        <ChatItem
                          chat={chat}
                          isActive={chat.id === currentChatId}
                          key={chat.id}
                          onDelete={onDelete}
                          onRename={onRename}
                          setOpenMobile={setOpenMobile}
                        />
                      ))}
                    </SidebarMenu>

                    {showViewAll && (
                      <Dialog
                        open={isDialogOpen}
                        onOpenChange={setIsDialogOpen}
                      >
                        <DialogTrigger asChild>
                          <Button
                            className="mt-1 w-full"
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            View all {totalResults} results
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl space-y-4">
                          <DialogHeader>
                            <DialogTitle>Search results</DialogTitle>
                            <DialogDescription>
                              Showing conversations matching &quot;{debouncedQuery}&quot;.
                            </DialogDescription>
                          </DialogHeader>

                          {/* Dialog filters */}
                          <div className="flex items-center justify-between border-b pb-3">
                            <ActiveFilters
                              dateFilter={dateFilter}
                              sortBy={sortBy}
                              onClearDate={() => setDateFilter(null)}
                              onResetSort={() => setSortBy('relevance')}
                            />
                            <div className="flex items-center gap-2">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="outline" size="sm">
                                    <ArrowUpDown className="mr-2 h-3.5 w-3.5" />
                                    Sort
                                    <ChevronDown className="ml-2 h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {sortOptions.map((option) => (
                                    <DropdownMenuItem
                                      key={option.value}
                                      onClick={() => setSortBy(option.value)}
                                      className={cn(
                                        sortBy === option.value && 'bg-accent'
                                      )}
                                    >
                                      <option.icon className="mr-2 h-4 w-4" />
                                      {option.label}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>

                          {(isDialogLoading || isDialogFetching) &&
                            !dialogChats.length && (
                              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Fetching more conversations…
                              </div>
                            )}

                          {isDialogError &&
                            !isDialogLoading &&
                            !dialogChats.length && (
                              <div className="py-6 text-center text-sm text-destructive">
                                We couldn&apos;t load the full results. Please try
                                again later.
                              </div>
                            )}

                          {!isDialogError && dialogChats.length > 0 && (
                            <ScrollArea className="max-h-[65vh] pr-4">
                              <div className="flex flex-col gap-3">
                                <div className="text-xs text-muted-foreground">
                                  {dialogTotal} conversation
                                  {dialogTotal === 1 ? '' : 's'} found
                                </div>
                                <SidebarMenu className="gap-2">
                                  {dialogChats.map((chat) => (
                                    <ChatItem
                                      chat={chat}
                                      isActive={chat.id === currentChatId}
                                      key={chat.id}
                                      onDelete={(chatId) => {
                                        onDelete(chatId);
                                        setIsDialogOpen(false);
                                      }}
                                      onRename={onRename}
                                      setOpenMobile={setOpenMobile}
                                    />
                                  ))}
                                </SidebarMenu>

                                {hasNextPage && (
                                  <Button
                                    className="mt-1 self-center"
                                    disabled={isFetchingNextPage}
                                    onClick={() => fetchNextPage()}
                                    size="sm"
                                    type="button"
                                    variant="outline"
                                  >
                                    {isFetchingNextPage
                                      ? 'Loading more…'
                                      : 'Load more results'}
                                  </Button>
                                )}
                              </div>
                            </ScrollArea>
                          )}

                          {!isDialogError &&
                            !dialogChats.length &&
                            !isDialogLoading && (
                              <div className="py-6 text-center text-sm text-muted-foreground">
                                No additional conversations found.
                              </div>
                            )}
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
