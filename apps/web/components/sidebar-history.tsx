'use client';

import { isToday, isYesterday, subMonths, subWeeks } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { useParams, useRouter } from 'next/navigation';
import type { SessionUser } from '@/lib/auth/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { toast } from 'sonner';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import type { Chat } from '@/lib/db/schema';
// fetcher retained in utils for other components; not needed here
import { CheckSquare, Loader, Loader2, Trash2 } from 'lucide-react';
import { ChatItem } from './sidebar-history-item';
import { ChatSearch } from './chat-search';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import type { ChatHistory } from '@/types/chat-history';
import { deserializeChat } from '@/lib/chat/serialization';
import { cn } from '@/lib/utils';

type GroupedChats = {
  today: Chat[];
  yesterday: Chat[];
  lastWeek: Chat[];
  lastMonth: Chat[];
  older: Chat[];
};

type SelectionProps = {
  isSelectionMode: boolean;
  selectedSet: ReadonlySet<string>;
  selectedIds: string[];
  selectedCount: number;
  isSelected: (id: string) => boolean;
  clearSelectionMode: () => void;
  toggleSelection: (id: string) => void;
  setSelection: (ids: Iterable<string>) => void;
  selectAll: (ids: Iterable<string>) => void;
  toggleSelectionRange: (id: string, orderedIds: readonly string[]) => void;
  handlePressStart: (id: string, onInitiated?: () => void) => void;
  handlePressEnd: () => void;
  handleTouchStart: (
    id: string,
    event: ReactTouchEvent<HTMLElement>,
    onInitiated?: () => void
  ) => void;
  handleTouchMove: (event: ReactTouchEvent<HTMLElement>) => boolean;
  handleTouchEnd: () => boolean;
};

const PAGE_SIZE = 20;

const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      const chatDate = new Date(chat.createdAt);

      if (isToday(chatDate)) {
        groups.today.push(chat);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    } as GroupedChats
  );
};

// React Query version of pagination logic
function buildPageUrl(cursor: string | undefined) {
  if (!cursor) return `/api/history?limit=${PAGE_SIZE}`;
  return `/api/history?ending_before=${cursor}&limit=${PAGE_SIZE}`;
}

export function SidebarHistory({
  user,
  selection,
  sessionStatus,
}: {
  user: SessionUser | undefined;
  selection: SelectionProps;
  sessionStatus: 'loading' | 'authenticated' | 'unauthenticated';
}) {
  const { setOpenMobile } = useSidebar();
  const { id } = useParams();
  const currentChatId = Array.isArray(id) ? id[0] : (id as string | undefined);

  const queryClient = useQueryClient();
  const {
    refreshCache,
    cachedChats,
    metadata: cacheMetadata,
    ready: isCacheReady,
  } = useEncryptedCache();
  const hasHydratedFromCacheRef = useRef(false);
  const cachedChatEntities = useMemo(
    () => cachedChats.map((entry) => deserializeChat(entry.data.chat)),
    [cachedChats]
  );

  // Use infinite query for pagination (but without cache for subsequent pages to avoid complexity)
  const {
    data: paginatedChatHistories,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
    refetch,
  } = useInfiniteQuery<ChatHistory>({
    queryKey: ['chat', 'history'],
    queryFn: async ({ pageParam }) => {
      const url = buildPageUrl(pageParam as string | undefined);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch chat history');
      return (await res.json()) as ChatHistory;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) return undefined;
      const lastChat = lastPage.chats.at(-1);
      return lastChat?.id;
    },
    staleTime: 20 * 60_000, // 20 minutes - aligned with polling interval
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Use infinite query data for all operations (it includes cache verification for first page)
  const dataToUse = paginatedChatHistories;

  const router = useRouter();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const {
    isSelectionMode,
    selectedSet,
    selectedIds,
    selectedCount,
    clearSelectionMode,
    toggleSelection,
    toggleSelectionRange,
    selectAll,
    setSelection,
    handlePressStart,
    handlePressEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = selection;
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const pages = paginatedChatHistories?.pages || [];
  const hasReachedEnd =
    pages.length > 0 ? pages.some((p) => p.hasMore === false) : false;

  const hasEmptyChatHistory =
    pages.length > 0 ? pages.every((p) => p.chats.length === 0) : false;

  useEffect(() => {
    if (!isCacheReady) {
      hasHydratedFromCacheRef.current = false;
      return;
    }
    if (hasHydratedFromCacheRef.current) return;
    if (!cachedChatEntities.length) return;

    const existing = queryClient.getQueryData<InfiniteData<ChatHistory>>([
      'chat',
      'history',
    ]);

    const cachedChatList = cachedChatEntities;

    if (!existing || existing.pages.every((page) => page.chats.length === 0)) {
      const hasMore =
        cacheMetadata?.cacheCompletionMarker.hasOlderChats ?? false;
      queryClient.setQueryData<InfiniteData<ChatHistory>>(['chat', 'history'], {
        pageParams: [undefined],
        pages: [
          {
            chats: cachedChatList,
            hasMore,
          },
        ],
      });
    }

    hasHydratedFromCacheRef.current = true;
  }, [cachedChatEntities, cacheMetadata, isCacheReady, queryClient]);

  // Set up periodic refresh for sidebar history
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      refetch().catch(() => {
        // Errors are handled by React Query
      });
    }, 20 * 60_000); // Refresh every 20 minutes

    return () => clearInterval(interval);
  }, [user, refetch]);

  const allChats = useMemo(
    () => dataToUse?.pages.flatMap((page) => page.chats) ?? [],
    [dataToUse]
  );
  const allChatIds = useMemo(() => allChats.map((chat) => chat.id), [allChats]);

  const handleToggleSelection = useCallback(
    (chatId: string) => {
      toggleSelection(chatId);
    },
    [toggleSelection]
  );

  const handleRangeSelection = useCallback(
    (chatId: string) => {
      if (allChatIds.length === 0) {
        toggleSelection(chatId);
        return;
      }
      toggleSelectionRange(chatId, allChatIds);
    },
    [allChatIds, toggleSelection, toggleSelectionRange]
  );

  const handleSelectAllChats = useCallback(() => {
    if (allChatIds.length === 0) return;
    selectAll(allChatIds);
  }, [allChatIds, selectAll]);

  const handleDelete = () => {
    if (!deleteId) return;

    const deletePromise = fetch(`/api/chat?id=${deleteId}`, {
      method: 'DELETE',
    }).then((response) => {
      if (!response.ok) {
        throw new Error('Failed to delete chat');
      }
      return response.json();
    });

    toast.promise(deletePromise, {
      loading: 'Deleting chat...',
      success: () => {
        queryClient.setQueryData<InfiniteData<ChatHistory>>(
          ['chat', 'history'],
          (current) => {
            if (!current) return current;
            return {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                chats: page.chats.filter((c) => c.id !== deleteId),
              })),
            };
          }
        );

        queryClient.invalidateQueries({ queryKey: ['chat', 'search'] });

        if (selectedSet.has(deleteId)) {
          const remainingIds = Array.from(selectedSet).filter(
            (chatId) => chatId !== deleteId
          );
          if (remainingIds.length === 0) {
            clearSelectionMode();
          } else {
            setSelection(remainingIds);
          }
        }

        return 'Chat deleted successfully';
      },
      error: 'Failed to delete chat',
    });

    setShowDeleteDialog(false);
    setDeleteId(null);

    if (deleteId === id) {
      router.push('/');
    }
  };

  const handleConfirmBulkDelete = useCallback(() => {
    if (selectedIds.length === 0) return;

    const idsToDelete = [...selectedIds];
    const idsSet = new Set(idsToDelete);

    setIsBulkDeleting(true);

    const deletePromise = (async () => {
      const response = await fetch('/api/chat/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: idsToDelete }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete chats');
      }

      await response.json();

      queryClient.setQueryData<InfiniteData<ChatHistory>>(
        ['chat', 'history'],
        (current) => {
          if (!current) return current;
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              chats: page.chats.filter((chat) => !idsSet.has(chat.id)),
            })),
          };
        }
      );

      queryClient.invalidateQueries({ queryKey: ['chat', 'search'] });

      if (currentChatId && idsSet.has(currentChatId)) {
        router.push('/');
      }

      clearSelectionMode();
    })();

    toast.promise(deletePromise, {
      loading: 'Deleting chats...',
      success: () => {
        return `Deleted ${idsToDelete.length} chat${
          idsToDelete.length === 1 ? '' : 's'
        }`;
      },
      error: 'Failed to delete chats',
    });

    deletePromise.finally(() => {
      setIsBulkDeleting(false);
    });
  }, [selectedIds, queryClient, currentChatId, router, clearSelectionMode]);

  const handleRename = (chatId: string, newTitle: string) => {
    queryClient.setQueryData<InfiniteData<ChatHistory>>(
      ['chat', 'history'],
      (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            chats: page.chats.map((c) =>
              c.id === chatId ? { ...c, title: newTitle } : c
            ),
          })),
        };
      }
    );
  };

  if (sessionStatus === 'loading') {
    return (
      <SidebarGroup>
        <SidebarGroupContent data-testid="sidebar-history-scroll-container">
          <div
            className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500"
            data-testid="sidebar-loading-prompt"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat history...
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (!user) {
    return (
      <SidebarGroup>
        <SidebarGroupContent data-testid="sidebar-history-scroll-container">
          <div
            className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500"
            data-testid="sidebar-login-prompt"
          >
            Sign in to save your chats and access them from any device.
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (isLoading) {
    return (
      <SidebarGroup>
        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
          Today
        </div>
        <SidebarGroupContent>
          <div className="flex flex-col">
            {[44, 32, 28, 64, 52].map((item) => (
              <div
                className="flex h-8 items-center gap-2 rounded-md px-2"
                key={item}
              >
                <div
                  className="h-4 max-w-(--skeleton-width) flex-1 rounded-md bg-sidebar-accent-foreground/10"
                  style={
                    {
                      '--skeleton-width': `${item}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
            ))}
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  if (hasEmptyChatHistory) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <div className="flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
            Your conversations will appear here once you start chatting!
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      <ChatSearch
        currentChatId={id as string | undefined}
        onDelete={(chatId) => {
          setDeleteId(chatId);
          setShowDeleteDialog(true);
        }}
        onRename={handleRename}
      />

      <SidebarGroup>
        <SidebarGroupContent>
          {allChatIds.length > 0 && (
            <AnimatePresence initial={false} mode="popLayout">
              {isSelectionMode && (
                <AlertDialog key="selection-active">
                  <motion.div
                    className="mb-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckSquare className="h-4 w-4 text-primary" />
                          <span>
                            {selectedCount > 0
                              ? `${selectedCount} selected`
                              : 'Select conversations'}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          Tap conversations to toggle selection
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleSelectAllChats}
                            disabled={isBulkDeleting}
                            className="flex-1"
                          >
                            Select all
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={clearSelectionMode}
                            disabled={isBulkDeleting}
                            className="flex-1"
                          >
                            Cancel
                          </Button>
                        </div>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={selectedCount === 0 || isBulkDeleting}
                            className="w-full"
                          >
                            {isBulkDeleting ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                            )}
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                      </div>
                    </div>
                  </motion.div>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete conversations</AlertDialogTitle>
                      <AlertDialogDescription>
                        This action cannot be undone. Are you sure you want to
                        delete {selectedCount} conversation
                        {selectedCount === 1 ? '' : 's'}?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isBulkDeleting}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleConfirmBulkDelete}
                        disabled={isBulkDeleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {isBulkDeleting ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </AnimatePresence>
          )}

          <SidebarMenu>
            {pages &&
              (() => {
                const chatsFromHistory = allChats;

                const groupedChats = groupChatsByDate(chatsFromHistory);

                return (
                  <div className="flex flex-col gap-6">
                    {groupedChats.today.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Today
                        </div>
                        {groupedChats.today.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            onRename={handleRename}
                            setOpenMobile={setOpenMobile}
                            selection={{
                              isSelectionMode,
                              isSelected: selectedSet.has(chat.id),
                              onToggle: handleToggleSelection,
                              onRangeToggle: handleRangeSelection,
                              onPressStart: handlePressStart,
                              onPressEnd: handlePressEnd,
                              onTouchStart: handleTouchStart,
                              onTouchMove: handleTouchMove,
                              onTouchEnd: handleTouchEnd,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.yesterday.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Yesterday
                        </div>
                        {groupedChats.yesterday.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            onRename={handleRename}
                            setOpenMobile={setOpenMobile}
                            selection={{
                              isSelectionMode,
                              isSelected: selectedSet.has(chat.id),
                              onToggle: handleToggleSelection,
                              onRangeToggle: handleRangeSelection,
                              onPressStart: handlePressStart,
                              onPressEnd: handlePressEnd,
                              onTouchStart: handleTouchStart,
                              onTouchMove: handleTouchMove,
                              onTouchEnd: handleTouchEnd,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastWeek.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 7 days
                        </div>
                        {groupedChats.lastWeek.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            onRename={handleRename}
                            setOpenMobile={setOpenMobile}
                            selection={{
                              isSelectionMode,
                              isSelected: selectedSet.has(chat.id),
                              onToggle: handleToggleSelection,
                              onRangeToggle: handleRangeSelection,
                              onPressStart: handlePressStart,
                              onPressEnd: handlePressEnd,
                              onTouchStart: handleTouchStart,
                              onTouchMove: handleTouchMove,
                              onTouchEnd: handleTouchEnd,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.lastMonth.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 30 days
                        </div>
                        {groupedChats.lastMonth.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            onRename={handleRename}
                            setOpenMobile={setOpenMobile}
                            selection={{
                              isSelectionMode,
                              isSelected: selectedSet.has(chat.id),
                              onToggle: handleToggleSelection,
                              onRangeToggle: handleRangeSelection,
                              onPressStart: handlePressStart,
                              onPressEnd: handlePressEnd,
                              onTouchStart: handleTouchStart,
                              onTouchMove: handleTouchMove,
                              onTouchEnd: handleTouchEnd,
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {groupedChats.older.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Older than last month
                        </div>
                        {groupedChats.older.map((chat) => (
                          <ChatItem
                            chat={chat}
                            isActive={chat.id === id}
                            key={chat.id}
                            onDelete={(chatId) => {
                              setDeleteId(chatId);
                              setShowDeleteDialog(true);
                            }}
                            onRename={handleRename}
                            setOpenMobile={setOpenMobile}
                            selection={{
                              isSelectionMode,
                              isSelected: selectedSet.has(chat.id),
                              onToggle: handleToggleSelection,
                              onRangeToggle: handleRangeSelection,
                              onPressStart: handlePressStart,
                              onPressEnd: handlePressEnd,
                              onTouchStart: handleTouchStart,
                              onTouchMove: handleTouchMove,
                              onTouchEnd: handleTouchEnd,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
          </SidebarMenu>

          <motion.div
            className="h-px w-full"
            data-testid="sidebar-history-scroll-sentinel"
            onViewportEnter={() => {
              if (!isFetchingNextPage && !hasReachedEnd) {
                fetchNextPage();
              }
            }}
          />

          {hasReachedEnd ? (
            <div className="mt-8 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
              You have reached the end of your chat history.
            </div>
          ) : (
            <div className="mt-8 flex flex-row items-center gap-2 p-2 text-zinc-500 dark:text-zinc-400">
              <div className="animate-spin">
                <Loader />
              </div>
              <div>
                {isFetchingNextPage || isFetching
                  ? 'Loading Chats...'
                  : 'Load more'}
              </div>
            </div>
          )}
        </SidebarGroupContent>
      </SidebarGroup>

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
