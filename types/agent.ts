import type { Agent } from '@/lib/db/schema';

export type AgentPreset = Pick<
  Agent,
  'id' | 'name' | 'description' | 'settings'
>;
