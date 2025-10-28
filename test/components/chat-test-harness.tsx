import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { DataStreamProvider } from '@/components/data-stream-provider';

export const chatHeaderSpy = vi.fn();
export const messagesSpy = vi.fn();
export const multimodalSpy = vi.fn();
export const artifactSpy = vi.fn();

vi.mock('@/components/chat-header', () => {
  const React = require('react');
  return {
    ChatHeader: (props: any) => {
      chatHeaderSpy(props);
      return React.createElement('div', { 'data-testid': 'chat-header' });
    },
  };
});

vi.mock('@/components/messages', () => {
  const React = require('react');
  return {
    Messages: (props: any) => {
      messagesSpy(props);
      return React.createElement('div', { 'data-testid': 'chat-messages' });
    },
  };
});

vi.mock('@/components/multimodal-input', () => {
  const React = require('react');
  return {
    MultimodalInput: (props: any) => {
      const { input, setInput, sendMessage } = props;
      multimodalSpy(props);
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('textarea', {
          'aria-label': 'Chat input',
          value: input,
          onChange: (event: any) => setInput(event.target.value),
        }),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () =>
              sendMessage({
                role: 'user',
                parts: [{ type: 'text', text: input }],
              }),
          },
          'Send'
        )
      );
    },
  };
});

vi.mock('@/components/artifact', () => {
  const React = require('react');
  return {
    Artifact: (props: any) => {
      artifactSpy(props);
      return React.createElement('div', { 'data-testid': 'chat-artifact' });
    },
  };
});

export const mockUseChat = vi.fn();

vi.mock('@ai-sdk/react', () => ({
  useChat: mockUseChat,
}));

export const defaultChatProps = {
  id: 'test-chat-id',
  initialMessageTree: undefined,
  initialChatModel: 'test-model',
  initialVisibilityType: 'private' as const,
  isReadonly: false,
  autoResume: false,
  initialLastContext: undefined,
  allowedModels: [
    {
      id: 'test-model',
      provider: 'test',
      model: 'test-model',
      name: 'Test Model',
      description: 'A test model',
      capabilities: {
        supportsTools: false,
        supportedFormats: [],
      },
    },
  ],
  agentId: undefined,
  initialAgent: undefined,
  initialSettings: undefined,
};

export const createDefaultChatHelpers = () => ({
  messages: [],
  setMessages: vi.fn(),
  sendMessage: vi.fn(),
  status: 'idle' as const,
  stop: vi.fn(),
  resumeStream: vi.fn(),
  regenerate: vi.fn(),
  error: null,
  clearError: vi.fn(),
});

export function resetChatSpies() {
  chatHeaderSpy.mockReset();
  messagesSpy.mockReset();
  multimodalSpy.mockReset();
  artifactSpy.mockReset();
  mockUseChat.mockReset();
  mockUseChat.mockImplementation(createDefaultChatHelpers);
}

export async function renderChat(
  overrides: Partial<typeof defaultChatProps> = {}
): Promise<RenderResult> {
  const { Chat } = await import('@/components/chat');
  const queryClient = new QueryClient();
  const props = { ...defaultChatProps, ...overrides };
  return render(
    <QueryClientProvider client={queryClient}>
      <DataStreamProvider>
        <Chat {...props} />
      </DataStreamProvider>
    </QueryClientProvider>
  );
}
