'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Search, X } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
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

export function ChatSearch({
  currentChatId,
  onDelete,
}: {
  currentChatId?: string;
  onDelete: (chatId: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { setOpenMobile } = useSidebar();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const {
    cachedChats,
    ready: isCacheReady,
    refreshCache,
    status: cacheStatus,
    error: cacheError,
  } = useEncryptedCache();
  const cachedChatEntities = useMemo(
    () => cachedChats.map((entry) => deserializeChat(entry.data.chat)),
    [cachedChats]
  );
  const cachedMatches = useMemo(() => {
    if (!isCacheReady) return [] as Chat[];
    if (!debouncedQuery) return [] as Chat[];
    const normalized = debouncedQuery.toLowerCase();
    return cachedChatEntities
      .filter((chat) => chat.title.toLowerCase().includes(normalized))
      .slice(0, COMPACT_LIMIT);
  }, [cachedChatEntities, debouncedQuery, isCacheReady]);
  const cacheSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isCacheReady) {
      cacheSyncRef.current = null;
    }
  }, [isCacheReady]);

  // Debounce search input
  useEffect(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 300);

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedQuery) {
      setIsDialogOpen(false);
    }
  }, [debouncedQuery]);

  const {
    data: fullResults,
    isLoading,
    isFetching,
    isError,
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

  const dialogResults = dialogPages?.pages ?? [];
  const dialogChats = dialogResults.flatMap((page) => page?.chats ?? []);
  const dialogTotal =
    dialogResults.length > 0 ? (dialogResults[0]?.total ?? 0) : 0;
  const isDialogLoading = isDialogOpen && isInfiniteLoading;
  const isDialogFetching = isDialogOpen && (isFetchingNextPage || isRefetching);
  const isDialogError = isDialogOpen && (isInfiniteError || isError);

  useEffect(() => {
    if (!debouncedQuery) {
      cacheSyncRef.current = null;
    }
  }, [debouncedQuery]);

  useEffect(() => {
    if (!isCacheReady) return;
    if (!debouncedQuery) return;
    if (!fullResults?.chats?.length) return;

    const cachedIds = new Set(cachedChatEntities.map((chat) => chat.id));
    const hasMissing = fullResults.chats.some(
      (chat) => !cachedIds.has(chat.id)
    );
    if (hasMissing) {
      const signature = `${debouncedQuery}-compact-${fullResults.chats
        .map((chat) => chat.id)
        .join(',')}`;
      if (cacheSyncRef.current !== signature) {
        cacheSyncRef.current = signature;
        void refreshCache();
      }
    }
  }, [
    isCacheReady,
    debouncedQuery,
    fullResults,
    cachedChatEntities,
    refreshCache,
  ]);

  useEffect(() => {
    if (!isCacheReady) return;
    if (!debouncedQuery) return;
    if (!dialogChats.length) return;
    const cachedIds = new Set(cachedChatEntities.map((chat) => chat.id));
    const hasMissing = dialogChats.some((chat) => !cachedIds.has(chat.id));
    if (hasMissing) {
      const signature = `${debouncedQuery}-infinite-${dialogChats
        .map((chat) => chat.id)
        .join(',')}`;
      if (cacheSyncRef.current !== signature) {
        cacheSyncRef.current = signature;
        void refreshCache();
      }
    }
  }, [
    isCacheReady,
    debouncedQuery,
    dialogChats,
    cachedChatEntities,
    refreshCache,
  ]);

  const handleClear = useCallback(() => {
    setSearchQuery('');
    setDebouncedQuery('');
    inputRef.current?.focus();
  }, []);

  const showResults = debouncedQuery.length > 0;
  const combinedCompactResults = useMemo(() => {
    const map = new Map<string, Chat>();
    cachedMatches.forEach((chat) => map.set(chat.id, chat));
    (fullResults?.chats ?? []).forEach((chat) => map.set(chat.id, chat));
    return Array.from(map.values()).slice(0, COMPACT_LIMIT);
  }, [cachedMatches, fullResults]);

  const compactResults = combinedCompactResults;
  const hasResults = compactResults.length > 0;
  const totalResults = fullResults?.total ?? compactResults.length;
  const showViewAll = hasResults && totalResults > compactResults.length;

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <div className="flex flex-col gap-3 px-2">
          <motion.div
            className="relative"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <Search
              className="absolute top-2.5 left-2 text-muted-foreground"
              size={16}
            />
            <Input
              className="h-9 w-full pl-8 pr-8"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              ref={inputRef}
              type="text"
              value={searchQuery}
            />
            {searchQuery && (
              <Button
                className="absolute top-1 right-1 h-7 w-7 p-0"
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
                {(isLoading || isFetching) && (
                  <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching conversations…
                  </div>
                )}

                {isError && !isLoading && !isFetching && (
                  <div className="py-4 text-center text-sm text-destructive">
                    Something went wrong while searching. Please try again.
                  </div>
                )}

                {!isError && !isLoading && !isFetching && !hasResults && (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No conversations found for “{debouncedQuery}”.
                  </div>
                )}

                {!isError && hasResults && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                      <span>
                        Showing {compactResults.length} of {totalResults} result
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
                            View all results
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl space-y-4">
                          <DialogHeader>
                            <DialogTitle>Search results</DialogTitle>
                            <DialogDescription>
                              Showing conversations matching “{debouncedQuery}”.
                            </DialogDescription>
                          </DialogHeader>

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
                                We couldn’t load the full results. Please try
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
