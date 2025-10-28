import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatPreferences } from '@/components/chat/use-chat-preferences';

const useChatSettingsMock = vi.fn();
const useUpdateModelIdMock = vi.fn();
const useUpdateReasoningEffortMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@/components/toast', () => ({
  toast: (args: unknown) => toastMock(args),
}));

vi.mock('@/hooks/use-chat-settings', () => ({
  useChatSettings: (...args: unknown[]) => useChatSettingsMock(...args),
  useUpdateModelId: (...args: unknown[]) => useUpdateModelIdMock(...args),
  useUpdateReasoningEffort: (...args: unknown[]) =>
    useUpdateReasoningEffortMock(...args),
}));

vi.mock('@/lib/utils', () => ({
  fetchWithErrorHandlers: vi.fn(),
  isValidUUID: (value: string) => value.includes('-'),
}));

vi.mock('@/lib/agent-settings', () => ({
  normalizeAllowedTools: (tools: unknown) => tools ?? undefined,
  normalizeModelId: (model: string | null | undefined) => model ?? null,
  normalizePinnedEntries: (entries: string[] | undefined) => entries ?? [],
  normalizeReasoningEffort: (
    effort: 'low' | 'medium' | 'high' | null | undefined
  ) => effort ?? null,
}));

describe('useChatPreferences', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    useChatSettingsMock.mockReturnValue({ data: null });
    useUpdateModelIdMock.mockReturnValue({ mutateAsync: vi.fn() });
    useUpdateReasoningEffortMock.mockReturnValue({ mutateAsync: vi.fn() });
  });

  afterEach(() => {
    toastMock.mockReset();
  });

  it('updates the model and persists when the chat has started', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useUpdateModelIdMock.mockReturnValue({ mutateAsync });

    const allowedModels = [
      {
        id: 'openai:gpt-4',
        provider: 'openai',
        model: 'gpt-4',
        name: 'GPT-4',
        capabilities: null,
      },
      {
        id: 'openai:gpt-5',
        provider: 'openai',
        model: 'gpt-5',
        name: 'GPT-5',
        capabilities: null,
      },
    ];

    const { result } = renderHook(() =>
      useChatPreferences({
        chatId: 'chat-123',
        allowedModels,
        initialChatModel: 'openai:gpt-4',
        initialMessagesCount: 2,
        initialSettings: { modelId: 'openai:gpt-4' } as any,
      })
    );

    await act(async () => {
      await result.current.handleModelChange('openai:gpt-5');
    });

    expect(result.current.currentModelId).toBe('openai:gpt-5');
    expect(mutateAsync).toHaveBeenCalledWith('openai:gpt-5');
  });

  it('does not persist the model before the chat starts', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    useUpdateModelIdMock.mockReturnValue({ mutateAsync });

    const allowedModels = [
      {
        id: 'openai:gpt-4',
        provider: 'openai',
        model: 'gpt-4',
        name: 'GPT-4',
        capabilities: null,
      },
      {
        id: 'openai:gpt-5',
        provider: 'openai',
        model: 'gpt-5',
        name: 'GPT-5',
        capabilities: null,
      },
    ];

    const { result } = renderHook(() =>
      useChatPreferences({
        chatId: 'chat-123',
        allowedModels,
        initialChatModel: 'openai:gpt-4',
        initialMessagesCount: 0,
        initialSettings: { modelId: 'openai:gpt-4' } as any,
      })
    );

    await act(async () => {
      await result.current.handleModelChange('openai:gpt-5');
    });

    expect(result.current.currentModelId).toBe('openai:gpt-5');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('reverts reasoning effort when mutation fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('mutation failed'));
    useUpdateReasoningEffortMock.mockReturnValue({ mutateAsync });

    const allowedModels = [
      {
        id: 'openai:gpt-4',
        provider: 'openai',
        model: 'gpt-4',
        name: 'GPT-4',
        capabilities: null,
      },
    ];

    const { result } = renderHook(() =>
      useChatPreferences({
        chatId: 'chat-123',
        allowedModels,
        initialChatModel: 'openai:gpt-4',
        initialMessagesCount: 1,
        initialSettings: {
          modelId: 'openai:gpt-4',
          reasoningEffort: 'low',
        } as any,
      })
    );

    await act(async () => {
      await expect(
        result.current.handleReasoningEffortChange('high')
      ).rejects.toThrow('mutation failed');
    });

    expect(result.current.stagedReasoningEffort).toBe('low');
    expect(toastMock).toHaveBeenCalledWith({
      type: 'error',
      description: 'Failed to update reasoning effort',
    });
  });
});
