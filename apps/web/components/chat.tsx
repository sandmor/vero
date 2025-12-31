'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from '@/components/chat-header';

import { useAutoResume } from '@/hooks/use-auto-resume';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useMultiSelection } from '@/hooks/use-multi-selection';
import type {
  ChatSettings,
  DBMessage,
  MessageTreeResult,
} from '@/lib/db/schema';
import type { Attachment, ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import { convertToUIMessages } from '@/lib/utils';

import { useDataStreamDispatch } from './data-stream-provider';
import { Messages } from './messages';
import { MultimodalInput } from './multimodal-input';
import { toast } from './toast';
import type { VisibilityType } from './visibility-selector';
import type { AgentPreset } from '@/types/agent';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import type { ChatModelOption } from '@/lib/ai/models';
import { useChatPreferences } from './chat/use-chat-preferences';
import { useChatMessaging } from './chat/use-chat-messaging';
import { buildMessageTree } from '@/lib/utils/message-tree';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';

export function Chat({
  id,
  initialMessages: initialRawMessages = [],
  initialBranchState,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
  allowedModels,
  agentId,
  initialAgent,
  initialSettings,
}: {
  id: string;
  initialMessages: DBMessage[];
  initialBranchState: BranchSelectionSnapshot;
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
  allowedModels: ChatModelOption[];
  agentId?: string;
  initialAgent?: AgentPreset | null;
  initialSettings?: ChatSettings | null;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });
  const setDataStream = useDataStreamDispatch();

  const [input, setInput] = useState<string>('');
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);

  const initialTree = useMemo<MessageTreeResult>(
    () =>
      buildMessageTree(initialRawMessages ?? [], {
        rootMessageIndex: initialBranchState.rootMessageIndex ?? null,
      }),
    [initialBranchState.rootMessageIndex, initialRawMessages]
  );

  const initialMessages = useMemo<ChatMessage[]>(
    () => convertToUIMessages(initialTree.branch),
    [initialTree]
  );
  const preferences = useChatPreferences({
    chatId: id,
    allowedModels,
    initialChatModel,
    initialMessagesCount: initialMessages.length,
    initialSettings: initialSettings ?? null,
    initialAgent: initialAgent ?? null,
    requestedAgentId: agentId,
  });

  const {
    selectedIds,
    selectedCount,
    isSelectionMode,
    toggleSelection,
    stopSelectionMode,
    setSelection,
  } = useMultiSelection<string>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false);

  const selectedMessageIdsSet = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );

  const getSelectedIds = useCallback(() => selectedIds, [selectedIds]);

  const clearSelection = useCallback(() => {
    stopSelectionMode();
  }, [stopSelectionMode]);

  const removeFromSelection = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const removeSet = new Set(ids);
      setSelection(selectedIds.filter((id) => !removeSet.has(id)));
    },
    [selectedIds, setSelection]
  );

  const selectionApi = useMemo(
    () => ({
      getSelectedIds,
      removeFromSelection,
      clearSelection,
      setSelection,
    }),
    [getSelectedIds, removeFromSelection, clearSelection, setSelection]
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    chatError,
    clearChatError,
    handleDeleteMessage,
    handleDeleteSelected,
    handleForkMessage,
    handleEditMessage,
    handleEditMessageOnly,
    handleRegenerateAssistant,
    handleNavigate,
    disableRegenerate,
    isBulkDeleting,
  } = useChatMessaging({
    chatId: id,
    initialMessageTree: initialTree,
    initialMessages,
    visibilityType,
    isReadonly,
    preferences,
    setUsage,
    setDataStream,
    selection: selectionApi,
  });

  const handleBulkDialogToggle = useCallback(
    (open: boolean) => {
      if (isBulkDeleting) {
        return;
      }
      setIsBulkDeleteDialogOpen(open);
    },
    [isBulkDeleting]
  );

  const handleBulkDeleteConfirm = useCallback(async () => {
    try {
      await handleDeleteSelected('version');
      setIsBulkDeleteDialogOpen(false);
    } catch (_error) {
      // Errors are surfaced by handleDeleteSelected via toast notifications.
    }
  }, [handleDeleteSelected]);

  useEffect(() => {
    if (!isSelectionMode) {
      setIsBulkDeleteDialogOpen(false);
    }
  }, [isSelectionMode]);

  useEffect(() => {
    if (selectedCount === 0) {
      setIsBulkDeleteDialogOpen(false);
    }
  }, [selectedCount]);

  const searchParams = useSearchParams();
  const query = searchParams.get('query');
  const regenerateParam = searchParams.get('regenerate');
  const initialQueryHandledRef = useRef(false);
  const initialRegenerateHandledRef = useRef(false);

  useEffect(() => {
    if (!query) return;
    if (initialQueryHandledRef.current) return;
    const existingSame = messages.some(
      (message) =>
        message.role === 'user' &&
        message.parts.some(
          (part) => part.type === 'text' && part.text === query
        )
    );
    if (existingSame) {
      initialQueryHandledRef.current = true;
      window.history.replaceState({}, '', `/chat/${id}`);
      return;
    }
    initialQueryHandledRef.current = true;
    sendMessage({
      role: 'user',
      parts: [{ type: 'text', text: query }],
    });
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [query, messages, sendMessage, id]);

  useEffect(() => {
    if (!regenerateParam) return;
    if (initialRegenerateHandledRef.current) return;
    if (messages.length === 0) return;
    initialRegenerateHandledRef.current = true;
    regenerate();
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [regenerateParam, messages, regenerate, id]);

  const effectiveAutoResume =
    autoResume &&
    !query &&
    !regenerateParam &&
    !initialQueryHandledRef.current &&
    !initialRegenerateHandledRef.current;

  useAutoResume({
    autoResume: effectiveAutoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const handleRetryOnError = useCallback(() => {
    if (clearChatError) {
      clearChatError();
    }
    setTimeout(() => {
      regenerate();
    }, 16);
  }, [clearChatError, regenerate]);

  const handleDismissError = useCallback(() => {
    if (clearChatError) {
      clearChatError();
    }
  }, [clearChatError]);

  useEffect(() => {
    if (!chatError) return;
    toast({
      type: 'error',
      description:
        chatError.message || 'An error occurred while generating the response.',
      actions: [
        { label: 'Retry', onClick: handleRetryOnError, primary: true },
        { label: 'Dismiss', onClick: handleDismissError },
      ],
    });
  }, [chatError, handleDismissError, handleRetryOnError]);

  const toggleMessageSelection = useCallback(
    (messageId: string) => {
      if (isReadonly) return;
      toggleSelection(messageId);
    },
    [isReadonly, toggleSelection]
  );

  const selectedModel = preferences.selectedModel;

  return (
    <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
      <ChatHeader
        chatId={id}
        isReadonly={isReadonly}
        selectedVisibilityType={initialVisibilityType}
        stagedPinnedSlugs={preferences.stagedPinnedSlugs}
        onAddStagedPin={preferences.handleAddStagedPin}
        onRemoveStagedPin={preferences.handleRemoveStagedPin}
        chatHasStarted={preferences.chatHasStartedRef.current}
        selectedAgentId={preferences.selectedAgentId}
        selectedAgentLabel={preferences.selectedAgent?.name}
        onSelectAgent={preferences.handleSelectAgent}
        stagedAllowedTools={preferences.stagedAllowedTools}
        onUpdateStagedAllowedTools={preferences.handleUpdateStagedAllowedTools}
        selectedModelId={preferences.currentModelId}
        selectedModelCapabilities={selectedModel?.capabilities ?? null}
      />

      <Messages
        chatId={id}
        isReadonly={isReadonly}
        messages={messages}
        onDeleteMessage={handleDeleteMessage}
        onToggleSelectMessage={!isReadonly ? toggleMessageSelection : undefined}
        selectedMessageIds={selectedMessageIdsSet}
        isSelectionMode={isSelectionMode}
        onRegenerateAssistant={handleRegenerateAssistant}
        onNavigate={handleNavigate}
        onForkMessage={handleForkMessage}
        onEditMessage={handleEditMessage}
        onEditMessageOnly={handleEditMessageOnly}
        selectedModelId={preferences.currentModelId}
        status={status}
        disableRegenerate={disableRegenerate}
        allowedModels={allowedModels}
      />

      {isSelectionMode && (
        <>
          <div className="sticky bottom-[106px] z-20 w-full border-t border-border bg-background/95 shadow-sm">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">
                {selectedCount} message{selectedCount === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={clearSelection}
                  variant="outline"
                  disabled={isBulkDeleting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => handleBulkDialogToggle(true)}
                  variant="destructive"
                  disabled={isBulkDeleting}
                >
                  {isBulkDeleting ? 'Deleting…' : 'Delete selected'}
                </Button>
              </div>
            </div>
          </div>

          <AlertDialog
            open={isBulkDeleteDialogOpen}
            onOpenChange={handleBulkDialogToggle}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {selectedCount} selected message
                  {selectedCount === 1 ? '' : 's'}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. The selected messages and their
                  branches will be permanently deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isBulkDeleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={isBulkDeleting}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleBulkDeleteConfirm();
                  }}
                >
                  {isBulkDeleting ? 'Deleting…' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      <div className="sticky bottom-0 z-10 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
        {!isReadonly && (
          <MultimodalInput
            attachments={attachments}
            chatId={id}
            input={input}
            messages={messages}
            onModelChange={preferences.handleModelChange}
            selectedModelId={preferences.currentModelId}
            sendMessage={sendMessage}
            setAttachments={setAttachments}
            setInput={setInput}
            setMessages={setMessages}
            status={status}
            stop={stop}
            allowedModels={allowedModels}
            reasoningEffort={preferences.stagedReasoningEffort}
            onReasoningEffortChange={preferences.handleReasoningEffortChange}
          />
        )}
      </div>
    </div>
  );
}
