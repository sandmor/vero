import { memo, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useMutation } from '@tanstack/react-query';
import { useCopyToClipboard } from 'usehooks-ts';
import type { ChatMessage } from '@/lib/types';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { cn } from '@/lib/utils';
import { Action, Actions } from './elements/actions';
import { Copy, GitBranchPlus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { ChatSDKError } from '@/lib/errors';
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
import { buttonVariants } from '@/components/ui/button';

export function PureMessageActions({
  chatId,
  message,
  isLoading,
  setMode,
  onRegenerate,
  disableRegenerate,
  modelBadge,
  siblingsBadge,
  onDelete,
  onToggleSelect,
  isSelected,
  isSelectionMode,
  onFork,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  setMode?: (mode: 'view' | 'edit') => void;
  onRegenerate?: (assistantMessageId: string) => void;
  disableRegenerate?: boolean;
  modelBadge?: React.ReactNode;
  siblingsBadge?: React.ReactNode;
  onDelete?: (
    messageId: string,
    mode: MessageDeletionMode
  ) => Promise<{ chatDeleted: boolean }>;
  onToggleSelect?: (messageId: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onFork?: (messageId: string) => void;
}) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [_, copyToClipboard] = useCopyToClipboard();

  type DeleteMode = MessageDeletionMode;

  const deleteMutation = useMutation<
    { chatDeleted: boolean },
    ChatSDKError | Error,
    { mode: DeleteMode }
  >({
    mutationFn: async ({ mode }) => {
      if (!onDelete) {
        throw new ChatSDKError('bad_request:api');
      }
      const result = await onDelete(message.id, mode);
      return result ?? { chatDeleted: false };
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast.error(error.message);
        return;
      }
      toast.error('Failed to delete message.');
    },
    onSuccess: (data, variables) => {
      let successDescription = 'Message deleted.';
      if (data?.chatDeleted) {
        successDescription = 'Chat deleted.';
      } else if (variables.mode === 'message-with-following') {
        successDescription = 'Message and following deleted.';
      } else if (variables.mode === 'message-only') {
        successDescription = 'Message deleted; following preserved.';
      } else if (variables.mode === 'version') {
        successDescription = 'Version branch deleted.';
      }
      toast.success(successDescription);
      setIsDeleteDialogOpen(false);
    },
  });

  const textFromParts = message.parts
    ?.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("There's no text to copy!");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success('Copied to clipboard!');
  };

  const handleDelete = useCallback(
    (mode: DeleteMode) => {
      deleteMutation.mutate({ mode });
    },
    [deleteMutation]
  );

  const SelectionIndicator = ({ checked }: { checked: boolean }) => (
    <span
      aria-hidden="true"
      className={cn(
        'block h-4 w-4 rounded-[4px] border transition-colors',
        checked
          ? 'border-primary bg-primary'
          : 'border-muted-foreground/40 bg-transparent'
      )}
    />
  );

  const handleDeleteDialogToggle = useCallback(
    (open: boolean) => {
      if (deleteMutation.isPending) {
        return;
      }
      setIsDeleteDialogOpen(open);
    },
    [deleteMutation.isPending]
  );

  const renderDeleteAction = () => {
    if (!onDelete) {
      return null;
    }

    const deleteOptions: Array<{
      mode: DeleteMode;
      label: string;
      description: string;
      variant: 'secondary' | 'destructive';
    }> = [
      {
        mode: 'version',
        label: 'Delete version & branch',
        description:
          'Remove this message version along with any descendants in its branch.',
        variant: 'secondary',
      },
      {
        mode: 'message-only',
        label: 'Delete message (keep following)',
        description:
          'Keep downstream messages by lifting them up to the previous step.',
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

    return (
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogToggle}
      >
        <AlertDialogTrigger asChild>
          <Action
            disabled={deleteMutation.isPending}
            tooltip={deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          >
            <Trash2 size={16} />
          </Action>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how this deletion should affect alternate versions and
              downstream messages in the current branch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-2 flex flex-col gap-3">
            {deleteOptions.map((option) => (
              <AlertDialogAction
                key={option.mode}
                className={cn(
                  buttonVariants({ variant: option.variant }),
                  'flex h-auto w-full flex-col items-start justify-start gap-1 rounded-xl border px-4 py-3 text-left text-sm leading-relaxed whitespace-normal break-words transition-colors',
                  option.variant === 'secondary'
                    ? 'border-border/60 bg-muted/40 hover:bg-muted/60 dark:bg-muted/20 dark:hover:bg-muted/40'
                    : 'border-destructive/50 bg-destructive/90 text-destructive-foreground hover:bg-destructive'
                )}
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  handleDelete(option.mode);
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
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  if (isLoading) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 mr-auto">
      <Actions>
        <div className="relative">
          {onToggleSelect && (
            <Action
              aria-pressed={isSelected}
              onClick={() => onToggleSelect(message.id)}
              tooltip={isSelected ? 'Deselect' : 'Select'}
            >
              <SelectionIndicator checked={Boolean(isSelected)} />
            </Action>
          )}

          {renderDeleteAction()}

          <Action onClick={handleCopy} tooltip="Copy">
            <Copy size={16} />
          </Action>

          {setMode && (
            <Action onClick={() => setMode('edit')} tooltip="Edit">
              <Pencil size={16} />
            </Action>
          )}

          {onFork && (
            <Action onClick={() => onFork(message.id)} tooltip="Fork">
              <GitBranchPlus size={16} />
            </Action>
          )}

          {onRegenerate && message.role === 'assistant' && (
            <Action
              onClick={() => !disableRegenerate && onRegenerate(message.id)}
              tooltip={disableRegenerate ? 'Regenerating…' : 'Regenerate'}
              disabled={disableRegenerate}
            >
              <RotateCcw size={16} />
            </Action>
          )}
        </div>
      </Actions>

      {modelBadge || siblingsBadge ? (
        <div className="flex items-center gap-2">
          {modelBadge}
          {siblingsBadge}
        </div>
      ) : null}
    </div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.onDelete !== nextProps.onDelete) {
      return false;
    }
    if (prevProps.onToggleSelect !== nextProps.onToggleSelect) {
      return false;
    }
    if (prevProps.isSelected !== nextProps.isSelected) {
      return false;
    }
    if (prevProps.isSelectionMode !== nextProps.isSelectionMode) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.onFork !== nextProps.onFork) {
      return false;
    }

    return true;
  }
);
