'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
type AppSidebarUser = { id?: string; email?: string | null };
import { CheckSquare, Plus } from 'lucide-react';
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

export function AppSidebar({ user }: { user: AppSidebarUser | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();

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
                Chatbot
              </span>
            </Link>
            <div className="flex items-center gap-1">
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
                    className="h-8 p-1 md:h-fit md:p-2"
                    data-testid="sidebar-new-chat-button"
                    onClick={() => {
                      setOpenMobile(false);
                      router.push('/');
                      router.refresh();
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <Plus size={16} />
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
          user={user}
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
      <SidebarFooter>{user && <SidebarUserNav user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
