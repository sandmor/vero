'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Agent, ChatSettings } from '@/lib/db/schema';

export function useAgent(agentId: string | undefined, initial?: Agent | null) {
  return useQuery<{ agent: Agent } | null>({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      if (!agentId) return null;
      const res = await fetch(`/api/agents/${agentId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load agent');
      return res.json() as Promise<{ agent: Agent }>;
    },
    enabled: Boolean(agentId),
    staleTime: 15_000,
    initialData: initial ? { agent: initial } : undefined,
  });
}

export function useAgents() {
  return useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to load agents');
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      settings?: ChatSettings;
    }) => {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      return res.json() as Promise<{ agent: Agent }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        name: string;
        description: string;
        settings: ChatSettings;
      }>;
    }) => {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update agent');
      return res.json() as Promise<{ agent: Agent }>;
    },
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      if (variables?.id) {
        qc.invalidateQueries({ queryKey: ['agent', variables.id] });
      }
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete agent');
      return res.json();
    },
    onSuccess: (_result, id) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      if (id) {
        qc.invalidateQueries({ queryKey: ['agent', id] });
      }
    },
  });
}
