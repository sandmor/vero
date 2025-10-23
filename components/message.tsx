'use client';
import equal from 'fast-deep-equal';
import { motion } from 'framer-motion';
import { memo, useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import { cn, sanitizeText } from '@/lib/utils';
import { useDataStream } from './data-stream-provider';
import { DocumentToolResult } from './document';
import { DocumentPreview } from './document-preview';
import { MessageContent } from './elements/message';
import { Response } from './elements/response';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from './elements/tool';
import { Sparkle, Cpu, UserRound } from 'lucide-react';
import { LogoOpenAI, LogoGoogle, LogoOpenRouter } from './icons';
import { type ChatModelOption, deriveChatModel } from '@/lib/ai/models';
import { MessageActions } from './message-actions';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { PreviewAttachment } from './preview-attachment';
import { Weather } from './weather';
import { DiffView } from './diffview';

const PurePreviewMessage = ({
  chatId,
  message,
  isLoading,
  isReadonly,
  requiresScrollPadding,
  onRegenerateAssistant,
  disableRegenerate,
  onDeleteMessage,
  onDeleteMessageCascade,
  onToggleSelectMessage,
  onNavigate,
  isSelected,
  isSelectionMode,
  allowedModels,
}: {
  chatId: string;
  message: ChatMessage;
  isLoading: boolean;
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onRegenerateAssistant?: (assistantMessageId: string) => void;
  disableRegenerate?: boolean;
  onDeleteMessage?: (messageId: string) => Promise<{ chatDeleted: boolean }>;
  onDeleteMessageCascade?: (
    messageId: string
  ) => Promise<{ chatDeleted: boolean }>;
  onToggleSelectMessage?: (messageId: string) => void;
  onNavigate?: (direction: 'next' | 'prev') => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  allowedModels?: ChatModelOption[];
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const parts = message.parts ?? [];

  // Merge consecutive reasoning parts
  const processedParts = parts.reduce(
    (acc, part) => {
      if (
        part.type === 'reasoning' &&
        typeof part.text === 'string' &&
        part.text.trim().length > 0
      ) {
        const lastPart = acc[acc.length - 1];
        if (
          lastPart &&
          lastPart.type === 'reasoning' &&
          typeof lastPart.text === 'string'
        ) {
          // Merge with previous reasoning part
          lastPart.text += '\n\n' + part.text.trim();
        } else {
          // Add new reasoning part
          acc.push({
            ...part,
            text: part.text.trim(),
          });
        }
      } else {
        acc.push(part);
      }
      return acc;
    },
    [] as typeof parts
  );

  const attachmentsFromMessage = processedParts.filter(
    (part) => part.type === 'file'
  );
  const hasTextPart = processedParts.some(
    (part) =>
      part.type === 'text' &&
      typeof part.text === 'string' &&
      part.text.trim().length > 0
  );

  // Find reasoning parts before the first text part for inline reasoning
  const firstTextIndex = processedParts.findIndex(
    (part) =>
      part.type === 'text' &&
      typeof part.text === 'string' &&
      part.text.trim().length > 0
  );
  const inlineReasoningText = processedParts
    .slice(0, firstTextIndex === -1 ? processedParts.length : firstTextIndex)
    .filter(
      (part): part is typeof part & { text: string } =>
        part.type === 'reasoning' &&
        typeof part.text === 'string' &&
        part.text.trim().length > 0
    )
    .map((part) => part.text)
    .join('\n\n');

  useDataStream();

  const messageBubbleClass = cn(
    'w-full max-w-full break-words rounded-2xl border border-border/60 px-5 py-4 text-left text-base leading-relaxed transition-colors',
    message.role === 'user'
      ? 'bg-primary/5 text-foreground dark:bg-primary/15'
      : 'bg-muted text-foreground/90 dark:bg-muted/40'
  );
  let inlineReasoningAttached = false;

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
          {attachmentsFromMessage.length > 0 && (
            <div
              className={cn(
                'flex flex-row gap-2',
                message.role === 'assistant' ? 'justify-start' : 'justify-end'
              )}
              data-testid={'message-attachments'}
            >
              {attachmentsFromMessage.map((attachment) => (
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

          {processedParts.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === 'reasoning') {
              // Skip reasoning parts that are included inline with text
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
                      key={`message-${message.id}-reasoning-${index}`}
                      reasoning={part.text}
                    />
                  </MessageContent>
                </div>
              );
            }

            if (type === 'text') {
              if (mode === 'view') {
                const shouldIncludeReasoning =
                  message.role === 'assistant' &&
                  !inlineReasoningAttached &&
                  inlineReasoningText.trim().length > 0;

                if (shouldIncludeReasoning) {
                  inlineReasoningAttached = true;
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
                          key={`message-${message.id}-reasoning`}
                          reasoning={inlineReasoningText}
                        />
                      ) : null}
                      <Response>{sanitizeText(part.text)}</Response>
                    </MessageContent>
                  </div>
                );
              }

              if (mode === 'edit') {
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
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === 'tool-getWeather') {
              const { toolCallId, state } = part;
              const output = part.output as any;
              const isRecord =
                output && typeof output === 'object' && !Array.isArray(output);
              const isOutputError = isRecord && 'error' in output;
              const errorText =
                state === 'output-error'
                  ? (part.errorText ??
                    (isOutputError ? String(output.error) : undefined))
                  : isOutputError
                    ? String(output.error)
                    : undefined;
              const canRenderWeather = Boolean(!errorText && isRecord);

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-getWeather" />
                  <ToolContent>
                    {state === 'input-available' ? (
                      <ToolInput input={part.input ?? {}} />
                    ) : null}
                    {state === 'output-available' ? (
                      <ToolOutput
                        errorText={errorText}
                        output={
                          canRenderWeather ? (
                            <Weather weatherAtLocation={output} />
                          ) : null
                        }
                      />
                    ) : null}
                    {state === 'output-error' ? (
                      <ToolOutput
                        errorText={
                          errorText ?? 'Unable to retrieve weather data.'
                        }
                      />
                    ) : null}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === 'tool-runCode') {
              const { toolCallId, state } = part;
              const input = part.input as any;
              const output = part.output as any;
              const isOutputError =
                output && typeof output === 'object' && 'error' in output;
              const errorText =
                state === 'output-error'
                  ? (part.errorText ??
                    (isOutputError
                      ? String(output.error?.message || output.error)
                      : undefined))
                  : isOutputError
                    ? String(output.error?.message || output.error)
                    : undefined;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-runCode" />
                  <ToolContent>
                    {(state === 'input-available' ||
                      state === 'output-available' ||
                      state === 'output-error') &&
                      input?.code && (
                        <div className="space-y-2 overflow-hidden p-4">
                          <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                            Code Executed
                          </h4>
                          <div className="rounded-md bg-muted/50">
                            <div className="relative w-full overflow-hidden rounded-md border bg-background text-foreground">
                              <pre className="overflow-x-auto p-4 font-mono text-xs">
                                <code>{input.code}</code>
                              </pre>
                            </div>
                          </div>
                          {input.timeoutMs && (
                            <p className="text-muted-foreground text-xs">
                              Timeout: {input.timeoutMs}ms
                            </p>
                          )}
                        </div>
                      )}
                    {state === 'output-available' && output && (
                      <div className="space-y-4 p-4 pt-0">
                        {output.status === 'ok' &&
                          output.result !== null &&
                          output.result !== undefined && (
                            <div className="space-y-2">
                              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                                Result
                              </h4>
                              <div className="rounded-md bg-green-500/10 p-3">
                                <pre className="overflow-x-auto font-mono text-xs">
                                  {typeof output.result === 'object'
                                    ? JSON.stringify(output.result, null, 2)
                                    : String(output.result)}
                                </pre>
                              </div>
                            </div>
                          )}
                        {output.stdout && output.stdout.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                              Console Output
                            </h4>
                            <div className="rounded-md bg-muted/50 p-3">
                              <pre className="overflow-x-auto font-mono text-xs">
                                {output.stdout.join('\n')}
                              </pre>
                            </div>
                            {output.truncatedStdout > 0 && (
                              <p className="text-muted-foreground text-xs">
                                +{output.truncatedStdout} more lines truncated
                              </p>
                            )}
                          </div>
                        )}
                        {output.stderr && output.stderr.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                              Error Output
                            </h4>
                            <div className="rounded-md bg-red-500/10 p-3">
                              <pre className="overflow-x-auto font-mono text-xs text-red-600 dark:text-red-400">
                                {output.stderr.join('\n')}
                              </pre>
                            </div>
                            {output.truncatedStderr > 0 && (
                              <p className="text-muted-foreground text-xs">
                                +{output.truncatedStderr} more lines truncated
                              </p>
                            )}
                          </div>
                        )}
                        {output.environment && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                              Execution Info
                            </h4>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="rounded-md bg-muted/30 p-2">
                                <span className="text-muted-foreground">
                                  Runtime:
                                </span>{' '}
                                <span className="font-medium">
                                  {output.runtimeMs}ms
                                </span>
                              </div>
                              <div className="rounded-md bg-muted/30 p-2">
                                <span className="text-muted-foreground">
                                  Language:
                                </span>{' '}
                                <span className="font-medium">
                                  {output.environment.language}
                                </span>
                              </div>
                              <div className="rounded-md bg-muted/30 p-2">
                                <span className="text-muted-foreground">
                                  Timeout:
                                </span>{' '}
                                <span className="font-medium">
                                  {output.environment.timeoutMs}ms
                                </span>
                              </div>
                              <div className="rounded-md bg-muted/30 p-2">
                                <span className="text-muted-foreground">
                                  Code Size:
                                </span>{' '}
                                <span className="font-medium">
                                  {output.codeSize} chars
                                </span>
                              </div>
                            </div>
                            {output.environment.warnings &&
                              output.environment.warnings.length > 0 && (
                                <div className="mt-2 rounded-md bg-yellow-500/10 p-2">
                                  <p className="font-medium text-xs text-yellow-700 dark:text-yellow-400">
                                    ⚠️ Warnings:
                                  </p>
                                  <ul className="ml-4 mt-1 list-disc text-xs text-yellow-600 dark:text-yellow-300">
                                    {output.environment.warnings.map(
                                      (warning: string, idx: number) => (
                                        <li key={idx}>{warning}</li>
                                      )
                                    )}
                                  </ul>
                                </div>
                              )}
                          </div>
                        )}
                        {output.error && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                              Execution Error
                            </h4>
                            <div className="rounded-md bg-red-500/10 p-3">
                              <p className="font-medium text-xs text-red-600 dark:text-red-400">
                                {output.error.name}: {output.error.message}
                              </p>
                              {output.error.stack && (
                                <pre className="mt-2 overflow-x-auto font-mono text-xs text-red-500">
                                  {output.error.stack}
                                </pre>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {state === 'output-error' && (
                      <ToolOutput
                        errorText={errorText ?? 'Code execution failed.'}
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (
              type === 'tool-readArchive' ||
              type === 'tool-writeArchive' ||
              type === 'tool-manageChatPins'
            ) {
              const { toolCallId, state } = part;
              const output = part.output as any;
              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type={type} />
                  <ToolContent>
                    <ToolInput input={part.input ?? {}} />
                    {(state === 'output-available' ||
                      state === 'output-error') && (
                      <ToolOutput
                        errorText={
                          state === 'output-error'
                            ? part.errorText
                            : output &&
                                typeof output === 'object' &&
                                'error' in output
                              ? String(output.error)
                              : undefined
                        }
                        output={
                          state === 'output-available' &&
                          output &&
                          !(typeof output === 'object' && 'error' in output) ? (
                            <div className="space-y-2 text-xs">
                              <pre className="whitespace-pre-wrap break-words">
                                {JSON.stringify(output, null, 2)}
                              </pre>
                            </div>
                          ) : null
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            if (type === 'tool-createDocument') {
              const { toolCallId } = part;

              if (part.output && 'error' in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === 'tool-updateDocument') {
              const { toolCallId } = part;

              if (
                part.output &&
                typeof part.output === 'object' &&
                'error' in part.output
              ) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={
                      part.output
                        ? {
                            title: (part.output as any).title,
                            kind: (part.output as any).kind,
                            isUpdate: true,
                          }
                        : undefined
                    }
                    isReadonly={isReadonly}
                    result={
                      part.output
                        ? {
                            id: (part.output as any).id,
                            title: (part.output as any).title,
                            kind: (part.output as any).kind,
                          }
                        : undefined
                    }
                  />
                </div>
              );
            }

            if (type === 'tool-requestSuggestions') {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    <ToolInput input={part.input ?? {}} />
                    {(state === 'output-available' ||
                      state === 'output-error') && (
                      <ToolOutput
                        errorText={
                          state === 'output-error'
                            ? part.errorText
                            : part.output &&
                                typeof part.output === 'object' &&
                                'error' in (part.output as any)
                              ? String((part.output as any).error)
                              : undefined
                        }
                        output={
                          state === 'output-available' &&
                          part.output &&
                          !(
                            typeof part.output === 'object' &&
                            'error' in (part.output as any)
                          ) &&
                          (part.output as any).id &&
                          (part.output as any).title &&
                          (part.output as any).kind ? (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={{
                                id: (part.output as any).id,
                                title: (part.output as any).title,
                                kind: (part.output as any).kind,
                              }}
                              type="request-suggestions"
                            />
                          ) : null
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

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
              onDeleteCascade={onDeleteMessageCascade}
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
              siblingsBadge={
                message.metadata?.siblingsCount &&
                message.metadata.siblingsCount > 1 ? (
                  <div className="flex items-center rounded-full bg-muted/30 px-2 py-0.5 text-sm font-medium text-muted-foreground">
                    <button
                      className="mr-1"
                      disabled={message.metadata.siblingIndex === 0}
                      onClick={() => onNavigate?.('prev')}
                    >
                      ‹
                    </button>
                    <span>
                      {message.metadata.siblingIndex + 1} /{' '}
                      {message.metadata.siblingsCount}
                    </span>
                    <button
                      className="ml-1"
                      disabled={
                        message.metadata.siblingIndex ===
                        message.metadata.siblingsCount - 1
                      }
                      onClick={() => onNavigate?.('next')}
                    >
                      ›
                    </button>
                  </div>
                ) : null
              }
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
    if (!equal(prevProps.allowedModels, nextProps.allowedModels)) return false;

    // otherwise skip rerender
    return true;
  }
);

export const ThinkingMessage = () => {
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
            <LoadingText>Thinking...</LoadingText>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const LoadingText = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      animate={{ backgroundPosition: ['100% 50%', '-100% 50%'] }}
      className="flex items-center text-transparent"
      style={{
        background:
          'linear-gradient(90deg, hsl(var(--muted-foreground)) 0%, hsl(var(--muted-foreground)) 35%, hsl(var(--foreground)) 50%, hsl(var(--muted-foreground)) 65%, hsl(var(--muted-foreground)) 100%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
      }}
      transition={{
        duration: 1.5,
        repeat: Number.POSITIVE_INFINITY,
        ease: 'linear',
      }}
    >
      {children}
    </motion.div>
  );
};
