'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from '@/components/chat-header';
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from '@/hooks/use-artifact';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import { useMultiSelection } from '@/hooks/use-multi-selection';
import type { ChatSettings, MessageTreeResult } from '@/lib/db/schema';
import type { Attachment, ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import { convertToUIMessages } from '@/lib/utils';
import { Artifact } from './artifact';
import { useDataStream } from './data-stream-provider';
import { Messages } from './messages';
import { MultimodalInput } from './multimodal-input';
import { toast } from './toast';
import type { VisibilityType } from './visibility-selector';
import type { AgentPreset } from './chat-agent-selector';
import { Button } from './ui/button';
import type { ChatModelOption } from '@/lib/ai/models';
import { useChatPreferences } from './chat/use-chat-preferences';
import { useChatMessaging } from './chat/use-chat-messaging';

export function Chat({
  id,
  initialMessageTree,
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
  initialMessageTree?: MessageTreeResult;
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
  const { setDataStream } = useDataStream();
  const { setArtifact, setMetadata } = useArtifact();
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);

  const [input, setInput] = useState<string>('');
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);

  const initialMessages = useMemo<ChatMessage[]>(
    () =>
      initialMessageTree ? convertToUIMessages(initialMessageTree.branch) : [],
    [initialMessageTree]
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

  const selectedMessageIdsSet = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );

  const removeFromSelection = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const removeSet = new Set(ids);
      setSelection(selectedIds.filter((id) => !removeSet.has(id)));
    },
    [selectedIds, setSelection]
  );

  const getSelectedIds = useCallback(() => selectedIds, [selectedIds]);

  const clearSelection = useCallback(() => {
    stopSelectionMode();
  }, [stopSelectionMode]);

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
    handleDeleteMessageCascade,
    handleDeleteSelected,
    handleForkMessage,
    handleEditMessage,
    handleRegenerateAssistant,
    handleNavigate,
    disableRegenerate,
    isBulkDeleting,
  } = useChatMessaging({
    chatId: id,
    initialMessageTree,
    initialMessages,
    visibilityType,
    isReadonly,
    preferences,
    setUsage,
    setDataStream,
    selection: {
      getSelectedIds,
      removeFromSelection,
      clearSelection,
      setSelection: (ids) => setSelection(ids),
    },
  });

  useEffect(() => {
    const resetArtifactState = () => ({
      ...initialArtifactData,
      boundingBox: { ...initialArtifactData.boundingBox },
      status: 'idle' as const,
    });

    setDataStream([]);
    setArtifact(resetArtifactState());
    setMetadata(null, false);

    return () => {
      setDataStream([]);
      setArtifact(resetArtifactState());
      setMetadata(null, false);
    };
  }, [id, setArtifact, setDataStream, setMetadata]);

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
        isArtifactVisible={isArtifactVisible}
        isReadonly={isReadonly}
        messages={messages}
        onDeleteMessage={handleDeleteMessage}
        onDeleteMessageCascade={handleDeleteMessageCascade}
        onToggleSelectMessage={!isReadonly ? toggleMessageSelection : undefined}
        selectedMessageIds={selectedMessageIdsSet}
        isSelectionMode={isSelectionMode}
        onRegenerateAssistant={handleRegenerateAssistant}
        onNavigate={handleNavigate}
        onForkMessage={handleForkMessage}
        onEditMessage={handleEditMessage}
        selectedModelId={preferences.currentModelId}
        status={status}
        disableRegenerate={disableRegenerate}
        allowedModels={allowedModels}
      />

      {isSelectionMode && (
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
                onClick={handleDeleteSelected}
                variant="destructive"
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? 'Deleting…' : 'Delete selected'}
              </Button>
            </div>
          </div>
        </div>
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
            selectedVisibilityType={visibilityType}
            sendMessage={sendMessage}
            setAttachments={setAttachments}
            setInput={setInput}
            setMessages={setMessages}
            status={status}
            stop={stop}
            usage={usage}
            allowedModels={allowedModels}
            reasoningEffort={preferences.stagedReasoningEffort}
            onReasoningEffortChange={preferences.handleReasoningEffortChange}
          />
        )}
      </div>

      <Artifact
        attachments={attachments}
        chatId={id}
        input={input}
        isReadonly={isReadonly}
        messages={messages}
        onDeleteMessage={handleDeleteMessage}
        onDeleteMessageCascade={handleDeleteMessageCascade}
        onToggleSelectMessage={!isReadonly ? toggleMessageSelection : undefined}
        selectedMessageIds={selectedMessageIdsSet}
        isSelectionMode={isSelectionMode}
        selectedModelId={preferences.currentModelId}
        selectedVisibilityType={visibilityType}
        sendMessage={sendMessage}
        setAttachments={setAttachments}
        setInput={setInput}
        setMessages={setMessages}
        status={status}
        stop={stop}
        allowedModels={allowedModels}
      />
    </div>
  );
}
