import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/toast';
import {
  useChatSettings as useChatSettingsQuery,
  useUpdateModelId,
  useUpdateReasoningEffort,
} from '@/hooks/use-chat-settings';
import {
  normalizeAllowedTools,
  normalizeModelId,
  normalizePinnedEntries,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { fetchWithErrorHandlers, isValidUUID } from '@/lib/utils';
import type { ChatModelOption } from '@/lib/ai/models';
import type { ChatToolId } from '@/lib/ai/tool-ids';
import type { ChatSettings } from '@/lib/db/schema';
import type { AgentPreset } from '../chat-agent-selector';

export type UseChatPreferencesArgs = {
  chatId: string;
  allowedModels: ChatModelOption[];
  initialChatModel: string;
  initialMessagesCount: number;
  initialSettings?: ChatSettings | null;
  initialAgent?: AgentPreset | null;
  requestedAgentId?: string;
};

export function useChatPreferences({
  chatId,
  allowedModels,
  initialChatModel,
  initialMessagesCount,
  initialSettings = null,
  initialAgent = null,
  requestedAgentId,
}: UseChatPreferencesArgs) {
  const allowedModelIds = useMemo(
    () => allowedModels.map((model) => model.id),
    [allowedModels]
  );

  const allowedModelMap = useMemo(
    () => new Map(allowedModels.map((model) => [model.id, model])),
    [allowedModels]
  );

  const resolvedInitialAgent = initialAgent ?? null;
  const initialAgentSettings = (resolvedInitialAgent?.settings ??
    null) as ChatSettings | null;

  const initialReasoningEffort = normalizeReasoningEffort(
    initialSettings?.reasoningEffort ??
      initialAgentSettings?.reasoningEffort ??
      undefined
  );

  const initialModelId = useMemo(() => {
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
  }, [
    allowedModelIds,
    initialAgentSettings?.modelId,
    initialChatModel,
    initialSettings?.modelId,
  ]);

  const [currentModelId, setCurrentModelId] = useState(initialModelId);
  const currentModelIdRef = useRef(currentModelId);

  const initialAgentId = useMemo(() => {
    if (resolvedInitialAgent?.id && isValidUUID(resolvedInitialAgent.id)) {
      return resolvedInitialAgent.id;
    }
    if (requestedAgentId && isValidUUID(requestedAgentId)) {
      return requestedAgentId;
    }
    return undefined;
  }, [requestedAgentId, resolvedInitialAgent?.id]);

  const [selectedAgent, setSelectedAgent] = useState<AgentPreset | null>(
    resolvedInitialAgent
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    initialAgentId
  );
  const stagedAgentIdRef = useRef<string | undefined>(initialAgentId);

  const [stagedPinnedSlugs, setStagedPinnedSlugs] = useState<string[]>(() =>
    normalizePinnedEntries(
      initialSettings?.pinnedEntries ??
        initialAgentSettings?.pinnedEntries ??
        []
    )
  );
  const stagedPinnedSlugsRef = useRef<string[]>(stagedPinnedSlugs);

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

  const [stagedReasoningEffort, setStagedReasoningEffort] = useState<
    'low' | 'medium' | 'high' | undefined
  >(() => initialReasoningEffort ?? undefined);
  const stagedReasoningEffortRef = useRef<
    'low' | 'medium' | 'high' | undefined
  >(stagedReasoningEffort);

  const chatHasStartedRef = useRef(initialMessagesCount > 0);
  useEffect(() => {
    if (initialMessagesCount > 0) {
      chatHasStartedRef.current = true;
    }
  }, [initialMessagesCount]);

  const [shouldFetchSettings, setShouldFetchSettings] = useState(
    initialMessagesCount > 0
  );

  const { data: chatSettingsData } = useChatSettingsQuery(
    shouldFetchSettings ? chatId : undefined
  );
  const updateReasoningEffortMutation = useUpdateReasoningEffort(chatId);
  const updateModelIdMutation = useUpdateModelId(chatId);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

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
    stagedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    const settings = chatSettingsData?.settings;
    if (!settings) return;
    if (!chatHasStartedRef.current) return;

    const normalizedEffort = normalizeReasoningEffort(settings.reasoningEffort);
    if (normalizedEffort !== stagedReasoningEffortRef.current) {
      setStagedReasoningEffort(normalizedEffort ?? undefined);
    }

    const normalizedModel = normalizeModelId(settings.modelId);
    if (
      normalizedModel &&
      allowedModelIds.includes(normalizedModel) &&
      normalizedModel !== currentModelIdRef.current
    ) {
      setCurrentModelId(normalizedModel);
    }
  }, [allowedModelIds, chatSettingsData?.settings]);

  useEffect(() => {
    if (chatHasStartedRef.current) return;

    const agentSettings = (selectedAgent?.settings ??
      null) as ChatSettings | null;

    if (selectedAgent) {
      setStagedPinnedSlugs(
        normalizePinnedEntries(agentSettings?.pinnedEntries ?? [])
      );
      setStagedAllowedTools(normalizeAllowedTools(agentSettings?.tools?.allow));
      const normalizedEffort = normalizeReasoningEffort(
        agentSettings?.reasoningEffort
      );
      setStagedReasoningEffort(normalizedEffort ?? undefined);
      stagedReasoningEffortRef.current = normalizedEffort ?? undefined;
      const normalizedModel = normalizeModelId(agentSettings?.modelId);
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
  }, [allowedModelIds, initialModelId, initialReasoningEffort, selectedAgent]);

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
            body: JSON.stringify({ chatId, agentId: normalizedAgentId }),
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

        const agentSettings = (agent?.settings ?? null) as ChatSettings | null;
        setStagedPinnedSlugs(
          normalizePinnedEntries(agentSettings?.pinnedEntries ?? [])
        );
        setStagedAllowedTools(
          normalizeAllowedTools(agentSettings?.tools?.allow)
        );
      } catch (error) {
        console.error('Failed to apply chat agent selection', error);
        toast({
          type: 'error',
          description: 'Failed to apply chat agent selection',
        });
      }
    },
    [chatId, selectedAgentId]
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

  const markChatAsStarted = useCallback(() => {
    if (chatHasStartedRef.current) return;
    chatHasStartedRef.current = true;
    setShouldFetchSettings(true);
    setStagedPinnedSlugs([]);
    stagedPinnedSlugsRef.current = [];
    setStagedAllowedTools(undefined);
    stagedAllowedToolsRef.current = undefined;
  }, []);

  const selectedModel = allowedModelMap.get(currentModelId) ?? null;

  return {
    allowedModelIds,
    allowedModelMap,
    currentModelId,
    currentModelIdRef,
    selectedModel,
    selectedAgent,
    selectedAgentId,
    stagedAgentIdRef,
    stagedPinnedSlugs,
    stagedPinnedSlugsRef,
    stagedAllowedTools,
    stagedAllowedToolsRef,
    stagedReasoningEffort,
    stagedReasoningEffortRef,
    chatHasStartedRef,
    markChatAsStarted,
    handleSelectAgent,
    handleModelChange,
    handleReasoningEffortChange,
    handleAddStagedPin,
    handleRemoveStagedPin,
    handleUpdateStagedAllowedTools,
  } as const;
}

export type ChatPreferences = ReturnType<typeof useChatPreferences>;
