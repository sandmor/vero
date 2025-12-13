'use client';

import Link from 'next/link';
import { CheckSquare, Plus, BookSearch } from 'lucide-react';
import { SidebarHistory } from '@/components/sidebar-history';
import { SidebarUserNav } from '@/components/sidebar-user-nav';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useMultiSelection } from '@/hooks/use-multi-selection';
import { useAppSession } from '@/hooks/use-app-session';
import { useNewChatNavigation } from '@/hooks/use-new-chat-navigation';
import { useSearchStore } from '@/lib/stores/search-store';

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();
  const { data, isLoading, isError, status: queryStatus } = useAppSession();
  const { startNewChat, isNavigating } = useNewChatNavigation();
  const { setModalOpen } = useSearchStore();

  let sessionStatus: 'loading' | 'authenticated' | 'unauthenticated';
  if (queryStatus === 'pending') {
    sessionStatus = 'loading';
  } else if (queryStatus === 'success' && data?.session?.user) {
    sessionStatus = 'authenticated';
  } else {
    sessionStatus = 'unauthenticated';
  }

  const sessionUser = !isError ? data?.session?.user : undefined;

  const {
    isSelectionMode,
    selectedSet,
    selectedIds,
    selectedCount,
    isSelected,
    startSelectionMode,
    stopSelectionMode: clearSelectionMode,
    toggleSelection,
    toggleSelectionRange,
    selectAll,
    setSelection,
    handlePressStart,
    handlePressEnd,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useMultiSelection<string>();

  return (
    <Sidebar className="group-data-[side=left]:border-r-0">
      <SidebarHeader>
        <SidebarMenu>
          <div className="flex flex-row items-center justify-between">
            <Link
              className="flex flex-row items-center gap-3"
              href="/"
              onClick={() => {
                setOpenMobile(false);
              }}
            >
              <span className="cursor-pointer rounded-md px-2 font-semibold text-lg hover:bg-muted">
                Virid Chat
              </span>
            </Link>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setModalOpen(true)}
                  >
                    <BookSearch size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search conversations (Cmd+K)</TooltipContent>
              </Tooltip>
              {!isSelectionMode && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-8 p-1 md:h-fit md:p-2"
                      data-testid="sidebar-select-mode-button"
                      onClick={startSelectionMode}
                      type="button"
                      variant="ghost"
                    >
                      <CheckSquare size={16} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent align="end" className="hidden md:block">
                    Select Chats
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-busy={isNavigating || undefined}
                    className={`h-8 transform p-1 transition-transform duration-150 md:h-fit md:p-2 ${isNavigating ? 'scale-95' : ''}`}
                    data-testid="sidebar-new-chat-button"
                    disabled={isNavigating}
                    onClick={() => {
                      if (isNavigating) return;
                      setOpenMobile(false);
                      startNewChat();
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <Plus
                      size={16}
                      className={`transition-transform duration-200 ${isNavigating ? 'scale-90 opacity-80' : ''}`}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" className="hidden md:block">
                  New Chat
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarHistory
          user={sessionUser}
          sessionStatus={sessionStatus}
          selection={{
            isSelectionMode,
            selectedSet,
            selectedIds,
            selectedCount,
            isSelected,
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
          }}
        />
      </SidebarContent>
      <SidebarFooter>
        <SidebarUserNav isLoading={isLoading} user={sessionUser} />
      </SidebarFooter>
    </Sidebar>
  );
}
