import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowDownIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage } from '@/lib/types';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { useDataStream } from './data-stream-provider';
import { Conversation, ConversationContent } from './elements/conversation';
import { Greeting } from './greeting';
import { PreviewMessage, ThinkingMessage } from './message';

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>['status'];
  messages: ChatMessage[];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  selectedModelId: string;
  onRegenerateAssistant?: (assistantMessageId: string) => void;
  disableRegenerate?: boolean;
  onDeleteMessage: (
    messageId: string,
    mode: MessageDeletionMode
  ) => Promise<{ chatDeleted: boolean }>;
  onToggleSelectMessage?: (messageId: string) => void;
  selectedMessageIds: Set<string>;
  isSelectionMode: boolean;
  onNavigate?: (messageId: string, direction: 'next' | 'prev') => void;
  onForkMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, text: string) => Promise<void>;
  allowedModels?: import('@/lib/ai/models').ChatModelOption[];
};

export function Messages({
  chatId,
  status,
  messages,
  isReadonly,
  onDeleteMessage,
  onToggleSelectMessage,
  selectedMessageIds,
  isSelectionMode,
  onRegenerateAssistant,
  onNavigate,
  onForkMessage,
  onEditMessage,
  disableRegenerate,
  allowedModels,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  useDataStream();

  useEffect(() => {
    if (status === 'submitted') {
      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (container) {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: 'smooth',
          });
        }
      });
    }
  }, [status, messagesContainerRef]);

  return (
    <div
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 touch-pan-y overflow-y-scroll"
      ref={messagesContainerRef}
      style={{ overflowAnchor: 'none' }}
    >
      <Conversation className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 md:gap-6">
        <ConversationContent className="flex flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && <Greeting />}

          {messages.map((message, index) => (
            <PreviewMessage
              chatId={chatId}
              isLoading={
                status === 'streaming' && messages.length - 1 === index
              }
              isReadonly={isReadonly}
              key={message.id}
              message={message}
              requiresScrollPadding={
                hasSentMessage && index === messages.length - 1
              }
              onDeleteMessage={onDeleteMessage}
              onToggleSelectMessage={onToggleSelectMessage}
              isSelected={selectedMessageIds.has(message.id)}
              isSelectionMode={isSelectionMode}
              onRegenerateAssistant={onRegenerateAssistant}
              onNavigate={(direction) => onNavigate?.(message.id, direction)}
              onForkMessage={onForkMessage}
              onEditMessage={onEditMessage}
              disableRegenerate={disableRegenerate}
              allowedModels={allowedModels}
            />
          ))}

          {status === 'submitted' &&
            messages.length > 0 &&
            messages.at(-1)?.role === 'user' && <ThinkingMessage />}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </ConversationContent>
      </Conversation>

      {!isAtBottom && (
        <button
          aria-label="Scroll to bottom"
          className="-translate-x-1/2 absolute bottom-40 left-1/2 z-10 rounded-full border bg-background p-2 shadow-lg transition-colors hover:bg-muted"
          onClick={() => scrollToBottom('smooth')}
          type="button"
        >
          <ArrowDownIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
