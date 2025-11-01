'use client';
import equal from 'fast-deep-equal';
import { motion } from 'framer-motion';
import { Fragment, memo, useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import type { MessageDeletionMode } from '@/lib/message-deletion';
import { cn, sanitizeText } from '@/lib/utils';
import { MessageContent } from './elements/message';
import { Response } from './elements/response';
import { Sparkle, Cpu, UserRound } from 'lucide-react';
import { LogoOpenAI, LogoGoogle, LogoOpenRouter } from './icons';
import { type ChatModelOption, deriveChatModel } from '@/lib/ai/models';
import { MessageActions } from './message-actions';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { PreviewAttachment } from './preview-attachment';
import { MessageVersionPicker } from './message-version-picker';
import {
  EmptyMessagePlaceholder,
  LoadingDots,
} from './message/empty-message-placeholder';
import { renderToolPart, type ToolPart } from './message/tool-renderers';
import { useProcessedMessageParts } from './message/use-processed-message-parts';

type MessagePart = NonNullable<ChatMessage['parts']>[number];

const isToolPart = (part: MessagePart): part is ToolPart =>
  typeof part.type === 'string' && part.type.startsWith('tool-');

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  isReadonly,
  requiresScrollPadding,
  onRegenerateAssistant,
  disableRegenerate,
  onDeleteMessage,
  onToggleSelectMessage,
  onNavigate,
  isSelected,
  isSelectionMode,
  onForkMessage,
  onEditMessage,
  allowedModels,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onRegenerateAssistant?: (assistantMessageId: string) => void;
  disableRegenerate?: boolean;
  onDeleteMessage?: (
    messageId: string,
    mode: MessageDeletionMode
  ) => Promise<{ chatDeleted: boolean }>;
  onToggleSelectMessage?: (messageId: string) => void;
  onNavigate?: (direction: 'next' | 'prev') => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onForkMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, text: string) => Promise<void>;
  allowedModels?: ChatModelOption[];
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const {
    parts,
    attachments,
    firstTextIndex,
    inlineReasoningText,
    hasVisibleContent,
  } = useProcessedMessageParts(message);
  const hasTextPart = firstTextIndex !== -1;

  const messageBubbleClass = cn(
    'w-full max-w-full break-words rounded-2xl border border-border/60 px-5 py-4 text-left text-base leading-relaxed transition-colors',
    message.role === 'user'
      ? 'bg-primary/5 text-foreground dark:bg-primary/15'
      : 'bg-muted text-foreground/90 dark:bg-muted/40'
  );
  let inlineReasoningAttached = false;
  const inlineReasoningTrimmed = inlineReasoningText.trim();
  const hasInlineReasoning = inlineReasoningTrimmed.length > 0;
  const shouldShowPlaceholder = mode === 'view' && !hasVisibleContent;
  const siblingsPicker =
    message.metadata?.siblingsCount && message.metadata.siblingsCount > 1 ? (
      <MessageVersionPicker
        activeIndex={message.metadata.siblingIndex}
        onNavigate={onNavigate}
        total={message.metadata.siblingsCount}
      />
    ) : null;

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0 }}
    >
      <div className="flex w-full items-start gap-3 md:gap-4">
        <div
          className={cn(
            '-mt-1 flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-border',
            message.role === 'assistant'
              ? 'bg-background'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {message.role === 'assistant' ? (
            (() => {
              const raw = message.metadata?.model as string | undefined;
              const derived = raw ? deriveChatModel(raw) : undefined;
              const provider = derived
                ? derived.provider
                : raw
                  ? raw.split(':')[0]
                  : undefined;
              switch (provider) {
                case 'openai':
                  return <LogoOpenAI size={16} />;
                case 'google':
                  return <LogoGoogle size={16} />;
                case 'openrouter':
                  return <LogoOpenRouter size={16} />;
                default:
                  return raw ? <Cpu size={16} /> : <Sparkle size={16} />;
              }
            })()
          ) : (
            <UserRound size={16} />
          )}
        </div>

        <div
          className={cn('flex w-full flex-col gap-3 md:gap-4', {
            'min-h-96': message.role === 'assistant' && requiresScrollPadding,
          })}
        >
          {attachments.length > 0 && (
            <div
              className="flex flex-row gap-2"
              data-testid={'message-attachments'}
            >
              {attachments.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? 'file',
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {shouldShowPlaceholder ? (
            <EmptyMessagePlaceholder
              className="min-h-[1.5rem]"
              isLoading={isLoading}
            />
          ) : (
            parts.map((part, index) => {
              const { type } = part;
              const key = `message-${message.id}-part-${index}`;

              if (type === 'file') {
                return null;
              }

              if (type === 'reasoning') {
                if (hasTextPart && index < firstTextIndex) {
                  return null;
                }

                return (
                  <div key={key}>
                    <MessageContent
                      className={messageBubbleClass}
                      data-testid="message-content"
                    >
                      <MessageReasoning
                        appearance="inline"
                        isLoading={isLoading}
                        reasoning={
                          typeof part.text === 'string' ? part.text : ''
                        }
                      />
                    </MessageContent>
                  </div>
                );
              }

              if (type === 'text') {
                if (typeof part.text !== 'string') {
                  return null;
                }

                if (mode === 'view') {
                  const shouldIncludeReasoning =
                    message.role === 'assistant' &&
                    !inlineReasoningAttached &&
                    hasInlineReasoning;

                  if (shouldIncludeReasoning) {
                    inlineReasoningAttached = true;
                  }

                  if (!part.text.trim() && !shouldIncludeReasoning) {
                    return null;
                  }

                  return (
                    <div key={key}>
                      <MessageContent
                        className={messageBubbleClass}
                        data-testid="message-content"
                      >
                        {shouldIncludeReasoning ? (
                          <MessageReasoning
                            appearance="inline"
                            isLoading={isLoading}
                            reasoning={inlineReasoningTrimmed}
                          />
                        ) : null}
                        {part.text.trim().length > 0 ? (
                          <Response>{sanitizeText(part.text)}</Response>
                        ) : null}
                      </MessageContent>
                    </div>
                  );
                }

                if (mode === 'edit' && index === firstTextIndex) {
                  return (
                    <div
                      className="flex w-full flex-row items-start gap-3"
                      key={key}
                    >
                      <div className="size-8" />
                      <div className="min-w-0 flex-1">
                        <MessageEditor
                          key={message.id}
                          message={message}
                          setMode={setMode}
                          onSubmit={async (nextText) => {
                            if (!onEditMessage) {
                              return;
                            }
                            await onEditMessage(message.id, nextText);
                          }}
                        />
                      </div>
                    </div>
                  );
                }

                return null;
              }

              if (isToolPart(part)) {
                const toolNode = renderToolPart(part, {
                  isReadonly,
                });

                return toolNode ? (
                  <Fragment key={key}>{toolNode}</Fragment>
                ) : null;
              }

              return null;
            })
          )}

          {!isReadonly && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              onRegenerate={onRegenerateAssistant}
              disableRegenerate={disableRegenerate}
              onDelete={onDeleteMessage}
              onToggleSelect={onToggleSelectMessage}
              isSelected={Boolean(isSelected)}
              isSelectionMode={Boolean(isSelectionMode)}
              modelBadge={
                message.role === 'assistant' && message.metadata?.model ? (
                  <span className="rounded-full bg-muted/30 px-2 py-0.5 text-sm font-medium text-muted-foreground">
                    {(() => {
                      const raw = message.metadata?.model as string | undefined;
                      if (!raw) return '';
                      // If allowedModels provided, prefer authoritative name
                      if (allowedModels && allowedModels.length > 0) {
                        const found = allowedModels.find((m) => m.id === raw);
                        if (found) return found.name;
                      }
                      try {
                        const d = deriveChatModel(raw);
                        return (
                          d?.name ?? raw.split(':').slice(1).join(':') ?? raw
                        );
                      } catch {
                        const parts = raw.split(':');
                        return parts.length > 1
                          ? parts.slice(1).join(':')
                          : raw;
                      }
                    })()}
                  </span>
                ) : null
              }
              siblingsBadge={siblingsPicker}
              onFork={onForkMessage}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    // re-render when loading state changes
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    // always re-render on message id change
    if (prevProps.message.id !== nextProps.message.id) return false;
    // re-render when scroll padding requirement changes
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;

    // re-render if message parts change
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;

    // re-render if metadata that affects UI (createdAt or model) changed
    if (
      prevProps.message.metadata?.createdAt !==
      nextProps.message.metadata?.createdAt
    )
      return false;
    if (prevProps.message.metadata?.model !== nextProps.message.metadata?.model)
      return false;
    if (
      prevProps.message.metadata?.siblingIndex !==
      nextProps.message.metadata?.siblingIndex
    )
      return false;
    if (
      prevProps.message.metadata?.siblingsCount !==
      nextProps.message.metadata?.siblingsCount
    )
      return false;
    if (prevProps.isSelected !== nextProps.isSelected) return false;
    if (prevProps.isSelectionMode !== nextProps.isSelectionMode) return false;
    if (prevProps.onToggleSelectMessage !== nextProps.onToggleSelectMessage)
      return false;
    if (prevProps.onNavigate !== nextProps.onNavigate) return false;
    if (prevProps.onForkMessage !== nextProps.onForkMessage) return false;
    if (prevProps.onEditMessage !== nextProps.onEditMessage) return false;
    if (!equal(prevProps.allowedModels, nextProps.allowedModels)) return false;

    // otherwise skip rerender
    return true;
  }
);

const PureThinkingMessage = () => {
  const role = 'assistant';

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={role}
      data-testid="message-assistant-loading"
      initial={{ opacity: 0 }}
    >
      <div className="flex items-start justify-start gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <Sparkle size={14} />
        </div>

        <div className="flex w-full flex-col gap-2 md:gap-4">
          <div className="p-0 text-muted-foreground text-sm">
            <LoadingDots aria-label="Generating response" />
          </div>
        </div>
      </div>
    </motion.div>
  );
};

PureThinkingMessage.displayName = 'ThinkingMessage';

export const ThinkingMessage = memo(PureThinkingMessage);
