import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { handleChatActionFailure } from '@/lib/chat/chat-resync';
import type { Chat } from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  CheckCircle,
  CheckSquare,
  Globe,
  Lock,
  MoreHorizontal,
  PenLine,
  Share,
  Square,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import {
  memo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { toast } from 'sonner';
import { ChatRenameDialog } from './chat-rename-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';

export type ChatItemSelectionProps = {
  isSelectionMode: boolean;
  isSelected: boolean;
  onToggle: (chatId: string) => void;
  onRangeToggle?: (chatId: string) => void;
  onPressStart?: (chatId: string, onInitiated?: () => void) => void;
  onPressEnd?: () => void;
  onTouchStart?: (
    chatId: string,
    event: ReactTouchEvent<HTMLAnchorElement>,
    onInitiated?: () => void
  ) => void;
  onTouchMove?: (event: ReactTouchEvent<HTMLAnchorElement>) => boolean;
  onTouchEnd?: () => boolean;
};

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  onRename,
  setOpenMobile,
  selection,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
  setOpenMobile: (open: boolean) => void;
  selection?: ChatItemSelectionProps;
}) => {
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat.id,
    initialVisibilityType: chat.visibility,
  });
  const longPressActivatedRef = useRef(false);
  const [isRenameDialogOpen, setRenameDialogOpen] = useState(false);
  const isSelectionMode = selection?.isSelectionMode ?? false;
  const isSelected = selection?.isSelected ?? false;

  const handleRename = async (newTitle: string) => {
    try {
      const response = await fetch(`/api/chat/${chat.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: newTitle }),
      });

      if (!response.ok) {
        await handleChatActionFailure({
          chatId: chat.id,
          action: 'rename',
          response,
        });
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || 'Failed to rename chat';
        toast.error(errorMessage);
        return;
      }

      onRename(chat.id, newTitle);
    } catch (error) {
      console.error('Failed to rename chat', error);
      await handleChatActionFailure({
        chatId: chat.id,
        action: 'rename',
        error,
      });
      toast.error('Failed to rename chat. Please try again.');
    }
  };

  const handleNavigate = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (longPressActivatedRef.current) {
      event.preventDefault();
      longPressActivatedRef.current = false;
      return;
    }

    if (isSelectionMode) {
      event.preventDefault();
      if (event.shiftKey && selection?.onRangeToggle) {
        selection.onRangeToggle(chat.id);
      } else {
        selection?.onToggle(chat.id);
      }
      return;
    }

    setOpenMobile(false);
  };

  const handlePressStart = () => {
    if (!selection?.onPressStart || isSelectionMode) return;
    selection.onPressStart(chat.id, () => {
      longPressActivatedRef.current = true;
    });
  };

  const handlePressEnd = () => {
    if (selection?.onPressEnd) {
      selection.onPressEnd();
    }
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLAnchorElement>) => {
    if (!selection?.onTouchStart || isSelectionMode) return;
    selection.onTouchStart(chat.id, event, () => {
      longPressActivatedRef.current = true;
    });
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLAnchorElement>) => {
    if (!selection?.onTouchMove || isSelectionMode) return;
    const canceled = selection.onTouchMove(event);
    if (canceled) {
      longPressActivatedRef.current = false;
    }
  };

  const handleTouchEnd = () => {
    if (!selection?.onTouchEnd) {
      handlePressEnd();
      return;
    }
    const canceled = selection.onTouchEnd();
    if (canceled) {
      longPressActivatedRef.current = false;
    }
  };

  const linkClassName = cn(
    'flex min-w-0 flex-1 items-center gap-2',
    isSelectionMode && 'pr-1'
  );

  return (
    <>
      <SidebarMenuItem
        data-chat-id={chat.id}
        data-selected={isSelected && isSelectionMode}
        data-testid="sidebar-history-item"
      >
        <SidebarMenuButton
          asChild
          isActive={isSelectionMode ? isSelected : isActive}
          className={cn(
            'group/item flex-1 overflow-hidden',
            isSelectionMode && 'pr-2'
          )}
        >
          <Link
            href={`/chat/${chat.id}`}
            onClick={handleNavigate}
            onMouseDown={handlePressStart}
            onMouseUp={handlePressEnd}
            onMouseLeave={handlePressEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            className={linkClassName}
          >
            {isSelectionMode && (
              <motion.span
                className="flex h-4 w-4 items-center justify-center"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
              >
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
              </motion.span>
            )}
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {chat.title}
            </span>
          </Link>
        </SidebarMenuButton>

        {!isSelectionMode && (
          <DropdownMenu modal={true}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                className="mr-0.5 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                showOnHover={!isActive}
              >
                <MoreHorizontal />
                <span className="sr-only">More</span>
              </SidebarMenuAction>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => setRenameDialogOpen(true)}
              >
                <PenLine />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="cursor-pointer">
                  <Share />
                  <span>Share</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem
                      className="cursor-pointer flex-row justify-between"
                      onClick={() => {
                        setVisibilityType('private');
                      }}
                    >
                      <div className="flex flex-row items-center gap-2">
                        <Lock size={12} />
                        <span>Private</span>
                      </div>
                      {visibilityType === 'private' ? <CheckCircle /> : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer flex-row justify-between"
                      onClick={() => {
                        setVisibilityType('public');
                      }}
                    >
                      <div className="flex flex-row items-center gap-2">
                        <Globe />
                        <span>Public</span>
                      </div>
                      {visibilityType === 'public' ? <CheckCircle /> : null}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
                onSelect={() => onDelete(chat.id)}
              >
                <Trash2 />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarMenuItem>
      <ChatRenameDialog
        open={isRenameDialogOpen}
        chat={chat}
        onClose={() => setRenameDialogOpen(false)}
        onRename={handleRename}
      />
    </>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  if (prevProps.selection?.isSelected !== nextProps.selection?.isSelected) {
    return false;
  }
  if (
    prevProps.selection?.isSelectionMode !==
    nextProps.selection?.isSelectionMode
  ) {
    return false;
  }
  if (prevProps.chat.title !== nextProps.chat.title) {
    return false;
  }
  return true;
});
