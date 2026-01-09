'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SystemAgent } from '@/lib/db/schema';
import type { SystemAgentSettings } from '@/lib/ai/system-agents';

/**
 * Update a system agent's settings.
 */
export function useUpdateSystemAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slug,
      settings,
    }: {
      slug: string;
      settings: SystemAgentSettings;
    }) => {
      const res = await fetch(`/api/admin/system-agents/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error('Failed to update system agent');
      return res.json() as Promise<{ agent: SystemAgent }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-agents'] });
    },
  });
}

/**
 * Reset a system agent to its default settings.
 */
export function useResetSystemAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      const res = await fetch(`/api/admin/system-agents/${slug}?action=reset`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to reset system agent');
      return res.json() as Promise<{ agent: SystemAgent }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-agents'] });
    },
  });
}
