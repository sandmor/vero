'use client';
import equal from 'fast-deep-equal';
import { AnimatePresence, motion } from 'framer-motion';
import { Fragment, memo, useCallback, useState } from 'react';
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
import {
  EmptyMessagePlaceholder,
  LoadingDots,
} from './message/empty-message-placeholder';
import { renderToolPart, type ToolPart } from './message/tool-renderers';
import { useProcessedMessageParts } from './message/use-processed-message-parts';

type MessagePart = NonNullable<ChatMessage['parts']>[number];

const isToolPart = (part: MessagePart): part is ToolPart =>
  typeof part.type === 'string' && part.type.startsWith('tool-');

const MessageAvatar = ({ role, model }: { role: string; model?: string }) => {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-border md:size-9',
        role === 'assistant'
          ? 'bg-background'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {role === 'assistant' ? (
        (() => {
          const raw = model;
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
  );
};

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
  onEditMessageOnly,
  allowedModels,
  selectedModelId,
  isExpanded,
  onReasoningCollapse,
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
  onNavigate?: (messageId: string, direction: 'next' | 'prev') => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onForkMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, text: string) => Promise<void>;
  onEditMessageOnly?: (messageId: string, text: string) => Promise<void>;
  allowedModels?: ChatModelOption[];
  selectedModelId?: string;
  isExpanded?: boolean;
  onReasoningCollapse?: () => void;
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
    'w-full max-w-full break-words text-left text-base leading-relaxed transition-colors',
    'px-5 py-4'
  );

  let inlineReasoningAttached = false;
  const inlineReasoningTrimmed = inlineReasoningText.trim();
  const hasInlineReasoning = inlineReasoningTrimmed.length > 0;
  const shouldShowPlaceholder = mode === 'view' && !hasVisibleContent;
  const handleNavigate = useCallback(
    (direction: 'next' | 'prev') => {
      onNavigate?.(message.id, direction);
    },
    [message.id, onNavigate]
  );

  // Use message metadata model if available, otherwise fall back to selectedModelId (for correct avatar during stream start)
  const effectiveModelId =
    (message.metadata?.model as string) || selectedModelId || '';

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="group/message w-full"
      data-role={message.role}
      data-testid={`message-${message.role}`}
      initial={{ opacity: 0 }}
    >
      <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-start md:gap-4">
        <div className="flex items-center gap-2 md:hidden">
          <MessageAvatar role={message.role} model={effectiveModelId} />
          <span className="font-medium text-muted-foreground text-xs capitalize">
            {message.role === 'user'
              ? 'You'
              : deriveChatModel(effectiveModelId)?.name || 'AI'}
          </span>
        </div>

        <div className="-mt-1 hidden md:block">
          <MessageAvatar role={message.role} model={effectiveModelId} />
        </div>

        <div
          className={cn('flex w-full min-w-0 flex-col gap-3 md:gap-4', {
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

          <div className='flex flex-col w-full rounded-2xl border border-border/60 overflow-hidden bg-muted text-foreground/90 dark:bg-muted/40'>
            {shouldShowPlaceholder ? (
              <div className="px-5 py-4">
                <EmptyMessagePlaceholder
                  className="min-h-6"
                  isLoading={isLoading}
                />
              </div>
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
                          onCollapse={onReasoningCollapse}
                        />
                      </MessageContent>
                    </div>
                  );
                }

                if (type === 'text') {
                  if (typeof part.text !== 'string') {
                    return null;
                  }

                  return (
                    <div key={key} className="w-full">
                      <AnimatePresence mode="wait" initial={false}>
                        {mode === 'view' ? (
                          <motion.div
                            key="view"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <MessageContent
                              className={messageBubbleClass}
                              data-testid="message-content"
                            >
                              {message.role === 'assistant' &&
                                !inlineReasoningAttached &&
                                hasInlineReasoning && (
                                  <MessageReasoning
                                    appearance="inline"
                                    isLoading={isLoading}
                                    reasoning={inlineReasoningTrimmed}
                                    onCollapse={onReasoningCollapse}
                                  />
                                )}
                              {part.text.trim().length > 0 ? (
                                <Response>{sanitizeText(part.text)}</Response>
                              ) : null}
                            </MessageContent>
                          </motion.div>
                        ) : (
                          index === firstTextIndex && (
                            <motion.div
                              key="edit"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.15 }}
                              className="flex w-full flex-row items-start gap-3 px-5 py-4"
                            >
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
                                  onSubmitWithoutRegenerate={
                                    onEditMessageOnly
                                      ? async (nextText) => {
                                        await onEditMessageOnly(
                                          message.id,
                                          nextText
                                        );
                                      }
                                      : undefined
                                  }
                                />
                              </div>
                            </motion.div>
                          )
                        )}
                      </AnimatePresence>
                    </div>
                  );
                }

                if (isToolPart(part)) {
                  const toolNode = renderToolPart(part, {
                    isReadonly,
                  });

                  return toolNode ? (
                    <div key={key} className="px-5 py-2">
                      {toolNode}
                    </div>
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
                modelBadge={(() => {
                  if (
                    message.role !== 'assistant' ||
                    !message.metadata?.model
                  ) {
                    return null;
                  }
                  const raw = message.metadata.model as string;
                  let name = '';
                  let isBYOK = false;
                  if (allowedModels && allowedModels.length > 0) {
                    const found = allowedModels.find((m) => m.id === raw);
                    if (found) {
                      name = found.name;
                      isBYOK = Boolean(found.isBYOK);
                    }
                  }
                  if (!name) {
                    try {
                      const derived = deriveChatModel(raw);
                      name =
                        derived?.name ??
                        raw.split(':').slice(1).join(':') ??
                        raw;
                    } catch {
                      const parts = raw.split(':');
                      name = parts.length > 1 ? parts.slice(1).join(':') : raw;
                    }
                  }
                  return (
                    <span className="hidden items-center gap-2 rounded-full bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground md:flex">
                      <span className="truncate">{name}</span>
                      {isBYOK && (
                        <span className="rounded-full border border-primary/40 bg-primary/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-primary">
                          BYOK
                        </span>
                      )}
                    </span>
                  );
                })()}
                siblingIndex={message.metadata?.siblingIndex}
                siblingsCount={message.metadata?.siblingsCount}
                onNavigate={handleNavigate}
                onFork={onForkMessage}
                isExpanded={isExpanded}
              />
            )}
          </div>
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
    if (prevProps.disableRegenerate !== nextProps.disableRegenerate)
      return false;
    if (prevProps.isSelected !== nextProps.isSelected) return false;
    if (prevProps.isSelectionMode !== nextProps.isSelectionMode) return false;
    if (prevProps.onToggleSelectMessage !== nextProps.onToggleSelectMessage)
      return false;
    if (prevProps.onNavigate !== nextProps.onNavigate) return false;
    if (prevProps.onForkMessage !== nextProps.onForkMessage) return false;
    if (prevProps.onEditMessage !== nextProps.onEditMessage) return false;
    if (prevProps.onEditMessageOnly !== nextProps.onEditMessageOnly)
      return false;
    if (!equal(prevProps.allowedModels, nextProps.allowedModels)) return false;
    if (prevProps.selectedModelId !== nextProps.selectedModelId) return false;
    if (prevProps.isExpanded !== nextProps.isExpanded) return false;
    if (prevProps.onReasoningCollapse !== nextProps.onReasoningCollapse)
      return false;

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
      <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-start md:gap-4">
        <div className="flex items-center gap-2 md:hidden">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <Sparkle size={14} />
          </div>
          <span className="font-medium text-muted-foreground text-xs">AI</span>
        </div>

        <div className="-mt-1 hidden shrink-0 items-center justify-center md:flex">
          <div className="flex size-9 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <Sparkle size={14} />
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-2 md:gap-4">
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
