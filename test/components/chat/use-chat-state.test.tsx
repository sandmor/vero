import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import type { ChatMessage } from '@/lib/types';
import type { MessageTreeResult } from '@/lib/db/schema';
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

const createTree = (messages: ChatMessage[]): MessageTreeResult => {
  const nodes = messages.map((message, index, array) => {
    const pathLabel = `_${index.toString(36).padStart(2, '0')}`;
    const parentPath =
      index === 0 ? null : `_${(index - 1).toString(36).padStart(2, '0')}`;

    const createdAt = message.metadata?.createdAt ?? '2024-01-01T00:00:00.000Z';

    return {
      id: message.id,
      chatId: 'test-chat',
      role: message.role,
      parts: message.parts,
      attachments: [],
      metadata: null,
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      model: message.metadata?.model ?? null,
      parentId: index === 0 ? null : array[index - 1].id,
      path: null,
      pathText: parentPath ? `${parentPath}.${pathLabel}` : pathLabel,
      parentPath,
      depth: index + 1,
      siblingsCount: 1,
      siblingIndex: 0,
      children: [] as any[],
    } as unknown as import('@/lib/db/schema').MessageTreeNode;
  });

  for (let i = 0; i < nodes.length - 1; i += 1) {
    nodes[i].children.push(nodes[i + 1]);
  }

  return {
    tree: nodes.length ? [nodes[0]] : [],
    nodes,
    branch: nodes,
  } as MessageTreeResult;
};

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
  useMutation: (options: any) => {
    const mutate = async (
      variables: any,
      mutateOptions?: {
        onError?: (error: unknown) => void;
        onSuccess?: () => void;
      }
    ) => {
      try {
        await options.mutationFn(variables);
        options.onSuccess?.(undefined, variables, undefined);
        mutateOptions?.onSuccess?.();
      } catch (error) {
        options.onError?.(error as Error, variables, undefined);
        mutateOptions?.onError?.(error);
        throw error;
      }
    };

    return {
      mutate,
      mutateAsync: mutate,
      isPending: false,
    };
  },
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
  getTextFromMessage: vi.fn(() => 'mock-text'),
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
        initialMessageTree: createTree(initialMessages),
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
        initialMessageTree: createTree(initialMessages),
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

  it('forks assistant messages by cloning the pivot branch', async () => {
    const selection = createSelectionApi();
    const initialMessages = [
      createChatMessage('msg-1', 'user', 'Hello'),
      createChatMessage('msg-2', 'assistant', 'Hi there'),
    ];

    const actions = await import('@/app/(chat)/actions');
    const forkChatActionMock = actions.forkChatAction as vi.Mock;
    forkChatActionMock.mockResolvedValue({
      newChatId: 'new-chat-id',
      insertedEditedMessageId: undefined,
      previousUserText: undefined,
    } as any);

    const { result } = renderHook(() =>
      useChatMessaging({
        chatId: 'test-chat',
        initialMessageTree: createTree(initialMessages),
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
      await result.current.handleForkMessage('msg-2');
    });

    expect(forkChatActionMock).toHaveBeenCalledWith({
      sourceChatId: 'test-chat',
      pivotMessageId: 'msg-2',
      mode: 'clone',
      editedText: undefined,
    });
  });

  it('branches the edited message within the same chat', async () => {
    const selection = createSelectionApi();
    const initialMessages = [
      createChatMessage('msg-1', 'user', 'Hello there'),
      createChatMessage('msg-2', 'assistant', 'Hi again'),
    ];

    const actions = await import('@/app/(chat)/actions');
    const branchMessageActionMock = actions.branchMessageAction as vi.Mock;
    branchMessageActionMock.mockResolvedValue({
      newMessageId: 'msg-1b',
      previousHeadId: 'msg-2',
    });

    const getMessageTreeActionMock = actions.getMessageTreeAction as vi.Mock;
    getMessageTreeActionMock.mockResolvedValue(
      createTree([createChatMessage('msg-1b', 'user', 'Updated message')])
    );

    const { result } = renderHook(() =>
      useChatMessaging({
        chatId: 'test-chat',
        initialMessageTree: createTree(initialMessages),
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
      await result.current.handleEditMessage('msg-1', 'Updated message');
    });

    expect(branchMessageActionMock).toHaveBeenCalledWith({
      chatId: 'test-chat',
      messageId: 'msg-1',
      editedText: 'Updated message',
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      id: 'msg-1b',
      parts: [{ type: 'text', text: 'Updated message' }],
    });
  });
});
