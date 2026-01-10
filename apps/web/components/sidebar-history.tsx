'use client';

import { useEncryptedCache } from '@/components/encrypted-cache-provider';
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
import type { SessionUser } from '@/lib/auth/types';
import { getEncryptedCacheManager } from '@/lib/cache/cache-manager';
import { getSyncManager } from '@/lib/cache/sync-manager';
import { handleChatActionFailure } from '@/lib/chat/chat-resync';
import { deserializeChat } from '@/lib/chat/serialization';
import type { Chat } from '@/lib/db/schema';
import { useQueryClient } from '@tanstack/react-query';
import { isToday, isYesterday, subMonths, subWeeks } from 'date-fns';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { CheckSquare, Loader2, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChatSearch } from './chat-search';
import { ChatItem } from './sidebar-history-item';

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

const PAGE_SIZE = 50;

/**
 * Group chats by their updatedAt date into time-based buckets.
 * Chats are grouped based on when they were last updated, making recently
 * active conversations appear in the appropriate recent group.
 */
const groupChatsByDate = (chats: Chat[]): GroupedChats => {
  const now = new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);

  return chats.reduce(
    (groups, chat) => {
      // Use updatedAt for grouping - this determines which time bucket the chat appears in
      const chatDate = new Date(chat.updatedAt);

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
    cachedChats,
    metadata: cacheMetadata,
    ready: isCacheReady,
    refreshCache,
    updateChatTitle,
    removeOptimisticChat,
    bumpChatToTop,
    subscribeToMessageUpdates,
  } = useEncryptedCache();

  // Subscribe to cross-tab message updates to bump chats to top
  useEffect(() => {
    const unsubscribe = subscribeToMessageUpdates((chatId) => {
      // When another tab updates a chat, bump it to the top in this tab too
      bumpChatToTop(chatId);
    });
    return unsubscribe;
  }, [subscribeToMessageUpdates, bumpChatToTop]);

  // Derive chat list directly from cache (includes optimistic state)
  const allChats = useMemo(() => {
    const chats = cachedChats.map((entry) => deserializeChat(entry.data.chat));
    // Sort by updatedAt descending (most recently updated first)
    return chats.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [cachedChats]);

  // Local pagination for progressive rendering
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const visibleChats = useMemo(
    () => allChats.slice(0, visibleCount),
    [allChats, visibleCount]
  );
  const hasMoreToShow = visibleCount < allChats.length;
  const hasOlderOnServer =
    cacheMetadata?.cacheCompletionMarker.hasOlderChats ?? false;

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

  const handleDelete = useCallback(() => {
    if (!deleteId) return;

    const chatIdToDelete = deleteId;

    const deletePromise = (async () => {
      try {
        const response = await fetch(`/api/chat?id=${chatIdToDelete}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          await handleChatActionFailure({
            chatId: chatIdToDelete,
            action: 'delete',
            response,
          });
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

        if (selectedSet.has(chatIdToDelete)) {
          const remainingIds = Array.from(selectedSet).filter(
            (chatId) => chatId !== chatIdToDelete
          );
          if (remainingIds.length === 0) {
            clearSelectionMode();
          } else {
            setSelection(remainingIds);
          }
        }
      } catch (error) {
        await handleChatActionFailure({
          chatId: chatIdToDelete,
          action: 'delete',
          error,
        });
        throw error;
      }
    })();

    toast.promise(deletePromise, {
      loading: 'Deleting chat...',
      success: 'Chat deleted successfully',
      error: 'Failed to delete chat',
    });

    setShowDeleteDialog(false);
    setDeleteId(null);

    if (chatIdToDelete === id) {
      router.push('/chat');
    }
  }, [
    deleteId,
    id,
    queryClient,
    refreshCache,
    removeOptimisticChat,
    selectedSet,
    setSelection,
    clearSelectionMode,
    router,
  ]);

  const handleConfirmBulkDelete = useCallback(() => {
    if (selectedIds.length === 0) return;

    const idsToDelete = [...selectedIds];
    const idsSet = new Set(idsToDelete);

    setIsBulkDeleting(true);

    const deletePromise = (async () => {
      try {
        const response = await fetch('/api/chat/bulk-delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: idsToDelete }),
        });

        if (!response.ok) {
          await handleChatActionFailure({
            chatId: idsToDelete[0] ?? '',
            action: 'bulk-delete',
            response,
          });
          throw new Error('Failed to delete chats');
        }

        await response.json();

        // Remove from local cache and add to optimistic deleted set
        const cacheManager = getEncryptedCacheManager();
        for (const chatId of idsToDelete) {
          await cacheManager.removeChat(chatId);
          removeOptimisticChat(chatId);
        }

        queryClient.invalidateQueries({ queryKey: ['chat', 'search'] });

        // Trigger cache refresh to update state
        await refreshCache({ force: true });

        if (currentChatId && idsSet.has(currentChatId)) {
          router.push('/chat');
        }

        clearSelectionMode();
      } catch (error) {
        if (idsToDelete[0]) {
          await handleChatActionFailure({
            chatId: idsToDelete[0],
            action: 'bulk-delete',
            error,
          });
        }
        throw error;
      }
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
  }, [
    selectedIds,
    queryClient,
    currentChatId,
    router,
    clearSelectionMode,
    refreshCache,
    removeOptimisticChat,
  ]);

  const handleRename = useCallback(
    (chatId: string, newTitle: string) => {
      // Update optimistic state for immediate UI feedback
      updateChatTitle(chatId, newTitle);
      // Bump the chat to top of sidebar since it was just updated
      bumpChatToTop(chatId);
      // Notify other tabs
      const syncManager = getSyncManager();
      syncManager?.notifyMessagesUpdated(chatId);
    },
    [updateChatTitle, bumpChatToTop]
  );

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  }, []);

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

  if (!isCacheReady) {
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

  if (allChats.length === 0) {
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
            <LayoutGroup>
              {(() => {
                const groupedChats = groupChatsByDate(visibleChats);

                return (
                  <div className="flex flex-col gap-6">
                    {groupedChats.today.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Today
                        </div>
                        {groupedChats.today.map((chat) => (
                          <motion.div
                            key={chat.id}
                            layout
                            layoutId={chat.id}
                            transition={{
                              layout: {
                                type: 'spring',
                                stiffness: 500,
                                damping: 35,
                              },
                            }}
                          >
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
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
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {groupedChats.yesterday.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Yesterday
                        </div>
                        {groupedChats.yesterday.map((chat) => (
                          <motion.div
                            key={chat.id}
                            layout
                            layoutId={chat.id}
                            transition={{
                              layout: {
                                type: 'spring',
                                stiffness: 500,
                                damping: 35,
                              },
                            }}
                          >
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
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
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {groupedChats.lastWeek.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 7 days
                        </div>
                        {groupedChats.lastWeek.map((chat) => (
                          <motion.div
                            key={chat.id}
                            layout
                            layoutId={chat.id}
                            transition={{
                              layout: {
                                type: 'spring',
                                stiffness: 500,
                                damping: 35,
                              },
                            }}
                          >
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
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
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {groupedChats.lastMonth.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Last 30 days
                        </div>
                        {groupedChats.lastMonth.map((chat) => (
                          <motion.div
                            key={chat.id}
                            layout
                            layoutId={chat.id}
                            transition={{
                              layout: {
                                type: 'spring',
                                stiffness: 500,
                                damping: 35,
                              },
                            }}
                          >
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
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
                          </motion.div>
                        ))}
                      </div>
                    )}

                    {groupedChats.older.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-sidebar-foreground/50 text-xs">
                          Older than last month
                        </div>
                        {groupedChats.older.map((chat) => (
                          <motion.div
                            key={chat.id}
                            layout
                            layoutId={chat.id}
                            transition={{
                              layout: {
                                type: 'spring',
                                stiffness: 500,
                                damping: 35,
                              },
                            }}
                          >
                            <ChatItem
                              chat={chat}
                              isActive={chat.id === id}
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
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </LayoutGroup>
          </SidebarMenu>

          <motion.div
            className="h-px w-full"
            data-testid="sidebar-history-scroll-sentinel"
            onViewportEnter={() => {
              if (hasMoreToShow) {
                handleLoadMore();
              }
            }}
          />

          {!hasMoreToShow && !hasOlderOnServer ? (
            <div className="mt-8 flex w-full flex-row items-center justify-center gap-2 px-2 text-sm text-zinc-500">
              You have reached the end of your chat history.
            </div>
          ) : hasMoreToShow ? (
            <div className="mt-8 flex flex-row items-center justify-center gap-2 p-2 text-zinc-500 dark:text-zinc-400">
              <Button variant="ghost" size="sm" onClick={handleLoadMore}>
                Load more ({allChats.length - visibleCount} remaining)
              </Button>
            </div>
          ) : null}
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
