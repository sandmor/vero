import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const toastMock = {
  error: vi.fn(),
  warning: vi.fn(),
};

vi.mock('sonner', () => ({
  toast: toastMock,
}));

vi.mock('usehooks-ts', () => {
  const React = require('react');
  return {
    useLocalStorage: (_: string, initialValue: any) =>
      React.useState(initialValue),
    useWindowSize: () => ({ width: 1024, height: 768 }),
  };
});

vi.mock('@/lib/ai/registry', () => ({
  displayProviderName: (provider: string) => provider,
}));

vi.mock('@/components/icons', () => {
  const React = require('react');
  return {
    LogoOpenAI: (props: any) => React.createElement('span', props),
    LogoGoogle: (props: any) => React.createElement('span', props),
    LogoOpenRouter: (props: any) => React.createElement('span', props),
  };
});

vi.mock('@/components/elements/context', () => {
  const React = require('react');
  return {
    Context: () => React.createElement('div', { 'data-testid': 'context' }),
  };
});

vi.mock('@/components/suggested-actions', () => {
  const React = require('react');
  return {
    SuggestedActions: (props: { children?: ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'suggested-actions' },
        props.children
      ),
  };
});

vi.mock('@/components/preview-attachment', () => {
  const React = require('react');
  return {
    PreviewAttachment: ({ attachment, isUploading, onRemove }: any) =>
      React.createElement(
        'div',
        {
          'data-testid': isUploading
            ? 'attachment-uploading'
            : 'attachment-preview',
        },
        React.createElement('span', null, attachment.name),
        onRemove
          ? React.createElement(
              'button',
              {
                type: 'button',
                onClick: onRemove,
                'data-testid': 'remove-attachment',
              },
              'Remove'
            )
          : null
      ),
  };
});

vi.mock('@/components/chat-reasoning-selector', () => {
  const React = require('react');
  return {
    ReasoningEffortSelector: ({ onSelectEffort }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'reasoning-effort-selector',
          onClick: () => onSelectEffort?.('medium'),
        },
        'Effort'
      ),
  };
});

vi.mock('@/components/ui/button', () => {
  const React = require('react');
  return {
    Button: ({ children, ...props }: any) =>
      React.createElement('button', { type: 'button', ...props }, children),
  };
});

vi.mock('@/components/ui/select', () => {
  const React = require('react');
  return {
    SelectItem: ({ children, disabled, value, onClick, ...props }: any) =>
      React.createElement(
        'button',
        {
          type: 'button',
          disabled,
          'data-value': value,
          onClick,
          ...props,
        },
        children
      ),
  };
});

const modelSelectHandlers: { onValueChange?: (modelId: string) => void } = {};

vi.mock('@/components/elements/prompt-input', () => {
  const React = require('react');
  const PromptInput = ({ onSubmit, children }: any) =>
    React.createElement(
      'form',
      {
        onSubmit,
        'data-testid': 'prompt-input',
      },
      typeof children === 'function' ? children({}) : children
    );

  const PromptInputTextarea = React.forwardRef((props: any, ref: any) => {
    const {
      disableAutoResize: _disableAutoResize,
      maxHeight: _maxHeight,
      minHeight: _minHeight,
      ...rest
    } = props;
    return React.createElement('textarea', { ...rest, ref });
  });

  const PromptInputToolbar = ({ children }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'prompt-input-toolbar' },
      children
    );

  const PromptInputTools = ({ children }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'prompt-input-tools' },
      children
    );

  const PromptInputSubmit = ({ children, ...props }: any) =>
    React.createElement('button', { type: 'submit', ...props }, children);

  const PromptInputModelSelect = ({ onValueChange, children, value }: any) => {
    modelSelectHandlers.onValueChange = onValueChange;
    return React.createElement(
      'div',
      {
        'data-testid': 'model-select-wrapper',
        'data-value': value,
      },
      children
    );
  };

  const PromptInputModelSelectContent = ({ children }: any) =>
    React.createElement(
      'div',
      { 'data-testid': 'model-select-content' },
      children
    );

  return {
    PromptInput,
    PromptInputTextarea,
    PromptInputToolbar,
    PromptInputSubmit,
    PromptInputTools,
    PromptInputModelSelect,
    PromptInputModelSelectContent,
  };
});

vi.mock('@radix-ui/react-select', () => {
  const React = require('react');
  return {
    Trigger: React.forwardRef((props: any, ref: any) =>
      React.createElement(
        'button',
        { ref, type: 'button', ...props },
        props.children
      )
    ),
  };
});

const { MultimodalInput } = await import('@/components/multimodal-input');
const chatActions = await import('@/app/(chat)/actions');
const saveChatModelAsCookieMock =
  chatActions.saveChatModelAsCookie as unknown as ReturnType<typeof vi.fn>;

const defaultModels = [
  {
    id: 'model-vision',
    provider: 'openrouter',
    model: 'vision',
    name: 'Vision Model',
    description: 'Supports attachments',
    capabilities: {
      supportsTools: false,
      supportedFormats: ['text', 'image'] as any,
    },
  },
  {
    id: 'model-text',
    provider: 'openrouter',
    model: 'text',
    name: 'Text Model',
    description: 'Text only',
    capabilities: {
      supportsTools: false,
      supportedFormats: ['text'] as any,
    },
  },
];

type HarnessProps = {
  initialInput?: string;
  initialAttachments?: Array<{
    url: string;
    name: string;
    contentType: string;
  }>;
  initialMessages?: unknown[];
  status?: 'idle' | 'ready' | 'submitted' | 'streaming';
  allowedModels?: typeof defaultModels;
  selectedModelId?: string;
  sendMessage?: ReturnType<typeof vi.fn>;
  onModelChange?: ReturnType<typeof vi.fn>;
  onReasoningEffortChange?: ReturnType<typeof vi.fn>;
};

function MultimodalHarness({
  initialInput = 'Hello',
  initialAttachments = [],
  initialMessages = [],
  status = 'ready',
  allowedModels = defaultModels,
  selectedModelId = allowedModels[0]?.id ?? 'model-vision',
  sendMessage = vi.fn(),
  onModelChange = vi.fn(),
  onReasoningEffortChange = vi.fn(),
}: HarnessProps) {
  const React = require('react');
  const [input, setInput] = React.useState(initialInput);
  const [attachments, setAttachments] = React.useState(initialAttachments);
  const [messages, setMessages] = React.useState(initialMessages);

  return (
    <MultimodalInput
      chatId="chat-id"
      input={input}
      setInput={setInput}
      status={status as any}
      stop={vi.fn() as any}
      attachments={attachments}
      setAttachments={setAttachments}
      messages={messages as any}
      setMessages={setMessages as any}
      sendMessage={sendMessage as any}
      selectedVisibilityType="private"
      selectedModelId={selectedModelId}
      allowedModels={allowedModels as any}
      reasoningEffort="medium"
      onReasoningEffortChange={onReasoningEffortChange as any}
      onModelChange={onModelChange as any}
    />
  );
}

describe('MultimodalInput', () => {
  beforeEach(() => {
    toastMock.error.mockReset();
    toastMock.warning.mockReset();
    saveChatModelAsCookieMock.mockReset();
  });

  it('submits composed messages and clears the composer state', async () => {
    const sendMessage = vi.fn();
    render(
      <MultimodalHarness
        initialInput="Hello world"
        initialAttachments={[
          {
            url: 'https://example.com/file.txt',
            name: 'file.txt',
            contentType: 'text/plain',
          },
        ]}
        sendMessage={sendMessage}
      />
    );

    expect(screen.getByTestId('attachments-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('send-button'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      role: 'user',
      parts: [
        {
          type: 'file',
          url: 'https://example.com/file.txt',
          name: 'file.txt',
          mediaType: 'text/plain',
        },
        {
          type: 'text',
          text: 'Hello world',
        },
      ],
    });
    expect(screen.getByTestId('multimodal-input')).toHaveValue('');
    await waitFor(() =>
      expect(
        screen.queryByTestId('attachments-preview')
      ).not.toBeInTheDocument()
    );
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('warns and clears attachments when the active model lacks attachment support', async () => {
    render(
      <MultimodalHarness
        initialAttachments={[
          {
            url: 'https://example.com/file.txt',
            name: 'file.txt',
            contentType: 'text/plain',
          },
        ]}
        allowedModels={[defaultModels[1]]}
        selectedModelId="model-text"
      />
    );

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('attachments-preview')).not.toBeInTheDocument();
  });

  it('prevents switching to a text-only model while attachments are present', async () => {
    const onModelChange = vi.fn();
    render(
      <MultimodalHarness
        initialAttachments={[
          {
            url: 'https://example.com/file.txt',
            name: 'file.txt',
            contentType: 'text/plain',
          },
        ]}
        onModelChange={onModelChange}
      />
    );

    await act(async () => {
      modelSelectHandlers.onValueChange?.('model-text');
    });

    expect(toastMock.error).toHaveBeenCalledWith(
      'Cannot switch: remove attachments to use a text-only model.'
    );
    expect(onModelChange).not.toHaveBeenCalled();
    expect(saveChatModelAsCookieMock).not.toHaveBeenCalled();
  });
});
