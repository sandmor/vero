import { cleanup, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  artifactSpy,
  chatHeaderSpy,
  createDefaultChatHelpers,
  defaultChatProps,
  mockUseChat,
  multimodalSpy,
  renderChat,
  resetChatSpies,
  messagesSpy,
} from './chat-test-harness';

const ensureFunctions = (props: Record<string, unknown>, keys: string[]) => {
  keys.forEach((key) => {
    expect(typeof props[key]).toBe('function');
  });
};

describe('Chat', () => {
  beforeEach(() => {
    cleanup();
    resetChatSpies();
  });

  it('matches golden master props for the default render', async () => {
    await renderChat();

    expect(chatHeaderSpy).toHaveBeenCalled();
    expect(messagesSpy).toHaveBeenCalled();
    expect(artifactSpy).toHaveBeenCalled();
    expect(multimodalSpy).toHaveBeenCalled();

    const headerProps = chatHeaderSpy.mock.calls.at(-1)?.[0];
    const messagesProps = messagesSpy.mock.calls.at(-1)?.[0];
    const artifactProps = artifactSpy.mock.calls.at(-1)?.[0];
    const composerProps = multimodalSpy.mock.calls.at(-1)?.[0];

    expect(headerProps).toBeDefined();
    expect(messagesProps).toBeDefined();
    expect(artifactProps).toBeDefined();
    expect(composerProps).toBeDefined();

    const header = headerProps!;
    const messages = messagesProps!;
    const artifact = artifactProps!;
    const composer = composerProps!;

    expect(header).toMatchObject({
      chatId: defaultChatProps.id,
      isReadonly: defaultChatProps.isReadonly,
      chatHasStarted: false,
      selectedVisibilityType: defaultChatProps.initialVisibilityType,
      stagedPinnedSlugs: [],
      stagedAllowedTools: undefined,
      selectedAgentId: undefined,
      selectedAgentLabel: undefined,
      selectedModelId: defaultChatProps.allowedModels[0].id,
      selectedModelCapabilities: defaultChatProps.allowedModels[0].capabilities,
    });
    ensureFunctions(header, [
      'onAddStagedPin',
      'onRemoveStagedPin',
      'onSelectAgent',
      'onUpdateStagedAllowedTools',
    ]);

    expect(messages).toMatchObject({
      chatId: defaultChatProps.id,
      isArtifactVisible: false,
      isReadonly: defaultChatProps.isReadonly,
      messages: [],
      selectedModelId: defaultChatProps.allowedModels[0].id,
      status: 'idle',
      disableRegenerate: false,
      allowedModels: defaultChatProps.allowedModels,
      isSelectionMode: false,
    });
    expect(messages.selectedMessageIds).toBeInstanceOf(Set);
    expect(Array.from(messages.selectedMessageIds)).toEqual([]);
    ensureFunctions(messages, [
      'onDeleteMessage',
      'onToggleSelectMessage',
      'onRegenerateAssistant',
      'onNavigate',
    ]);

    expect(artifact).toMatchObject({
      chatId: defaultChatProps.id,
      attachments: [],
      input: '',
      isReadonly: defaultChatProps.isReadonly,
      messages: [],
      isSelectionMode: false,
      selectedModelId: defaultChatProps.allowedModels[0].id,
      selectedVisibilityType: defaultChatProps.initialVisibilityType,
      status: 'idle',
      allowedModels: defaultChatProps.allowedModels,
    });
    expect(artifact.selectedMessageIds).toBeInstanceOf(Set);
    expect(Array.from(artifact.selectedMessageIds)).toEqual([]);
    ensureFunctions(artifact, [
      'onDeleteMessage',
      'onToggleSelectMessage',
      'sendMessage',
      'setAttachments',
      'setInput',
      'setMessages',
      'stop',
    ]);

    expect(composer).toMatchObject({
      attachments: [],
      chatId: defaultChatProps.id,
      input: '',
      messages: [],
      selectedModelId: defaultChatProps.allowedModels[0].id,
      selectedVisibilityType: defaultChatProps.initialVisibilityType,
      status: 'idle',
      usage: undefined,
      allowedModels: defaultChatProps.allowedModels,
      reasoningEffort: undefined,
    });
    ensureFunctions(composer, [
      'onModelChange',
      'sendMessage',
      'setAttachments',
      'setInput',
      'setMessages',
      'stop',
      'onReasoningEffortChange',
    ]);
  });

  it('sends a message when the user submits via the composer', async () => {
    const sendMessage = vi.fn();
    mockUseChat.mockImplementation(() => ({
      ...createDefaultChatHelpers(),
      sendMessage,
    }));

    await renderChat();

    const input = screen.getByLabelText('Chat input');
    const sendButton = screen.getByRole('button', { name: /send/i });

    fireEvent.change(input, { target: { value: 'Hello, world!' } });
    fireEvent.click(sendButton);

    expect(sendMessage).toHaveBeenCalledWith({
      role: 'user',
      parts: [{ type: 'text', text: 'Hello, world!' }],
    });
  });

  it('hides the composer when the chat is readonly', async () => {
    await renderChat({ isReadonly: true });

    expect(screen.queryByLabelText('Chat input')).not.toBeInTheDocument();
    expect(multimodalSpy).not.toHaveBeenCalled();
  });

  it('passes the provided models through to the composer', async () => {
    const customModels = [
      ...defaultChatProps.allowedModels,
      {
        id: 'alt-model',
        provider: 'test',
        model: 'alt-model',
        name: 'Alt Model',
        description: 'Another model',
        capabilities: {
          supportsTools: true,
          supportedFormats: [],
        },
      },
    ];

    await renderChat({ allowedModels: customModels });

    expect(multimodalSpy).toHaveBeenCalled();
    const latestCall = multimodalSpy.mock.calls.at(-1)?.[0];
    expect(latestCall?.allowedModels).toEqual(customModels);
  });
});
