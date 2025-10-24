'use client';

import { useQuery } from '@tanstack/react-query';
import {
  useChatSettings as useChatSettingsQuery,
  useUpdateModelId,
  useUpdateReasoningEffort,
} from '@/hooks/use-chat-settings';
import {
  normalizeAllowedTools,
  normalizePinnedEntries,
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import type { ChatSettings } from '@/lib/db/schema';
import { isValidUUID } from '@/lib/utils';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { AgentPreset } from '../chat-agent-selector';
import { toast } from '../toast';
import { fetchWithErrorHandlers } from '@/lib/utils';
import type { ChatModelOption } from '@/lib/ai/models';
import type { ChatToolId } from '@/lib/ai/tool-ids';

export function useChatSettings({
  id,
  initialSettings,
  initialAgent,
  initialChatModel,
  allowedModels,
  chatHasStarted,
  agentId,
}: {
  id: string;
  initialSettings?: ChatSettings | null;
  initialAgent?: AgentPreset | null;
  initialChatModel: string;
  allowedModels: ChatModelOption[];
  chatHasStarted: React.MutableRefObject<boolean>;
  agentId?: string;
}) {
  const resolvedInitialAgent = initialAgent ?? null;
  const initialAgentSettings = (resolvedInitialAgent?.settings ??
    null) as ChatSettings | null;

  const allowedModelIds = useMemo(
    () => allowedModels.map((model) => model.id),
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

  const [shouldFetchSettings, setShouldFetchSettings] = useState(
    chatHasStarted.current
  );
  const { data: chatSettingsData } = useChatSettingsQuery(
    shouldFetchSettings ? id : undefined
  );
  const updateReasoningEffortMutation = useUpdateReasoningEffort(id);
  const updateModelIdMutation = useUpdateModelId(id);

  useEffect(() => {
    stagedPinnedSlugsRef.current = stagedPinnedSlugs;
  }, [stagedPinnedSlugs]);

  useEffect(() => {
    stagedAllowedToolsRef.current = stagedAllowedTools;
  }, [stagedAllowedTools]);

  useEffect(() => {
    stagedReasoningEffortRef.current = stagedReasoningEffort;
  }, [stagedReasoningEffort]);

  const settingsVersionRef = useRef(0);
  useEffect(() => {
    const settings = chatSettingsData?.settings;
    if (!settings) return;

    if (!chatHasStarted.current) return;

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
  }, [chatSettingsData?.settings, allowedModelIds, chatHasStarted]);

  useEffect(() => {
    stagedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  useEffect(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);

  useEffect(() => {
    if (chatHasStarted.current) return;
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
    chatHasStarted,
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

      const shouldPersistSelection = userInitiated && chatHasStarted.current;

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
    [id, selectedAgentId, chatHasStarted]
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

      if (!chatHasStarted.current) {
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
    [allowedModelIds, updateModelIdMutation, chatHasStarted]
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

      if (!chatHasStarted.current) {
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
    [updateReasoningEffortMutation, chatHasStarted]
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

  const onChatStart = () => {
    chatHasStarted.current = true;
    setShouldFetchSettings(true);
    setStagedPinnedSlugs([]);
    stagedPinnedSlugsRef.current = [];
    setStagedAllowedTools(undefined);
    stagedAllowedToolsRef.current = undefined;
  };

  return {
    currentModelId,
    selectedAgent,
    selectedAgentId,
    stagedPinnedSlugs,
    stagedAllowedTools,
    stagedReasoningEffort,
    handleSelectAgent,
    handleModelChange,
    handleReasoningEffortChange,
    handleAddStagedPin,
    handleRemoveStagedPin,
    handleUpdateStagedAllowedTools,
    onChatStart,
  };
}
