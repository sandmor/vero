'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatSettings } from '@/lib/db/schema';
import type { ChatToolId } from '@/lib/ai/tool-ids';

export function useChatSettings(chatId: string | undefined) {
  return useQuery<{ settings: ChatSettings }>({
    queryKey: ['chat', 'settings', chatId],
    enabled: !!chatId,
    queryFn: async () => {
      if (!chatId) return { settings: {} };
      const res = await fetch(
        `/api/chat/settings?chatId=${encodeURIComponent(chatId)}`
      );
      if (!res.ok) throw new Error('Failed to load chat settings');
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useUpdateAllowedTools(chatId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tools: ChatToolId[] | null) => {
      if (!chatId) throw new Error('Missing chatId');
      const body = { chatId, allowedTools: tools };
      const res = await fetch('/api/chat/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update tools');
      return res.json() as Promise<{ settings: ChatSettings }>;
    },
    onMutate: async (tools) => {
      if (!chatId) return;
      await qc.cancelQueries({ queryKey: ['chat', 'settings', chatId] });
      const prev = qc.getQueryData<{ settings: ChatSettings }>([
        'chat',
        'settings',
        chatId,
      ]);
      const normalized = tools === null ? undefined : tools;
      const nextSettings: ChatSettings = {
        ...(prev?.settings || {}),
        tools: { allow: normalized },
      };
      qc.setQueryData(['chat', 'settings', chatId], { settings: nextSettings });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (chatId && context?.prev) {
        qc.setQueryData(['chat', 'settings', chatId], context.prev);
      }
    },
    onSuccess: (data) => {
      if (chatId) qc.setQueryData(['chat', 'settings', chatId], data);
    },
  });
}

export function useUpdateReasoningEffort(chatId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (effort: 'low' | 'medium' | 'high' | null) => {
      if (!chatId) throw new Error('Missing chatId');
      const body = { chatId, reasoningEffort: effort };
      const res = await fetch('/api/chat/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update reasoning effort');
      return res.json() as Promise<{ settings: ChatSettings }>;
    },
    onMutate: async (effort) => {
      if (!chatId) return;
      await qc.cancelQueries({ queryKey: ['chat', 'settings', chatId] });
      const prev = qc.getQueryData<{ settings: ChatSettings }>([
        'chat',
        'settings',
        chatId,
      ]);
      const normalized = effort === null ? undefined : effort;
      const nextSettings: ChatSettings = {
        ...(prev?.settings || {}),
        reasoningEffort: normalized,
      };
      qc.setQueryData(['chat', 'settings', chatId], { settings: nextSettings });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (chatId && context?.prev) {
        qc.setQueryData(['chat', 'settings', chatId], context.prev);
      }
    },
    onSuccess: (data) => {
      if (chatId) qc.setQueryData(['chat', 'settings', chatId], data);
    },
  });
}

export function useUpdateModelId(chatId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string | null) => {
      if (!chatId) throw new Error('Missing chatId');
      const body = { chatId, modelId };
      const res = await fetch('/api/chat/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update model');
      return res.json() as Promise<{ settings: ChatSettings }>;
    },
    onMutate: async (modelId) => {
      if (!chatId) return;
      await qc.cancelQueries({ queryKey: ['chat', 'settings', chatId] });
      const prev = qc.getQueryData<{ settings: ChatSettings }>([
        'chat',
        'settings',
        chatId,
      ]);
      const normalized = modelId === null ? undefined : modelId;
      const nextSettings: ChatSettings = {
        ...(prev?.settings || {}),
      };
      if (normalized === undefined) {
        delete nextSettings.modelId;
      } else {
        nextSettings.modelId = normalized;
      }
      qc.setQueryData(['chat', 'settings', chatId], { settings: nextSettings });
      return { prev };
    },
    onError: (_err, _vars, context) => {
      if (chatId && context?.prev) {
        qc.setQueryData(['chat', 'settings', chatId], context.prev);
      }
    },
    onSuccess: (data) => {
      if (chatId) qc.setQueryData(['chat', 'settings', chatId], data);
    },
  });
}
