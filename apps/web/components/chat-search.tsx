'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
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
import { useClientSearch } from '@/hooks/use-client-search';
import { useSearchStore } from '@/lib/stores/search-store';
import { SearchActiveFilters } from './search/search-active-filters';
import { SearchFilterActions } from './search/search-filter-actions';
import { ChatSearchModal } from './search/chat-search-modal';

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
    searchScope,
    isModalOpen,
    setQuery,
    setSortBy,
    setDateFilter,
    setSearchScope,
    setModalOpen,
    resetFilters,
  } = useSearchStore();

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

  // Client-side search with enhanced capabilities
  const {
    debouncedQuery,
    results: clientResults,
    isSearching,
    isIndexing,
    totalCount: clientTotalCount,
    clearSearch,
    hasActiveFilters,
  } = useClientSearch(cachedChats, {
    debounceMs: 150,
    searchMessages: searchScope === 'content',
    value: {
      query,
      sortBy,
      dateFilter,
      onQueryChange: setQuery,
      onSortChange: setSortBy,
      onDateChange: setDateFilter,
    },
  });

  const compactResults = useMemo(() => {
    if (!debouncedQuery) return [] as Chat[];
    return clientResults.slice(0, COMPACT_LIMIT).map((r) => r.item);
  }, [clientResults, debouncedQuery]);

  const totalResults = clientTotalCount;

  // Handle search submission
  const handleSearchSubmit = useCallback(() => {
    inputRef.current?.blur();
  }, []);

  const handleClear = useCallback(() => {
    resetFilters();
    inputRef.current?.focus();
  }, [resetFilters]);

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
    isMounted && (isExpanded || showResults || hasActiveFilters || searchScope === 'titles');

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
      if (!query && !hasActiveFilters && searchScope !== 'titles') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [query, hasActiveFilters, searchScope, isModalOpen, isDropdownOpen, isPopoverOpen]);

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
                <InputGroup>
                  <InputGroupAddon>
                    <Search
                      className={cn(
                        'transition-colors duration-200',
                        shouldExpand
                          ? 'text-foreground'
                          : 'text-muted-foreground'
                      )}
                      size={16}
                    />
                  </InputGroupAddon>
                  <InputGroupInput
                    className="h-9"
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                    onFocus={() => {
                      setIsExpanded(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleSearchSubmit();
                      }
                      if (e.key === 'Escape') {
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
                  <InputGroupAddon align="inline-end">
                    <AnimatePresence>
                      {shouldExpand && (
                        <motion.div
                          className="flex items-center gap-0.5"
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                        >
                          {(isSearching || isIndexing) && (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
                          )}

                          <SearchFilterActions
                            sortBy={sortBy}
                            setSortBy={setSortBy}
                            dateFilter={dateFilter}
                            setDateFilter={setDateFilter}
                            searchScope={searchScope}
                            setSearchScope={setSearchScope}
                            compact={true}
                            onSortOpenChange={setIsDropdownOpen}
                            onDateOpenChange={setIsPopoverOpen}
                          />

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
                  </InputGroupAddon>
                </InputGroup>
              </motion.div>
            </div>

            {/* Active filters - only show when expanded and has filters */}
            <AnimatePresence>
              {shouldExpand && (hasActiveFilters || searchScope === 'titles') && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <SearchActiveFilters
                    dateFilter={dateFilter}
                    sortBy={sortBy}
                    searchScope={searchScope}
                    onClearDate={() => setDateFilter(null)}
                    onResetSort={() => setSortBy('relevance')}
                    onResetScope={() => setSearchScope('content')}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Search tips - shown when expanded but no active search */}
            <AnimatePresence>
              {shouldExpand && !showResults && !hasActiveFilters && searchScope !== 'titles' && (
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
            {cacheStatus === 'initializing' && cachedChats.length === 0 && (
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
                      <div className="flex items-center px-1 text-xs text-muted-foreground">
                        <span>
                          Showing {compactResults.length} of {totalResults}{' '}
                          result
                          {totalResults === 1 ? '' : 's'}
                        </span>
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
