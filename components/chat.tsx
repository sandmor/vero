'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useSearchParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatHeader } from '@/components/chat-header';
import {
  initialArtifactData,
  useArtifact,
  useArtifactSelector,
} from '@/hooks/use-artifact';
import { useAutoResume } from '@/hooks/use-auto-resume';
import { useChatVisibility } from '@/hooks/use-chat-visibility';
import {
  useChatSettings as useChatSettingsQuery,
  useUpdateModelId,
  useUpdateReasoningEffort,
} from '@/hooks/use-chat-settings';
import type { ChatSettings, MessageTreeResult } from '@/lib/db/schema';
import { ChatSDKError } from '@/lib/errors';
import type { Attachment, ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import {
  convertToUIMessages,
  fetcher,
  fetchWithErrorHandlers,
  generateUUID,
  isValidUUID,
} from '@/lib/utils';
import { Artifact } from './artifact';
import { useDataStream } from './data-stream-provider';
import { Messages } from './messages';
import { MultimodalInput } from './multimodal-input';
import { toast } from './toast';
import type { VisibilityType } from './visibility-selector';
import type { AgentPreset } from './chat-agent-selector';
import {
  normalizeAllowedTools,
  normalizePinnedEntries,
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import type { ChatToolId } from '@/lib/ai/tool-ids';
import { Button } from './ui/button';
import type { ChatModelOption } from '@/lib/ai/models';

export function Chat({
  id,
  initialMessageTree,
  initialChatModel,
  initialVisibilityType,
  isReadonly,
  autoResume,
  initialLastContext,
  allowedModels,
  agentId,
  initialAgent,
  initialSettings,
}: {
  id: string;
  initialMessageTree?: MessageTreeResult;
  initialChatModel: string;
  initialVisibilityType: VisibilityType;
  isReadonly: boolean;
  autoResume: boolean;
  initialLastContext?: AppUsage;
  allowedModels: ChatModelOption[];
  agentId?: string;
  initialAgent?: AgentPreset | null;
  initialSettings?: ChatSettings | null;
}) {
  const { visibilityType } = useChatVisibility({
    chatId: id,
    initialVisibilityType,
  });
  const router = useRouter();

  const queryClient = useQueryClient();
  const { setDataStream } = useDataStream();
  const { setArtifact, setMetadata } = useArtifact();

  const [input, setInput] = useState<string>('');
  const [usage, setUsage] = useState<AppUsage | undefined>(initialLastContext);

  const resolvedInitialAgent = initialAgent ?? null;
  const initialAgentSettings = (resolvedInitialAgent?.settings ??
    null) as ChatSettings | null;

  const allowedModelIds = useMemo(
    () => allowedModels.map((model) => model.id),
    [allowedModels]
  );
  const allowedModelMap = useMemo(
    () => new Map(allowedModels.map((model) => [model.id, model])),
    [allowedModels]
  );

  const initialReasoningEffort = normalizeReasoningEffort(
    initialSettings?.reasoningEffort ??
      initialAgentSettings?.reasoningEffort ??
      undefined
  );

  const initialModelId = (() => {
    const candidates = [
      normalizeModelId(initialSettings?.modelId),
      normalizeModelId(initialAgentSettings?.modelId),
      normalizeModelId(initialChatModel),
    ];
    for (const candidate of candidates) {
      if (candidate && allowedModelIds.includes(candidate)) {
        return candidate;
      }
    }
    if (allowedModelIds.length > 0) {
      return allowedModelIds[0];
    }
    return normalizeModelId(initialChatModel) ?? initialChatModel;
  })();

  const [currentModelId, setCurrentModelId] = useState(initialModelId);
  const currentModelIdRef = useRef(currentModelId);

  const initialMessages = useMemo<ChatMessage[]>(
    () =>
      initialMessageTree ? convertToUIMessages(initialMessageTree.branch) : [],
    [initialMessageTree]
  );

  const [selectedAgent, setSelectedAgent] = useState<AgentPreset | null>(
    resolvedInitialAgent
  );
  const initialAgentId = useMemo(() => {
    if (resolvedInitialAgent?.id && isValidUUID(resolvedInitialAgent.id)) {
      return resolvedInitialAgent.id;
    }
    if (agentId && isValidUUID(agentId)) {
      return agentId;
    }
    return undefined;
  }, [agentId, resolvedInitialAgent?.id]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    initialAgentId
  );
  const stagedAgentIdRef = useRef<string | undefined>(initialAgentId);

  // Provisional pinning (allow selecting archive entries before first message creates backend chat row)
  const [stagedPinnedSlugs, setStagedPinnedSlugs] = useState<string[]>(() =>
    normalizePinnedEntries(
      initialSettings?.pinnedEntries ??
        initialAgentSettings?.pinnedEntries ??
        []
    )
  );
  const stagedPinnedSlugsRef = useRef<string[]>(stagedPinnedSlugs);
  // Provisional tool allow list (undefined => all, subset array => restrict)
  const [stagedAllowedTools, setStagedAllowedTools] = useState<
    ChatToolId[] | undefined
  >(() =>
    normalizeAllowedTools(
      initialSettings?.tools?.allow ?? initialAgentSettings?.tools?.allow
    )
  );
  const stagedAllowedToolsRef = useRef<ChatToolId[] | undefined>(
    stagedAllowedTools
  );
  // Provisional reasoning effort
  const [stagedReasoningEffort, setStagedReasoningEffort] = useState<
    'low' | 'medium' | 'high' | undefined
  >(() => initialReasoningEffort ?? undefined);
  const stagedReasoningEffortRef = useRef<
    'low' | 'medium' | 'high' | undefined
  >(stagedReasoningEffort);
  const [shouldFetchSettings, setShouldFetchSettings] = useState(
    initialMessages.length > 0
  );
  const { data: chatSettingsData } = useChatSettingsQuery(
    shouldFetchSettings ? id : undefined
  );
  const updateReasoningEffortMutation = useUpdateReasoningEffort(id);
  const updateModelIdMutation = useUpdateModelId(id);
  const chatHasStartedRef = useRef(initialMessages.length > 0);
  useEffect(() => {
    if (initialMessages.length > 0) chatHasStartedRef.current = true;
  }, [initialMessages.length]);
  useEffect(() => {
    stagedPinnedSlugsRef.current = stagedPinnedSlugs;
  }, [stagedPinnedSlugs]);
  useEffect(() => {
    stagedAllowedToolsRef.current = stagedAllowedTools;
  }, [stagedAllowedTools]);
  useEffect(() => {
    stagedReasoningEffortRef.current = stagedReasoningEffort;
  }, [stagedReasoningEffort]);

  useEffect(() => {
    const resetArtifactState = () => ({
      ...initialArtifactData,
      boundingBox: { ...initialArtifactData.boundingBox },
      status: 'idle' as const,
    });

    setDataStream([]);
    setArtifact(resetArtifactState());
    setMetadata(null, false);

    return () => {
      setDataStream([]);
      setArtifact(resetArtifactState());
      setMetadata(null, false);
    };
  }, [id, setArtifact, setDataStream, setMetadata]);

  const settingsVersionRef = useRef(0);
  useEffect(() => {
    const settings = chatSettingsData?.settings;
    if (!settings) return;

    // Only sync from server if chat has started (avoid overwriting staged settings)
    if (!chatHasStartedRef.current) return;

    settingsVersionRef.current += 1;

    const normalizedEffort = normalizeReasoningEffort(settings.reasoningEffort);
    if (normalizedEffort !== stagedReasoningEffortRef.current) {
      setStagedReasoningEffort(normalizedEffort);
    }

    const normalizedModel = normalizeModelId(settings.modelId);
    if (
      normalizedModel &&
      allowedModelIds.includes(normalizedModel) &&
      normalizedModel !== currentModelIdRef.current
    ) {
      setCurrentModelId(normalizedModel);
    }
  }, [chatSettingsData?.settings, allowedModelIds]);

  useEffect(() => {
    stagedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);
  useEffect(() => {
    if (chatHasStartedRef.current) return;
    const settings = (selectedAgent?.settings ?? null) as ChatSettings | null;
    if (selectedAgent) {
      setStagedPinnedSlugs(
        normalizePinnedEntries(settings?.pinnedEntries ?? [])
      );
      setStagedAllowedTools(normalizeAllowedTools(settings?.tools?.allow));
      const normalizedEffort = normalizeReasoningEffort(
        settings?.reasoningEffort
      );
      setStagedReasoningEffort(normalizedEffort ?? undefined);
      stagedReasoningEffortRef.current = normalizedEffort ?? undefined;
      const normalizedModel = normalizeModelId(settings?.modelId);
      if (normalizedModel && allowedModelIds.includes(normalizedModel)) {
        setCurrentModelId(normalizedModel);
      }
    } else {
      setStagedPinnedSlugs([]);
      setStagedAllowedTools(undefined);
      setStagedReasoningEffort(initialReasoningEffort ?? undefined);
      stagedReasoningEffortRef.current = initialReasoningEffort ?? undefined;
      setCurrentModelId(initialModelId);
    }
  }, [
    selectedAgent?.id,
    selectedAgent?.settings,
    allowedModelIds,
    initialModelId,
    initialReasoningEffort,
  ]);

  const handleSelectAgent = useCallback(
    async (
      agent: AgentPreset | null,
      options?: { userInitiated?: boolean }
    ) => {
      const userInitiated = options?.userInitiated ?? false;
      const normalizedAgentId = agent?.id
        ? isValidUUID(agent.id)
          ? agent.id
          : null
        : null;
      if (agent && !normalizedAgentId) {
        console.warn('Ignoring agent selection with invalid id', agent.id);
        return;
      }

      const comparisonId = normalizedAgentId ?? undefined;
      if (selectedAgentId === comparisonId) return;

      const shouldPersistSelection = userInitiated && chatHasStartedRef.current;

      if (shouldPersistSelection) {
        try {
          await fetchWithErrorHandlers(`/api/chat/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chatId: id, agentId: normalizedAgentId }),
          });
        } catch (error) {
          console.error('Failed to update chat agent', error);
          toast({ type: 'error', description: 'Failed to update chat agent' });
          return;
        }
      }

      try {
        if (agent) {
          setSelectedAgent({
            id: normalizedAgentId!,
            name: agent.name,
            description: agent.description,
            settings: agent.settings,
          });
          setSelectedAgentId(normalizedAgentId!);
        } else {
          setSelectedAgent(null);
          setSelectedAgentId(undefined);
        }

        const settings = (agent?.settings ?? null) as ChatSettings | null;
        setStagedPinnedSlugs(
          normalizePinnedEntries(settings?.pinnedEntries ?? [])
        );
        setStagedAllowedTools(normalizeAllowedTools(settings?.tools?.allow));
      } catch (error) {
        console.error('Failed to apply chat agent selection', error);
        toast({
          type: 'error',
          description: 'Failed to apply chat agent selection',
        });
      }
    },
    [id, selectedAgentId]
  );

  const handleModelChange = useCallback(
    async (modelId: string) => {
      const normalized = normalizeModelId(modelId);
      if (!normalized || !allowedModelIds.includes(normalized)) {
        return;
      }
      if (normalized === currentModelIdRef.current) {
        return;
      }

      const previous = currentModelIdRef.current;
      setCurrentModelId(normalized);
      currentModelIdRef.current = normalized;

      if (!chatHasStartedRef.current) {
        return;
      }

      try {
        await updateModelIdMutation.mutateAsync(normalized);
      } catch (error) {
        setCurrentModelId(previous);
        currentModelIdRef.current = previous;
        toast({
          type: 'error',
          description: 'Failed to update chat model preference',
        });
      }
    },
    [allowedModelIds, updateModelIdMutation]
  );

  const handleReasoningEffortChange = useCallback(
    async (
      effort: 'low' | 'medium' | 'high',
      _options?: { userInitiated?: boolean }
    ) => {
      const previous = stagedReasoningEffortRef.current;
      if (previous === effort) {
        return;
      }
      setStagedReasoningEffort(effort);
      stagedReasoningEffortRef.current = effort;

      if (!chatHasStartedRef.current) {
        return;
      }

      try {
        await updateReasoningEffortMutation.mutateAsync(effort);
      } catch (error) {
        setStagedReasoningEffort(previous ?? undefined);
        stagedReasoningEffortRef.current = previous ?? undefined;
        toast({
          type: 'error',
          description: 'Failed to update reasoning effort',
        });
        throw error;
      }
    },
    [updateReasoningEffortMutation]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (chatHasStartedRef.current) return;
    const url = new URL(window.location.href);
    if (selectedAgentId) {
      url.searchParams.set('agentId', selectedAgentId);
    } else {
      url.searchParams.delete('agentId');
    }
    const search = url.searchParams.toString();
    const next = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
    window.history.replaceState({}, '', next);
  }, [selectedAgentId]);

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    error: chatError,
    clearError: clearChatError,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const staged = stagedPinnedSlugsRef.current;
        const stagedTools = stagedAllowedToolsRef.current;
        const stagedEffort = stagedReasoningEffortRef.current;
        return {
          body: {
            ...request.body,
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            pinnedSlugs: staged.length > 0 ? staged : undefined,
            allowedTools: !chatHasStartedRef.current ? stagedTools : undefined,
            reasoningEffort: !chatHasStartedRef.current
              ? stagedEffort
              : undefined,
            agentId: !chatHasStartedRef.current
              ? stagedAgentIdRef.current
              : undefined,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      // Invalidate chat history infinite query (new message might affect ordering)
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      if (!chatHasStartedRef.current) {
        chatHasStartedRef.current = true;
        setShouldFetchSettings(true);
        // After first message, pins are persisted or merged; clear staged state & ref
        setStagedPinnedSlugs([]);
        stagedPinnedSlugsRef.current = [];
        setStagedAllowedTools(undefined);
        stagedAllowedToolsRef.current = undefined;
      }
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      }
    },
  });

  const searchParams = useSearchParams();
  const query = searchParams.get('query');
  const regenerateParam = searchParams.get('regenerate');
  const initialQueryHandledRef = useRef(false);
  const initialRegenerateHandledRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Single-run initial query injection (forked edit path)
  useEffect(() => {
    if (!query) return;
    if (initialQueryHandledRef.current) return;
    // Avoid duplicate if a user message with same text already exists
    const existingSame = messages.some(
      (m) =>
        m.role === 'user' &&
        m.parts.some((p) => p.type === 'text' && p.text === query)
    );
    if (existingSame) {
      initialQueryHandledRef.current = true;
      window.history.replaceState({}, '', `/chat/${id}`);
      return;
    }
    initialQueryHandledRef.current = true;
    sendMessage({
      role: 'user' as const,
      parts: [{ type: 'text', text: query }],
    });
    // Strip query param immediately to prevent re-trigger on fast re-render
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [query, messages, sendMessage, id]);

  // Single-run regeneration trigger (forked regenerate path)
  useEffect(() => {
    if (!regenerateParam) return;
    if (initialRegenerateHandledRef.current) return;
    if (messages.length === 0) return; // Wait for messages to load
    initialRegenerateHandledRef.current = true;
    regenerate();
    // Strip query param immediately to prevent re-trigger on fast re-render
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [regenerateParam, messages, regenerate, id]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const selectedMessageIdsRef = useRef<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const chatDeletedRef = useRef(false);

  const selectionSet = useMemo(
    () => new Set(selectedMessageIds),
    [selectedMessageIds]
  );
  const isSelectionMode = !isReadonly && selectedMessageIds.length > 0;

  useEffect(() => {
    selectedMessageIdsRef.current = selectedMessageIds;
  }, [selectedMessageIds]);

  const handleChatDeleted = useCallback(() => {
    if (chatDeletedRef.current) {
      return;
    }

    chatDeletedRef.current = true;
    setSelectedMessageIds([]);
    setAttachments([]);
    router.replace('/chat');
    queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
  }, [queryClient, router]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      let previousMessages: ChatMessage[] = [];
      let previousSelection: string[] = [];
      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => message.id !== messageId);
      });
      setSelectedMessageIds((current) => {
        previousSelection = [...current];
        if (!current.length) return current;
        return current.filter((id) => id !== messageId);
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${id}/messages/${messageId}`,
          {
            method: 'DELETE',
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        setSelectedMessageIds(previousSelection);
        throw error;
      }
    },
    [handleChatDeleted, id, queryClient, setMessages]
  );

  const handleDeleteMessageCascade = useCallback(
    async (messageId: string) => {
      if (isReadonly) {
        return { chatDeleted: false } as const;
      }

      const currentMessages = messagesRef.current;
      const startIndex = currentMessages.findIndex(
        (message) => message.id === messageId
      );

      if (startIndex === -1) {
        return { chatDeleted: false } as const;
      }

      const idsToDelete = currentMessages
        .slice(startIndex)
        .map((message) => message.id);

      if (idsToDelete.length <= 1) {
        return handleDeleteMessage(messageId);
      }

      let previousMessages: ChatMessage[] = [];
      let previousSelection: string[] = [];

      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => !idsToDelete.includes(message.id));
      });

      setSelectedMessageIds((current) => {
        previousSelection = [...current];
        if (!current.length) return current;
        return current.filter((id) => !idsToDelete.includes(id));
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${id}/messages`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: idsToDelete }),
          }
        );
        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        return { chatDeleted: false } as const;
      } catch (error) {
        setMessages(previousMessages);
        setSelectedMessageIds(previousSelection);
        throw error;
      }
    },
    [
      handleChatDeleted,
      handleDeleteMessage,
      id,
      isReadonly,
      queryClient,
      setMessages,
    ]
  );

  // Suppress auto-resume when a query injection or regeneration is pending to avoid duplicate stream starts
  const effectiveAutoResume =
    autoResume &&
    !query &&
    !regenerateParam &&
    !initialQueryHandledRef.current &&
    !initialRegenerateHandledRef.current;
  useAutoResume({
    autoResume: effectiveAutoResume,
    initialMessages,
    resumeStream,
    setMessages,
  });

  const [isForking, setIsForking] = useState(false);

  const handleRetryOnError = useCallback(() => {
    if (clearChatError) clearChatError();
    // small delay to ensure error state clears before regenerating
    setTimeout(() => {
      regenerate();
    }, 16);
  }, [clearChatError, regenerate]);

  const handleDismissError = useCallback(() => {
    if (clearChatError) clearChatError();
  }, [clearChatError]);

  const handleToggleSelectMessage = useCallback(
    (messageId: string) => {
      if (isReadonly) return;
      setSelectedMessageIds((current) => {
        if (current.includes(messageId)) {
          return current.filter((id) => id !== messageId);
        }
        return [...current, messageId];
      });
    },
    [isReadonly]
  );

  const handleClearSelection = useCallback(() => {
    setSelectedMessageIds([]);
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (isReadonly) return;
    const ids = selectedMessageIdsRef.current;
    if (!ids.length) return;

    setIsBulkDeleting(true);
    let previousMessages: ChatMessage[] = [];
    setMessages((current) => {
      previousMessages = [...current];
      return current.filter((message) => !ids.includes(message.id));
    });

    try {
      const response = await fetchWithErrorHandlers(
        `/api/chat/${id}/messages`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageIds: ids }),
        }
      );

      const payload = await response.json().catch(() => null);
      const chatDeleted = Boolean(payload?.chatDeleted);

      setSelectedMessageIds([]);

      if (chatDeleted || messagesRef.current.length === 0) {
        toast({ type: 'success', description: 'Chat deleted.' });
        handleChatDeleted();
      } else {
        toast({ type: 'success', description: 'Messages deleted.' });
      }
    } catch (error) {
      setMessages(previousMessages);
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      } else {
        toast({ type: 'error', description: 'Failed to delete messages.' });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  }, [handleChatDeleted, id, isReadonly, queryClient, setMessages]);

  const handleForkRegenerate = useCallback(
    async (assistantMessageId: string) => {
      if (isForking) return; // guard against double clicks
      setIsForking(true);
      toast({ type: 'success', description: 'Forking chat…' });
      try {
        const match = window.location.pathname.match(/\/chat\/(.+)$/);
        if (!match) throw new Error('Cannot infer current chat id');
        const currentChatId = match[1];
        const { forkChatAction } = await import('@/app/(chat)/actions');
        const result: any = await forkChatAction({
          sourceChatId: currentChatId,
          pivotMessageId: assistantMessageId,
          mode: 'regenerate',
        });
        if (!result?.newChatId) {
          throw new Error('Fork action did not return newChatId');
        }
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        }, 8000);
        requestAnimationFrame(() => {
          router.push(`/chat/${result.newChatId}?regenerate=true`);
        });
      } catch (e) {
        console.error('Regenerate fork failed', e);
        toast({
          type: 'error',
          description: (e as Error).message || 'Failed to fork chat',
        });
        setIsForking(false);
      }
    },
    [isForking, queryClient, router]
  );

  const handleAddStagedPin = useCallback((slug: string) => {
    setStagedPinnedSlugs((prev) =>
      prev.includes(slug) ? prev : [...prev, slug]
    );
  }, []);

  const handleRemoveStagedPin = useCallback((slug: string) => {
    setStagedPinnedSlugs((prev) => prev.filter((s) => s !== slug));
  }, []);

  const handleUpdateStagedAllowedTools = useCallback(
    (tools: ChatToolId[] | undefined) => {
      setStagedAllowedTools(tools);
    },
    []
  );

  useEffect(() => {
    if (!chatError) return;
    // Use project's toast with Retry/Dismiss actions following color schema
    toast({
      type: 'error',
      description:
        chatError.message || 'An error occurred while generating the response.',
      actions: [
        { label: 'Retry', onClick: handleRetryOnError, primary: true },
        { label: 'Dismiss', onClick: handleDismissError },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatError]);

  const selectedModel = allowedModelMap.get(currentModelId);

  return (
    <>
      <div className="overscroll-behavior-contain flex h-dvh min-w-0 touch-pan-y flex-col bg-background">
        <ChatHeader
          chatId={id}
          isReadonly={isReadonly}
          selectedVisibilityType={initialVisibilityType}
          stagedPinnedSlugs={stagedPinnedSlugs}
          onAddStagedPin={handleAddStagedPin}
          onRemoveStagedPin={handleRemoveStagedPin}
          chatHasStarted={chatHasStartedRef.current}
          selectedAgentId={selectedAgentId}
          selectedAgentLabel={selectedAgent?.name}
          onSelectAgent={handleSelectAgent}
          stagedAllowedTools={stagedAllowedTools}
          onUpdateStagedAllowedTools={handleUpdateStagedAllowedTools}
          selectedModelId={currentModelId}
          selectedModelCapabilities={selectedModel?.capabilities ?? null}
        />

        <Messages
          chatId={id}
          isArtifactVisible={isArtifactVisible}
          isReadonly={isReadonly}
          messages={messages}
          onDeleteMessage={handleDeleteMessage}
          onDeleteMessageCascade={handleDeleteMessageCascade}
          onToggleSelectMessage={
            !isReadonly ? handleToggleSelectMessage : undefined
          }
          selectedMessageIds={selectionSet}
          isSelectionMode={isSelectionMode}
          onRegenerateAssistant={handleForkRegenerate}
          selectedModelId={currentModelId}
          status={status}
          disableRegenerate={isForking}
          allowedModels={allowedModels}
        />

        {isSelectionMode && (
          <div className="sticky bottom-[106px] z-20 w-full border-t border-border bg-background/95 shadow-sm">
            <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 text-sm">
              <span className="font-medium">
                {selectedMessageIds.length} message
                {selectedMessageIds.length === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleClearSelection}
                  variant="outline"
                  disabled={isBulkDeleting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleDeleteSelected}
                  variant="destructive"
                  disabled={isBulkDeleting}
                >
                  {isBulkDeleting ? 'Deleting…' : 'Delete selected'}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 z-10 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4">
          {!isReadonly && (
            <MultimodalInput
              attachments={attachments}
              chatId={id}
              input={input}
              messages={messages}
              onModelChange={handleModelChange}
              selectedModelId={currentModelId}
              selectedVisibilityType={visibilityType}
              sendMessage={sendMessage}
              setAttachments={setAttachments}
              setInput={setInput}
              setMessages={setMessages}
              status={status}
              stop={stop}
              usage={usage}
              allowedModels={allowedModels}
              reasoningEffort={stagedReasoningEffort}
              onReasoningEffortChange={handleReasoningEffortChange}
            />
          )}
        </div>

        {isForking && (
          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center bg-gradient-to-t from-background/80 via-background/20 to-transparent p-6">
            <div className="flex items-center gap-2 rounded-full border bg-background/90 px-4 py-2 text-sm shadow-lg backdrop-blur-md">
              <span className="relative inline-flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-primary" />
              </span>
              <span>Creating fork…</span>
            </div>
          </div>
        )}

        <Artifact
          attachments={attachments}
          chatId={id}
          input={input}
          isReadonly={isReadonly}
          messages={messages}
          onDeleteMessage={handleDeleteMessage}
          onDeleteMessageCascade={handleDeleteMessageCascade}
          onToggleSelectMessage={
            !isReadonly ? handleToggleSelectMessage : undefined
          }
          selectedMessageIds={selectionSet}
          isSelectionMode={isSelectionMode}
          selectedModelId={currentModelId}
          selectedVisibilityType={visibilityType}
          sendMessage={sendMessage}
          setAttachments={setAttachments}
          setInput={setInput}
          setMessages={setMessages}
          status={status}
          stop={stop}
          allowedModels={allowedModels}
        />
      </div>
    </>
  );
}
