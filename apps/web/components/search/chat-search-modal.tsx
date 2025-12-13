'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { useClientSearch, useSearchHistory } from '@/hooks/use-client-search';
import { useSearchStore } from '@/lib/stores/search-store';
import { getEncryptedCacheManager } from '@/lib/cache/cache-manager';
import { ChatItem } from '../sidebar-history-item';
import { SearchActiveFilters } from './search-active-filters';
import { SearchFilterActions } from './search-filter-actions';
import { SearchResultItem } from './search-result-item';
import { SearchSuggestions } from './search-suggestions';
import { Badge } from '../ui/badge';

interface ChatSearchModalProps {
  currentChatId?: string;
  onRename: (chatId: string, newTitle: string) => void;
}

export function ChatSearchModal({
  currentChatId,
  onRename,
}: ChatSearchModalProps) {
  const {
    isModalOpen,
    query,
    sortBy,
    dateFilter,
    setModalOpen,
    setQuery,
    setSortBy,
    setDateFilter,
    resetFilters,
  } = useSearchStore();

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const { setOpenMobile } = useSidebar();
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    cachedChats,
    ready: isCacheReady,
    removeOptimisticChat,
    refreshCache,
  } = useEncryptedCache();

  // Handle global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setModalOpen(!isModalOpen);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, setModalOpen]);

  const {
    debouncedQuery,
    messageResults,
    results: clientResults,
    isSearching,
    isIndexing,
    totalCount,
    clearSearch,
  } = useClientSearch(cachedChats, {
    debounceMs: 150,
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

  const handleSearchSubmit = useCallback(() => {
    if (debouncedQuery) {
      addToHistory(debouncedQuery);
    }
    setShowSuggestions(false);
  }, [debouncedQuery, addToHistory]);

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      setQuery(suggestion);
      setShowSuggestions(false);
      addToHistory(suggestion);
    },
    [setQuery, addToHistory]
  );

  const handleDelete = useCallback(() => {
    if (!deleteId) return;

    const chatIdToDelete = deleteId;

    const deletePromise = (async () => {
      const response = await fetch(`/api/chat?id=${chatIdToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete chat');
      }

      await response.json();

      // Remove from local cache and add to optimistic deleted set
      const cacheManager = getEncryptedCacheManager();
      await cacheManager.removeChat(chatIdToDelete);
      removeOptimisticChat(chatIdToDelete);

      queryClient.invalidateQueries({ queryKey: ['chat', 'search'] });

      // Trigger cache refresh to update state
      await refreshCache({ force: true });
    })();

    toast.promise(deletePromise, {
      loading: 'Deleting chat...',
      success: 'Chat deleted successfully',
      error: 'Failed to delete chat',
    });

    setShowDeleteDialog(false);
    setDeleteId(null);

    if (chatIdToDelete === currentChatId) {
      router.push('/chat');
      setModalOpen(false); // Only close if deleting current chat
    }
  }, [
    deleteId,
    currentChatId,
    queryClient,
    refreshCache,
    removeOptimisticChat,
    router,
    setModalOpen,
  ]);

  const dialogChats = useMemo(
    () => clientResults.map((r) => r.item),
    [clientResults]
  );

  /* State for pagination */
  const [itemsLimit, setItemsLimit] = useState(20);

  // Reset pagination when query changes
  useEffect(() => {
    setItemsLimit(20);
  }, [query, sortBy, dateFilter]);

  // Focus input when modal opens
  useEffect(() => {
    if (isModalOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isModalOpen]);

  const hasMessageResults = messageResults.length > 0;
  const hasClientResults = dialogChats.length > 0;
  const showSeparators = hasMessageResults && hasClientResults;
  const isGlobalSearching = isSearching || isIndexing;

  const handleLoadMore = () => {
    setItemsLimit((prev) => prev + 20);
  };

  const items = useMemo(() => {
    const list: Array<{
      type: 'header-message' | 'header-chat' | 'message' | 'chat';
      data?: any;
      key: string;
      content?: string;
      count?: number;
    }> = [];

    if (hasMessageResults) {
      list.push({
        type: 'header-message',
        key: 'header-messages',
        count: messageResults.length,
      });
      messageResults.forEach((result) => {
        list.push({ type: 'message', data: result, key: result.id });
      });
    }

    if (hasClientResults) {
      list.push({
        type: 'header-chat',
        key: 'header-chats',
        content: showSeparators
          ? 'Conversation Titles'
          : `${totalCount} conversation${totalCount === 1 ? '' : 's'} found`,
      });
      dialogChats.forEach((chat) => {
        list.push({ type: 'chat', data: chat, key: chat.id });
      });
    }

    return list;
  }, [
    hasMessageResults,
    messageResults,
    hasClientResults,
    dialogChats,
    showSeparators,
    totalCount,
  ]);

  const visibleItems = items.slice(0, itemsLimit);
  const hasMore = itemsLimit < items.length;

  return (
    <>
      <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl space-y-4 h-[85vh] flex flex-col overflow-hidden w-full">
          <DialogHeader className="flex-none">
            <DialogTitle>Search conversations</DialogTitle>
            <DialogDescription>
              Search through your chat history with advanced filters.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 min-h-0 w-full overflow-hidden">
            {/* Search Input Area */}
            <div className="relative flex-none z-50 p-1">
              <InputGroup className="w-full">
                <InputGroupAddon>
                  <Search className="h-4 w-4 text-muted-foreground" />
                </InputGroupAddon>
                <InputGroupInput
                  ref={inputRef}
                  className="h-10"
                  placeholder="Search conversations..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() =>
                    setTimeout(() => setShowSuggestions(false), 200)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearchSubmit();
                    if (e.key === 'Escape') setShowSuggestions(false);
                  }}
                />
                <InputGroupAddon align="inline-end">
                  {isGlobalSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : query ? (
                    <button
                      onClick={() => {
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : null}
                </InputGroupAddon>
              </InputGroup>

              {/* Suggestions */}
              <SearchSuggestions
                query={query}
                history={history}
                onSelect={handleSuggestionSelect}
                onRemove={removeFromHistory}
                visible={showSuggestions}
              />
            </div>

            {/* Filters Bar */}
            <div className="flex items-center justify-between border-b pb-3 flex-none">
              <div className="flex-1 min-w-0 mr-4">
                <SearchActiveFilters
                  dateFilter={dateFilter}
                  sortBy={sortBy}
                  onClearDate={() => setDateFilter(null)}
                  onResetSort={() => setSortBy('relevance')}
                />
              </div>
              <div className="flex items-center gap-2 flex-none">
                <SearchFilterActions
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  dateFilter={dateFilter}
                  setDateFilter={setDateFilter}
                  compact={false}
                />
              </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 min-h-0 relative w-full">
              {!isCacheReady && !hasMessageResults && (
                <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading history...</span>
                  </div>
                </div>
              )}

              {items.length > 0 ? (
                <div className="h-full overflow-y-auto pr-4 w-full">
                  <div className="flex flex-col gap-2 pb-4 w-full">
                    {visibleItems.map((item) => (
                      <div key={item.key} className="min-w-0 w-full max-w-full">
                        {item.type === 'header-message' && (
                          <div className="text-xs font-medium text-muted-foreground bg-background py-1 z-10 flex items-center gap-2 mb-2 pl-1 sticky top-0">
                            Message Matches
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1 h-5"
                            >
                              {item.count}
                            </Badge>
                          </div>
                        )}
                        {item.type === 'header-chat' && (
                          <div className="text-xs font-medium text-muted-foreground bg-background py-1 z-10 flex items-center gap-2 mb-2 mt-2 pl-1 sticky top-0">
                            {item.content}
                          </div>
                        )}
                        {item.type === 'message' && (
                          <div className="px-1 min-w-0">
                            <SearchResultItem
                              result={item.data}
                              query={query}
                              onSelect={() => setModalOpen(false)}
                            />
                          </div>
                        )}
                        {item.type === 'chat' && (
                          <div className="px-1 min-w-0">
                            <ChatItem
                              chat={item.data}
                              isActive={item.data.id === currentChatId}
                              onDelete={(chatId) => {
                                setDeleteId(chatId);
                                setShowDeleteDialog(true);
                              }}
                              onRename={onRename}
                              setOpenMobile={setOpenMobile}
                            />
                          </div>
                        )}
                      </div>
                    ))}

                    {hasMore && (
                      <div className="pt-4 pb-2 flex justify-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleLoadMore}
                          className="w-full max-w-xs"
                        >
                          Load more results
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  {query ? (
                    <span>
                      No conversations found matching &quot;{query}&quot;
                    </span>
                  ) : (
                    <span>Start typing to search your history</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              chat and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
