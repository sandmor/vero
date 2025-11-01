import { memo, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCopyToClipboard } from 'usehooks-ts';
import type { ChatMessage } from '@/lib/types';
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
  onDeleteCascade,
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
  onDelete?: (messageId: string) => Promise<{ chatDeleted: boolean }>;
  onDeleteCascade?: (messageId: string) => Promise<{ chatDeleted: boolean }>;
  onToggleSelect?: (messageId: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onFork?: (messageId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const [_, copyToClipboard] = useCopyToClipboard();

  type DeleteMode = 'single' | 'cascade';

  const deleteMutation = useMutation<
    { chatDeleted: boolean },
    ChatSDKError | Error,
    { mode: DeleteMode }
  >({
    mutationFn: async ({ mode }) => {
      if (mode === 'single') {
        if (!onDelete) {
          throw new ChatSDKError('bad_request:api');
        }
        const result = await onDelete(message.id);
        return result ?? { chatDeleted: false };
      }

      if (!onDeleteCascade) {
        throw new ChatSDKError('bad_request:api');
      }

      const result = await onDeleteCascade(message.id);
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
      const successDescription = data?.chatDeleted
        ? 'Chat deleted.'
        : variables.mode === 'cascade'
          ? 'Messages deleted.'
          : 'Message deleted.';
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
              Choose whether to delete only this message or remove it along with
              every following message in the thread.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row">
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'secondary' }))}
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                handleDelete('single');
              }}
            >
              Delete only this
            </AlertDialogAction>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }))}
              disabled={deleteMutation.isPending || !onDeleteCascade}
              onClick={(event) => {
                event.preventDefault();
                if (!onDeleteCascade) {
                  return;
                }
                handleDelete('cascade');
              }}
            >
              Delete this & following
            </AlertDialogAction>
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
    if (prevProps.onDeleteCascade !== nextProps.onDeleteCascade) {
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
