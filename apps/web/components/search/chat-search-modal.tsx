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
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarMenu, useSidebar } from '@/components/ui/sidebar';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import { useClientSearch, useSearchHistory } from '@/hooks/use-client-search';
import { useSearchStore } from '@/hooks/use-search-store';
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

  return (
    <>
      <Dialog open={isModalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-3xl space-y-4 max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="flex-none">
            <DialogTitle>Search conversations</DialogTitle>
            <DialogDescription>
              Search through your chat history with advanced filters.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* Search Input Area */}
            <div className="relative flex-none z-50">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  className="h-10 w-full pl-9 pr-12"
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
                {isGlobalSearching ? (
                  <div className="absolute right-3 top-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : query ? (
                  <button
                    onClick={() => {
                      setQuery('');
                      inputRef.current?.focus();
                    }}
                    className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>

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
            <div className="flex-1 min-h-0 overflow-hidden relative">
              {!isCacheReady && !hasMessageResults && (
                <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Loading history...</span>
                  </div>
                </div>
              )}

              {hasMessageResults || hasClientResults ? (
                <ScrollArea className="h-full pr-4">
                  <div className="flex flex-col gap-6 pb-4">

                    {/* Message Matches */}
                    {hasMessageResults && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground sticky top-0 bg-background py-1 z-10 flex items-center gap-2">
                          Message Matches
                          <Badge variant="secondary" className="text-[10px] px-1 h-5">
                            {messageResults.length}
                          </Badge>
                        </div>
                        <SidebarMenu className="gap-2">
                          {messageResults.map((result) => (
                            <SearchResultItem
                              key={result.id}
                              result={result}
                              query={query}
                              onSelect={() => setModalOpen(false)}
                            />
                          ))}
                        </SidebarMenu>
                      </div>
                    )}

                    {/* Title Matches */}
                    {hasClientResults && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-muted-foreground sticky top-0 bg-background py-1 z-10 flex items-center gap-2">
                          {showSeparators ? 'Conversation Titles' : `${totalCount} conversation${totalCount === 1 ? '' : 's'} found`}
                        </div>
                        <SidebarMenu className="gap-2">
                          {dialogChats.map((chat) => (
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === currentChatId}
                              key={chat.id}
                              onDelete={(chatId) => {
                                setDeleteId(chatId);
                                setShowDeleteDialog(true);
                              }}
                              onRename={onRename}
                              setOpenMobile={setOpenMobile}
                            />
                          ))}
                        </SidebarMenu>
                      </div>
                    )}
                  </div>
                </ScrollArea>
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
