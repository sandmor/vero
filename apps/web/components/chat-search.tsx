'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Maximize2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Chat } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { ChatItem } from './sidebar-history-item';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { deserializeChat } from '@/lib/chat/serialization';
import { useClientSearch, useSearchHistory } from '@/hooks/use-client-search';
import { useSearchStore } from '@/hooks/use-search-store';
import { SearchActiveFilters } from './search/search-active-filters';
import { SearchFilterActions } from './search/search-filter-actions';
import { SearchSuggestions } from './search/search-suggestions';
import { ChatSearchModal } from './search/chat-search-modal';
import { Badge } from './ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

const COMPACT_LIMIT = 8;

export function ChatSearch({
  currentChatId,
  onDelete,
  onRename,
}: {
  currentChatId?: string;
  onDelete: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
}) {
  const {
    query,
    sortBy,
    dateFilter,
    isModalOpen,
    setQuery,
    setSortBy,
    setDateFilter,
    setModalOpen,
    resetFilters,
  } = useSearchStore();

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    cachedChats,
    ready: isCacheReady,
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
    debouncedQuery,
    results: clientResults,
    isSearching,
    totalCount: clientTotalCount,
    clearSearch,
    hasActiveFilters,
  } = useClientSearch(cachedChatEntities, {
    debounceMs: 150,
    searchOptions: {
      fuzzy: true,
      prefixMatch: true,
      caseSensitive: false,
    },
    value: {
      query,
      sortBy,
      dateFilter,
      onQueryChange: setQuery,
      onSortChange: setSortBy,
      onDateChange: setDateFilter,
    },
  });

  // Search history for suggestions
  const { history, addToHistory, removeFromHistory } = useSearchHistory();

  const compactResults = useMemo(() => {
    if (!debouncedQuery) return [] as Chat[];
    return clientResults.slice(0, COMPACT_LIMIT).map((r) => r.item);
  }, [clientResults, debouncedQuery]);

  const totalResults = clientTotalCount;

  // Handle search submission (save to history)
  const handleSearchSubmit = useCallback(() => {
    if (debouncedQuery) {
      addToHistory(debouncedQuery);
    }
    setShowSuggestions(false);
  }, [debouncedQuery, addToHistory]);

  const handleClear = useCallback(() => {
    resetFilters();
    inputRef.current?.focus();
  }, [resetFilters]);

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      setQuery(suggestion);
      setShowSuggestions(false);
      addToHistory(suggestion);
    },
    [setQuery, addToHistory]
  );

  // Track mounted state to prevent hydration flash
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const showResults = debouncedQuery.length > 0;
  const hasResults = compactResults.length > 0;
  const showViewAll = hasResults && totalResults > compactResults.length;

  // Determine if search should be expanded (focused, has query, or has active filters)
  // Only expand after mounted to prevent hydration flash
  const shouldExpand =
    isMounted && (isExpanded || showResults || hasActiveFilters);

  // Handle click outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // Don't collapse if interacting with modal or open dropdowns
      if (isModalOpen || isDropdownOpen || isPopoverOpen) return;

      // Don't collapse if clicking inside the component
      if (
        containerRef.current &&
        containerRef.current.contains(event.target as Node)
      ) {
        return;
      }

      // Only collapse if no active search/filters
      if (!query && !hasActiveFilters) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [query, hasActiveFilters, isModalOpen, isDropdownOpen, isPopoverOpen]);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <div ref={containerRef} className="flex flex-col gap-2 px-2">
            {/* Search input with suggestions */}
            <div className="relative">
              <motion.div
                className="relative rounded-md"
                initial={false}
                animate={{
                  boxShadow: shouldExpand
                    ? '0 0 0 2px hsl(var(--ring) / 0.2)'
                    : '0 0 0 0px transparent',
                }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
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
                    setQuery(e.target.value);
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
                      if (!query && !hasActiveFilters) {
                        setIsExpanded(false);
                      }
                      inputRef.current?.blur();
                    }
                  }}
                  placeholder="Search..."
                  ref={inputRef}
                  type="text"
                  value={query}
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
                      {isSearching && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
                      )}

                      <SearchFilterActions
                        sortBy={sortBy}
                        setSortBy={setSortBy}
                        dateFilter={dateFilter}
                        setDateFilter={setDateFilter}
                        compact={true}
                        onSortOpenChange={setIsDropdownOpen}
                        onDateOpenChange={setIsPopoverOpen}
                      />

                      {/* Expand button */}
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setModalOpen(true)}
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Full search (Cmd+K)</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {/* Clear button */}
                      {query && (
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
                    query={query}
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
                  <SearchActiveFilters
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
                  <div className="flex justify-between items-center">
                    <p className="font-medium">Search tips:</p>
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded border">
                      ⌘K
                    </span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    <li>
                      <code className="bg-muted px-1 rounded">
                        &quot;exact phrase&quot;
                      </code>{' '}
                      for exact matches
                    </li>
                    <li>
                      <code className="bg-muted px-1 rounded">-exclude</code> to
                      exclude terms
                    </li>
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
                  {!hasResults && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      No conversations found for &quot;{debouncedQuery}&quot;.
                    </div>
                  )}

                  {hasResults && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                        <span>
                          Showing {compactResults.length} of {totalResults}{' '}
                          result
                          {totalResults === 1 ? '' : 's'}
                        </span>
                        {isCacheReady && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0"
                          >
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
                        <Button
                          className="mt-1 w-full"
                          size="sm"
                          type="button"
                          variant="secondary"
                          onClick={() => setModalOpen(true)}
                        >
                          View all {totalResults} results
                        </Button>
                      )}
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Full Feature Search Modal */}
      <ChatSearchModal currentChatId={currentChatId} onRename={onRename} />
    </>
  );
}
