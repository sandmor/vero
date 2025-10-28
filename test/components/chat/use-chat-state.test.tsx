import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import { useChatMessaging } from '@/components/chat/use-chat-messaging';

const toastMock = vi.fn();
const fetchMock = vi.fn();
const invalidateQueriesMock = vi.fn();
const routerReplaceMock = vi.fn();

const createChatMessage = (
  id: string,
  role: 'user' | 'assistant',
  text: string
): ChatMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }] as any,
  metadata: {
    createdAt: '2024-01-01T00:00:00.000Z',
    siblingIndex: 0,
    siblingsCount: 1,
    model: role === 'assistant' ? 'openai:gpt-4' : undefined,
  },
});

vi.mock('@ai-sdk/react', () => ({
  useChat: vi.fn((options: any) => {
    const [messages, setMessages] = useState(options.messages ?? []);
    const setMessagesWrapper = (updater: any) =>
      setMessages((current: any) =>
        typeof updater === 'function' ? updater(current) : updater
      );
    return {
      messages,
      setMessages: setMessagesWrapper,
      sendMessage: vi.fn(),
      status: 'ready',
      stop: vi.fn(),
      resumeStream: vi.fn(),
      regenerate: vi.fn(),
      error: undefined,
      clearError: vi.fn(),
    };
  }),
}));

vi.mock('ai', () => ({
  DefaultChatTransport: class DefaultChatTransport {
    options: any;
    constructor(options: any) {
      this.options = options;
    }
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('@/components/toast', () => ({
  toast: (args: unknown) => toastMock(args),
}));

vi.mock('@/lib/errors', () => ({
  ChatSDKError: class ChatSDKError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ChatSDKError';
    }
  },
}));

vi.mock('@/lib/utils', () => ({
  buildBranchFromNode: vi.fn(),
  fetchWithErrorHandlers: (...args: unknown[]) => fetchMock(...args),
  generateUUID: () => 'test-uuid',
}));

describe('useChatMessaging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    toastMock.mockReset();
    invalidateQueriesMock.mockReset();
    routerReplaceMock.mockReset();
  });

  const createPreferences = () =>
    ({
      currentModelIdRef: { current: 'openai:gpt-4' },
      stagedPinnedSlugsRef: { current: [] as string[] },
      stagedAllowedToolsRef: { current: undefined },
      stagedReasoningEffortRef: { current: undefined },
      stagedAgentIdRef: { current: undefined },
      chatHasStartedRef: { current: true },
      markChatAsStarted: vi.fn(),
    }) as any;

  const createSelectionApi = () => {
    let selectionState = ['msg-1'];
    return {
      getSelectedIds: vi.fn(() => selectionState.slice()),
      removeFromSelection: vi.fn((ids: string[]) => {
        selectionState = selectionState.filter((id) => !ids.includes(id));
      }),
      clearSelection: vi.fn(() => {
        selectionState = [];
      }),
      setSelection: vi.fn((ids: string[]) => {
        selectionState = ids.slice();
      }),
    };
  };

  it('deletes a single message and keeps the chat open', async () => {
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve({ chatDeleted: false }),
    });

    const selection = createSelectionApi();

    const initialMessages = [
      createChatMessage('msg-1', 'user', 'Hello'),
      createChatMessage('msg-2', 'assistant', 'Hi there'),
    ];

    const { result } = renderHook(() =>
      useChatMessaging({
        chatId: 'test-chat',
        initialMessageTree: undefined,
        initialMessages,
        visibilityType: 'private' as any,
        isReadonly: false,
        preferences: createPreferences(),
        setUsage: vi.fn(),
        setDataStream: vi.fn(),
        selection,
      })
    );

    await act(async () => {
      await result.current.handleDeleteMessage('msg-1');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/test-chat/messages/msg-1',
      { method: 'DELETE' }
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].id).toBe('msg-2');
    expect(selection.removeFromSelection).toHaveBeenCalledWith(['msg-1']);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });

  it('restores previous state when deletion fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    const selection = createSelectionApi();

    const initialMessages = [
      createChatMessage('msg-1', 'user', 'Hello'),
      createChatMessage('msg-2', 'assistant', 'Hi there'),
    ];

    const { result } = renderHook(() =>
      useChatMessaging({
        chatId: 'test-chat',
        initialMessageTree: undefined,
        initialMessages,
        visibilityType: 'private' as any,
        isReadonly: false,
        preferences: createPreferences(),
        setUsage: vi.fn(),
        setDataStream: vi.fn(),
        selection,
      })
    );

    await expect(
      (async () => {
        await act(async () => {
          await result.current.handleDeleteMessage('msg-1');
        });
      })()
    ).rejects.toThrow('boom');

    expect(result.current.messages).toHaveLength(2);
    expect(selection.setSelection).toHaveBeenCalledWith(['msg-1']);
  });
});
