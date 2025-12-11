import type { UseChatHelpers } from '@ai-sdk/react';
import { ArrowDownIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useMessages } from '@/hooks/use-messages';
import type { ChatMessage } from '@/lib/types';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { Conversation, ConversationContent } from './elements/conversation';
import { Greeting } from './greeting';
import { PreviewMessage, ThinkingMessage } from './message';

type MessagesProps = {
  chatId: string;
  status: UseChatHelpers<ChatMessage>['status'];
  messages: ChatMessage[];
  isReadonly: boolean;

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
  onEditMessageOnly?: (messageId: string, text: string) => Promise<void>;
  allowedModels?: import('@/lib/ai/models').ChatModelOption[];
};

function MessagesComponent({
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
  onEditMessageOnly,
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

  const MOBILE_BREAKPOINT = 480;

  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > MOBILE_BREAKPOINT;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsExpanded(window.innerWidth > MOBILE_BREAKPOINT);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  const [isCollapsing, setIsCollapsing] = useState(false);

  const handleReasoningCollapse = () => {
    setIsCollapsing(true);
    setTimeout(() => {
      setIsCollapsing(false);
    }, 1000);
  };

  return (
    <div
      className="overscroll-behavior-contain -webkit-overflow-scrolling-touch flex-1 min-w-0 touch-pan-y overflow-y-scroll"
      ref={messagesContainerRef}
      style={{ overflowAnchor: isCollapsing ? 'auto' : 'none' }}
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
              onNavigate={onNavigate}
              onForkMessage={onForkMessage}
              onEditMessage={onEditMessage}
              onEditMessageOnly={onEditMessageOnly}
              disableRegenerate={disableRegenerate}
              allowedModels={allowedModels}
              isExpanded={isExpanded}
              onReasoningCollapse={handleReasoningCollapse}
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

const areMessagesPropsEqual = (prev: MessagesProps, next: MessagesProps) => {
  if (prev.chatId !== next.chatId) return false;
  if (prev.status !== next.status) return false;
  if (prev.isReadonly !== next.isReadonly) return false;

  if (prev.selectedModelId !== next.selectedModelId) return false;
  if (prev.disableRegenerate !== next.disableRegenerate) return false;
  if (prev.messages !== next.messages) return false;
  if (prev.selectedMessageIds !== next.selectedMessageIds) return false;
  if (prev.isSelectionMode !== next.isSelectionMode) return false;
  if (prev.onDeleteMessage !== next.onDeleteMessage) return false;
  if (prev.onToggleSelectMessage !== next.onToggleSelectMessage) return false;
  if (prev.onRegenerateAssistant !== next.onRegenerateAssistant) return false;
  if (prev.onNavigate !== next.onNavigate) return false;
  if (prev.onForkMessage !== next.onForkMessage) return false;
  if (prev.onEditMessage !== next.onEditMessage) return false;
  if (prev.onEditMessageOnly !== next.onEditMessageOnly) return false;
  if (prev.allowedModels !== next.allowedModels) return false;
  return true;
};

export const Messages = memo(MessagesComponent, areMessagesPropsEqual);

Messages.displayName = 'Messages';
