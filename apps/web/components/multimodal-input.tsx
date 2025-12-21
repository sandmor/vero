'use client';

import type { UseChatHelpers } from '@ai-sdk/react';
import { Trigger } from '@radix-ui/react-select';
import type { UIMessage } from 'ai';
import equal from 'fast-deep-equal';
import {
  type ChangeEvent,
  type Dispatch,
  memo,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';
import { saveChatModelAsCookie } from '@/app/actions/chat';
import { SelectItem } from '@/components/ui/select';
import { displayProviderName } from '@/lib/ai/registry';
import type { Attachment, ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import { cn } from '@/lib/utils';
import { ReasoningEffortSelector } from './chat-reasoning-selector';
import { Context } from './elements/context';
import {
  PromptInput,
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from './elements/prompt-input';
import {
  ArrowUp,
  ChevronDown,
  Paperclip,
  StopCircle,
  User,
} from 'lucide-react';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import type { ChatModelOption } from '@/lib/ai/models';
import { useByokModels } from '@/hooks/use-byok-models';
import { Badge } from '@/components/ui/badge';
import { CreatorLogo } from './creator-logo';

function modelSupportsAttachments(model: ChatModelOption | null | undefined) {
  if (!model?.capabilities) {
    return true;
  }
  const formats = model.capabilities.supportedFormats;
  return formats.includes('image') || formats.includes('file');
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedModelId,
  onModelChange,
  usage,
  allowedModels,
  reasoningEffort,
  onReasoningEffortChange,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>['status'];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  className?: string;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  usage?: AppUsage;
  allowedModels: ChatModelOption[];
  reasoningEffort?: 'low' | 'medium' | 'high';
  onReasoningEffortChange?: (
    effort: 'low' | 'medium' | 'high',
    options?: { userInitiated?: boolean }
  ) => void | Promise<void>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const { getApiKeyUsageForModel } = useByokModels();

  const modelChangeRef = useRef(onModelChange);
  useEffect(() => {
    modelChangeRef.current = onModelChange;
  }, [onModelChange]);

  const stableModelChange = useCallback((modelId: string) => {
    return modelChangeRef.current?.(modelId);
  }, []);

  const reasoningEffortChangeRef = useRef(onReasoningEffortChange);
  useEffect(() => {
    reasoningEffortChangeRef.current = onReasoningEffortChange;
  }, [onReasoningEffortChange]);

  const stableReasoningChange = useCallback(
    (
      effort: 'low' | 'medium' | 'high',
      options?: { userInitiated?: boolean }
    ) => {
      return reasoningEffortChangeRef.current?.(effort, options);
    },
    []
  );

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Reset to auto to correctly measure scrollHeight
    el.style.height = 'auto';

    // Try to read inline maxHeight (set via style prop on the component). Fallback to 1000.
    const rawMax = el.style.maxHeight || '';
    const max = rawMax ? parseInt(rawMax.replace('px', ''), 10) : 1000;

    const newHeight = Math.min(el.scrollHeight, max);
    el.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const resetHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    // Restore to the configured minHeight if available, otherwise fall back to 44px
    const rawMin = el.style.minHeight || '';
    const min = rawMin ? rawMin : '44px';
    el.style.height = min;
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    ''
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);

    const el = textareaRef.current;
    if (!el) return;

    // Adjust height immediately based on the event target's scrollHeight
    el.style.height = 'auto';
    const rawMax = el.style.maxHeight || '';
    const max = rawMax ? parseInt(rawMax.replace('px', ''), 10) : 1000;
    const newHeight = Math.min(event.target.scrollHeight, max);
    el.style.height = `${newHeight}px`;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const selectedModel = useMemo(() => {
    return allowedModels.find((model) => model.id === selectedModelId) ?? null;
  }, [allowedModels, selectedModelId]);

  const supportsAttachments = useMemo(
    () => modelSupportsAttachments(selectedModel),
    [selectedModel]
  );

  const chatHasAttachments = useMemo(() => {
    if (attachments.length > 0 || uploadQueue.length > 0) {
      return true;
    }
    return messages.some((message) =>
      Array.isArray(message.parts)
        ? message.parts.some(
          (part) =>
            !!part &&
            typeof part === 'object' &&
            'type' in part &&
            part.type === 'file'
        )
        : false
    );
  }, [attachments, uploadQueue, messages]);

  useEffect(() => {
    if (supportsAttachments) {
      return;
    }

    let cleared = false;
    setAttachments((current) => {
      if (current.length === 0) {
        return current;
      }
      cleared = true;
      return [];
    });

    if (cleared) {
      toast.warning(
        'Attachments cleared because the selected model does not support them.'
      );
    }

    setUploadQueue([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [supportsAttachments, setAttachments, setUploadQueue]);

  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);

    sendMessage({
      role: 'user',
      parts: [
        ...attachments.map((attachment) => ({
          type: 'file' as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: 'text',
          text: input,
        },
      ],
    });

    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();
    setInput('');

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    resetHeight,
  ]);

  const uploadFile = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (_error) {
      toast.error('Failed to upload file, please try again!');
    }
  }, []);

  // Model resolution now server-side; client keeps only selected model id.

  const contextProps = useMemo(
    () => ({
      usage,
    }),
    [usage]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!supportsAttachments) {
        event.target.value = '';
        toast.error('Attachments are not supported by the selected model.');
        return;
      }

      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error('Error uploading files!', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile, supportsAttachments]
  );

  return (
    <div className={cn('relative flex w-full flex-col', className)}>
      <input
        className="-top-4 -left-4 pointer-events-none fixed size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
        disabled={!supportsAttachments}
        aria-disabled={!supportsAttachments}
      />

      <PromptInput
        className="rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-border hover:border-muted-foreground/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (status !== 'ready') {
            toast.error('Please wait for the model to finish its response!');
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 || uploadQueue.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-scroll"
            data-testid="attachments-preview"
          >
            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: '',
                  name: filename,
                  contentType: '',
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="flex flex-row items-start gap-1 sm:gap-2">
          <PromptInputTextarea
            autoFocus
            className="grow resize-none border-0! border-none! bg-transparent p-2 text-sm outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            /* allow auto-resize so the input grows with content */
            disableAutoResize={false}
            maxHeight={180}
            minHeight={44}
            onChange={handleInput}
            placeholder="Send a message..."
            ref={textareaRef}
            rows={1}
            value={input}
          />{' '}
          <Context {...contextProps} />
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <AttachmentsButton
              fileInputRef={fileInputRef}
              status={status}
              supportsAttachments={supportsAttachments}
            />
            <ModelSelectorCompact
              allowedModels={allowedModels}
              chatHasAttachments={chatHasAttachments}
              onModelChange={stableModelChange}
              selectedModelId={selectedModelId}
              getApiKeyUsageForModel={getApiKeyUsageForModel}
            />
            {onReasoningEffortChange && (
              <ReasoningEffortSelector
                selectedEffort={reasoningEffort}
                onSelectEffort={stableReasoningChange}
                chatHasStarted={messages.length > 0}
              />
            )}
          </PromptInputTools>

          {status === 'submitted' || status === 'streaming' ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              disabled={!input.trim() || uploadQueue.length > 0}
              status={status}
              data-testid="send-button"
            >
              <ArrowUp size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (!equal(prevProps.allowedModels, nextProps.allowedModels)) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.reasoningEffort !== nextProps.reasoningEffort) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
  status,
  supportsAttachments,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>['status'];
  supportsAttachments: boolean;
}) {
  const isDisabled = status !== 'ready' || !supportsAttachments;
  const disabledReason = !supportsAttachments
    ? 'Attachments are disabled for this model.'
    : status !== 'ready'
      ? 'Please wait for the current response to finish.'
      : undefined;

  return (
    <Button
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={isDisabled}
      title={disabledReason}
      onClick={(event) => {
        event.preventDefault();
        if (isDisabled) {
          if (!supportsAttachments) {
            toast.error('Attachments are not supported by the selected model.');
          }
          return;
        }
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <Paperclip size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
  allowedModels,
  chatHasAttachments,
  getApiKeyUsageForModel,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  allowedModels: ChatModelOption[];
  chatHasAttachments: boolean;
  getApiKeyUsageForModel: (modelId: string) => { willUseUserKey: boolean };
}) {
  const [optimisticModelId, setOptimisticModelId] = useState(selectedModelId);

  useEffect(() => {
    setOptimisticModelId(selectedModelId);
  }, [selectedModelId]);

  const availableModels = allowedModels;
  const selectedModel = availableModels.find(
    (model) => model.id === optimisticModelId
  );

  // Group models by creator
  const modelsByCreator = availableModels.reduce(
    (acc, model) => {
      if (!acc[model.creator]) {
        acc[model.creator] = [];
      }
      acc[model.creator].push(model);
      return acc;
    },
    {} as Record<string, typeof availableModels>
  );

  return (
    <PromptInputModelSelect
      onValueChange={(modelId) => {
        const model = availableModels.find((m) => m.id === modelId);
        if (model) {
          if (chatHasAttachments && !modelSupportsAttachments(model)) {
            toast.error(
              'Cannot switch: remove attachments to use a text-only model.'
            );
            return;
          }
          setOptimisticModelId(model.id);
          onModelChange?.(model.id);
          startTransition(() => {
            saveChatModelAsCookie(model.id);
          });
        }
      }}
      value={selectedModel?.id}
    >
      <Trigger
        className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium text-foreground shadow-none transition-colors hover:bg-accent focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        type="button"
        data-testid="model-selector"
      >
        <CreatorLogo creatorSlug={selectedModel?.creator ?? ''} className="h-4 w-4" />
        <span className="hidden text-xs font-medium sm:block">
          {selectedModel?.name}
        </span>
        {selectedModel?.isBYOK && (
          <Badge
            variant="outline"
            className="text-[9px] uppercase tracking-wide"
          >
            BYOK
          </Badge>
        )}
        {selectedModel &&
          getApiKeyUsageForModel(selectedModel.id).willUseUserKey && (
            <User className="h-3 w-3 text-primary" />
          )}
        <ChevronDown size={16} />
      </Trigger>
      <PromptInputModelSelectContent className="min-w-[280px] p-0">
        <div className="flex flex-col">
          {Object.entries(modelsByCreator)
            .sort(([a], [b]) =>
              displayProviderName(a).localeCompare(displayProviderName(b))
            )
            .map(([creator, models]) => (
              <div
                key={creator}
                className="border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
                  <CreatorLogo creatorSlug={creator} className="h-4 w-4" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {displayProviderName(creator)}
                  </span>
                </div>
                <div className="flex flex-col gap-px">
                  {models.map((model) => (
                    <SelectItem
                      key={model.id}
                      value={model.id}
                      data-testid={`model-selector-item-${model.id}`}
                      disabled={
                        chatHasAttachments && !modelSupportsAttachments(model)
                      }
                      className="pl-8"
                      title={
                        chatHasAttachments && !modelSupportsAttachments(model)
                          ? 'Remove attachments to select this model.'
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span className="truncate">{model.name}</span>
                        {model.isBYOK && (
                          <Badge
                            variant="outline"
                            className="text-[9px] uppercase tracking-wide"
                          >
                            BYOK
                          </Badge>
                        )}
                      </div>
                      <div className="mt-px truncate text-[10px] text-muted-foreground leading-tight">
                        {model.description}
                      </div>
                    </SelectItem>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </PromptInputModelSelectContent>
    </PromptInputModelSelect>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
}) {
  return (
    <Button
      className="size-7 rounded-full bg-foreground p-1 text-background transition-colors duration-200 hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopCircle size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
