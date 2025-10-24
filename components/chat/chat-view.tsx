'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatHeader } from '@/components/chat-header';
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from '@/hooks/use-artifact';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import type { ChatSettings, MessageTreeResult } from '@/lib/db/schema';
import type { Attachment, ChatMessage } from '@/lib/types';
import { buildBranchFromNode } from '@/lib/utils';
import { Artifact } from '../artifact';
import { useDataStream } from '../data-stream-provider';
import { Messages } from '../messages';
import { MultimodalInput } from '../multimodal-input';
import { Button } from '../ui/button';
import type { VisibilityType } from '../visibility-selector';
import type { AgentPreset } from '../chat-agent-selector';
import type { ChatModelOption } from '@/lib/ai/models';
import { useChatState } from './use-chat-state';
import { useChatSettings } from './use-chat-settings';
import { useChatActions } from './use-chat-actions';
import { useInitialQuery } from './use-initial-query';

export function ChatView({
  id,
  initialMessageTree,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [input, setInput] = useState<string>('');
  const chatHasStarted = useRef(!!initialMessageTree);

  const {
    currentModelId,
    selectedAgent,
    selectedAgentId,
    stagedPinnedSlugs,
    stagedAllowedTools,
    stagedReasoningEffort,
    handleSelectAgent,
    handleModelChange,
    handleReasoningEffortChange,
    handleAddStagedPin,
    handleRemoveStagedPin,
    handleUpdateStagedAllowedTools,
    onChatStart,
  } = useChatSettings({
    id,
    initialSettings,
    initialAgent,
    initialChatModel,
    allowedModels,
    chatHasStarted,
    agentId,
  });

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
    usage,
  } = useChatState({
    id,
    initialMessages: initialMessageTree,
    visibilityType,
    currentModelId,
    stagedPinnedSlugs,
    stagedAllowedTools,
    stagedReasoningEffort,
    stagedAgentId: selectedAgentId,
    chatHasStarted,
    onFinish: onChatStart,
  });

  const {
    selectedMessageIds,
    isBulkDeleting,
    isForking,
    handleDeleteMessage,
    handleDeleteMessageCascade,
    handleToggleSelectMessage,
    handleClearSelection,
    handleDeleteSelected,
    handleForkRegenerate,
  } = useChatActions({ id, messages, setMessages, isReadonly });

  useInitialQuery({ id, messages, sendMessage, regenerate });

  const searchParams = useSearchParams();
  const query = searchParams.get('query');
  const regenerateParam = searchParams.get('regenerate');
  const effectiveAutoResume = autoResume && !query && !regenerateParam;
  useAutoResume({
    autoResume: effectiveAutoResume,
    initialMessages: messages,
    resumeStream,
    setMessages,
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

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      if (!initialMessageTree) return;

      const findParent = (
        nodes: MessageTreeResult['branch'],
        id: string
      ): MessageTreeResult['branch'][0] | null => {
        for (const node of nodes) {
          if (node.children.some((child) => child.id === id)) {
            return node;
          }
        }
        return null;
      };

      const parent = findParent(initialMessageTree.branch, messageId);
      if (!parent || !parent.children) return;

      const currentIndex = parent.children.findIndex(
        (child) => child.id === messageId
      );
      if (currentIndex === -1) return;

      const newIndex =
        direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (newIndex < 0 || newIndex >= parent.children.length) return;

      const newSiblingNode = parent.children[newIndex];
      const newBranch = buildBranchFromNode(newSiblingNode);

      setMessages((currentMessages) => {
        const switchIndex = currentMessages.findIndex(
          (msg) => msg.id === messageId
        );
        if (switchIndex === -1) return currentMessages;

        const baseMessages = currentMessages.slice(0, switchIndex);
        return [...baseMessages, ...newBranch];
      });
    },
    [setMessages, initialMessageTree]
  );

  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const selectionSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds]
  );
  const isSelectionMode = !isReadonly && selectedMessageIds.length > 0;
  const allowedModelMap = useMemo(
    () => new Map(allowedModels.map((model) => [model.id, model])),
    [allowedModels]
  );
  const selectedModel = allowedModelMap.get(currentModelId);

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
          stagedPinnedSlugs={stagedPinnedSlugs}
          onAddStagedPin={handleAddStagedPin}
          onRemoveStagedPin={handleRemoveStagedPin}
          chatHasStarted={chatHasStarted.current}
          selectedAgentId={selectedAgentId}
          selectedAgentLabel={selectedAgent?.name}
          onSelectAgent={handleSelectAgent}
          stagedAllowedTools={stagedAllowedTools}
          onUpdateStagedAllowedTools={handleUpdateStagedAllowedTools}
          selectedModelId={currentModelId}
          selectedModelCapabilities={selectedModel?.capabilities ?? null}
        />

        <Messages
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={messages}
          onDeleteMessage={handleDeleteMessage}
          onDeleteMessageCascade={handleDeleteMessageCascade}
          onToggleSelectMessage={
            !isReadonly ? handleToggleSelectMessage : undefined
          }
          selectedMessageIds={selectionSet}
          isSelectionMode={isSelectionMode}
          onRegenerateAssistant={handleForkRegenerate}
          onNavigate={handleNavigate}
          selectedModelId={currentModelId}
          status={status}
          disableRegenerate={isForking}
          allowedModels={allowedModels}
        />

        {isSelectionMode && (
          <div className="sticky bottom-[106px] z-20 w-full border-t border-border bg-background/95 shadow-sm">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">
                {selectedMessageIds.length} message
                {selectedMessageIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleClearSelection}
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
              onModelChange={handleModelChange}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              usage={usage}
              allowedModels={allowedModels}
              reasoningEffort={stagedReasoningEffort}
              onReasoningEffortChange={handleReasoningEffortChange}
            />
          )}
        </div>

        {isForking && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center bg-gradient-to-t from-background/80 via-background/20 to-transparent p-6">
            <div className="flex items-center gap-2 rounded-full border bg-background/90 px-4 py-2 text-sm shadow-lg backdrop-blur-md">
              <span className="relative inline-flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
              </span>
              <span>Creating fork…</span>
            </div>
          </div>
        )}

        <Artifact
          attachments={attachments}
          chatId={id}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          onDeleteMessage={handleDeleteMessage}
          onDeleteMessageCascade={handleDeleteMessageCascade}
          onToggleSelectMessage={
            !isReadonly ? handleToggleSelectMessage : undefined
          }
          selectedMessageIds={selectionSet}
          isSelectionMode={isSelectionMode}
          selectedModelId={currentModelId}
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
    </>
  );
}
