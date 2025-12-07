import { memo, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useCopyToClipboard } from 'usehooks-ts';
import type { ChatMessage } from '@/lib/types';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  Copy,
  GitBranchPlus,
  Pencil,
  RotateCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Menu,
  CheckSquare,
  Square,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getTextFromMessage } from '@/lib/utils';

const DELETE_MESSAGE_OPTIONS: Array<{
  mode: MessageDeletionMode;
  label: string;
  description: string;
  variant: 'secondary' | 'destructive';
}> = [
    {
      mode: 'version',
      label: 'Delete version & branch',
      description:
        'Remove this version along with any messages in its branch.',
      variant: 'secondary',
    },
    {
      mode: 'message-only',
      label: 'Delete message (keep following)',
      description:
        'Keep downstream messages by reconnecting remaining content to the previous step.',
      variant: 'secondary',
    },
    {
      mode: 'message-with-following',
      label: 'Delete message & following',
      description:
        'Remove this message plus all alternate versions and later messages.',
      variant: 'destructive',
    },
  ];

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  setMode,
  onRegenerate,
  disableRegenerate,
  modelBadge,
  onDelete,
  onToggleSelect,
  isSelected,
  isSelectionMode,
  onFork,
  siblingIndex,
  siblingsCount,
  onNavigate,
  isExpanded,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  setMode?: (mode: 'view' | 'edit') => void;
  onRegenerate?: (assistantMessageId: string) => void;
  disableRegenerate?: boolean;
  modelBadge?: React.ReactNode;
  onDelete?: (
    messageId: string,
    mode: MessageDeletionMode
  ) => Promise<{ chatDeleted: boolean }>;
  onToggleSelect?: (messageId: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onFork?: (messageId: string) => void;
  siblingIndex?: number;
  siblingsCount?: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
  isExpanded?: boolean;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [_, copyToClipboard] = useCopyToClipboard();

  const handleDeleteConfirm = useCallback(
    async (mode: MessageDeletionMode) => {
      if (!onDelete) return;
      setIsDeleting(true);
      try {
        await onDelete(message.id, mode);
        setShowDeleteDialog(false);
      } catch (_error) {
        // Errors are surfaced via toast notifications
      } finally {
        setIsDeleting(false);
      }
    },
    [message.id, onDelete]
  );

  const handleDialogOpenChange = useCallback(
    (open: boolean) => {
      if (isDeleting) return;
      setShowDeleteDialog(open);
    },
    [isDeleting]
  );

  const handleCopy = () => {
    const text = getTextFromMessage(message);
    copyToClipboard(text);
    toast.success('Copied to clipboard');
  };

  const hasSiblings = siblingsCount !== undefined && siblingsCount > 1;
  const activeIndex = siblingIndex ?? 0;
  const totalVersions = siblingsCount ?? 1;

  if (isLoading) {
    return null;
  }

  return (
    <motion.div
      className="flex flex-row justify-between items-center bg-muted/30 border-t border-border/50 px-2 py-1.5 select-none"
      layout
    >
      <div className="flex items-center gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {isSelectionMode && !isExpanded && onToggleSelect && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, width: 0 }}
              animate={{ opacity: 1, scale: 1, width: 'auto' }}
              exit={{ opacity: 0, scale: 0.8, width: 0 }}
              className="mr-1"
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onToggleSelect(message.id)}
              >
                {isSelected ? (
                  <CheckSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {hasSiblings && (
          <div className="flex items-center bg-background border border-border/60 rounded-xl shadow-sm h-7">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-l-xl rounded-r-none hover:bg-muted"
              onClick={() => onNavigate?.('prev')}
              disabled={activeIndex === 0}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span className="sr-only">View previous version</span>
            </Button>
            <span className="text-[10px] font-medium text-muted-foreground px-2 min-w-[3ch] text-center">
              {activeIndex + 1}/{totalVersions}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-r-xl rounded-l-none hover:bg-muted"
              onClick={() => onNavigate?.('next')}
              disabled={activeIndex === totalVersions - 1}
            >
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="sr-only">View next version</span>
            </Button>
          </div>
        )}
        {modelBadge}
      </div>

      <div className="flex items-center gap-1">
        {message.role === 'assistant' && onRegenerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => onRegenerate(message.id)}
                disabled={disableRegenerate}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="sr-only">Regenerate</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate</TooltipContent>
          </Tooltip>
        )}

        {message.role === 'user' && setMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setMode('edit')}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Edit</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleCopy}
            >
              <Copy className="h-3.5 w-3.5" />
              <span className="sr-only">Copy</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy</TooltipContent>
        </Tooltip>

        <AnimatePresence mode="popLayout" initial={false}>
          {isExpanded ? (
            <motion.div
              key="expanded-actions"
              initial={{ opacity: 0, x: -20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 'auto' }}
              exit={{ opacity: 0, x: -20, width: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="flex items-center gap-1 overflow-hidden"
            >
              {onToggleSelect && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => onToggleSelect(message.id)}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-3.5 w-3.5" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                      <span className="sr-only">Select</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Select</TooltipContent>
                </Tooltip>
              )}

              {onFork && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => onFork(message.id)}
                    >
                      <GitBranchPlus className="h-3.5 w-3.5" />
                      <span className="sr-only">Fork</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Fork</TooltipContent>
                </Tooltip>
              )}

              {onDelete && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="collapsed-actions"
              initial={{ opacity: 0, x: 20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 'auto' }}
              exit={{ opacity: 0, x: 20, width: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                  >
                    <Menu className="h-3.5 w-3.5" />
                    <span className="sr-only">More actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onToggleSelect && (
                    <DropdownMenuItem
                      onClick={() => onToggleSelect(message.id)}
                    >
                      {isSelected ? (
                        <CheckSquare className="mr-2 h-4 w-4" />
                      ) : (
                        <Square className="mr-2 h-4 w-4" />
                      )}
                      <span>Select</span>
                    </DropdownMenuItem>
                  )}
                  {onFork && (
                    <DropdownMenuItem onClick={() => onFork(message.id)}>
                      <GitBranchPlus className="mr-2 h-4 w-4" />
                      <span>Fork</span>
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={handleDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how deletion should treat alternate versions and downstream
              messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-3 flex flex-col gap-3">
            {DELETE_MESSAGE_OPTIONS.map((option) => (
              <AlertDialogAction
                key={option.mode}
                className={cn(
                  buttonVariants({ variant: option.variant }),
                  'flex h-auto w-full flex-col items-start justify-start gap-1 rounded-xl border px-4 py-3 text-left text-sm leading-relaxed whitespace-normal wrap-break-word transition-colors',
                  option.variant === 'secondary'
                    ? 'border-border/60 bg-muted/40 hover:bg-muted/60 dark:bg-muted/20 dark:hover:bg-muted/40'
                    : 'border-destructive/50 bg-destructive/90 text-destructive-foreground hover:bg-destructive'
                )}
                disabled={isDeleting}
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteConfirm(option.mode);
                }}
              >
                <span className="font-medium leading-tight">
                  {option.label}
                </span>
                <span
                  className={cn(
                    'text-xs leading-snug',
                    option.variant === 'destructive'
                      ? 'text-destructive-foreground/90'
                      : 'text-muted-foreground'
                  )}
                >
                  {option.description}
                </span>
              </AlertDialogAction>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.onDelete !== nextProps.onDelete) return false;
    if (prevProps.onToggleSelect !== nextProps.onToggleSelect) return false;
    if (prevProps.disableRegenerate !== nextProps.disableRegenerate)
      return false;
    if (prevProps.isSelected !== nextProps.isSelected) return false;
    if (prevProps.isSelectionMode !== nextProps.isSelectionMode) return false;
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    if (prevProps.onFork !== nextProps.onFork) return false;
    if (prevProps.siblingIndex !== nextProps.siblingIndex) return false;
    if (prevProps.siblingsCount !== nextProps.siblingsCount) return false;
    if (prevProps.onNavigate !== nextProps.onNavigate) return false;
    if (prevProps.modelBadge !== nextProps.modelBadge) return false;
    if (prevProps.isExpanded !== nextProps.isExpanded) return false;

    return true;
  }
);
