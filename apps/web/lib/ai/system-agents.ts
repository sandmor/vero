/**
 * System Agent Definitions
 *
 * System agents are platform-level AI agents that perform special functions
 * (like title generation). Unlike user agents, they:
 * - Are not owned by any user
 * - Cannot be deleted (only reset to defaults)
 * - Can only be managed by admins
 * - Don't have associated chats
 */

import type { AgentSettingsValue } from '@/lib/agent-settings';
import type { AgentPromptConfig } from '@/lib/agent-prompt';
import { DEFAULT_CHAT_MODEL } from './models';

/**
 * Definition of a system agent including its default configuration.
 * The defaults are stored in code and used for:
 * 1. Initial seeding when the system agent doesn't exist in DB
 * 2. Reset functionality to restore original settings
 */
export interface SystemAgentDefinition {
  slug: string;
  name: string;
  description: string;
  defaultSettings: SystemAgentSettings;
}

/**
 * Settings specific to system agents.
 * Similar to AgentSettingsValue but without chat-specific fields like pinnedEntries.
 */
export interface SystemAgentSettings {
  modelId?: string;
  prompt: AgentPromptConfig;
}

/**
 * Convert SystemAgentSettings to the broader AgentSettingsValue format
 * for compatibility with shared components.
 */
export function systemAgentSettingsToAgentSettings(
  settings: SystemAgentSettings
): AgentSettingsValue {
  return {
    pinnedEntries: [],
    allowedTools: [],
    modelId: settings.modelId,
    reasoningEffort: undefined,
    prompt: settings.prompt,
  };
}

/**
 * Extract SystemAgentSettings from AgentSettingsValue.
 */
export function agentSettingsToSystemAgentSettings(
  settings: AgentSettingsValue
): SystemAgentSettings {
  return {
    modelId: settings.modelId,
    prompt: settings.prompt,
  };
}

// ============================================================================
// System Agent Definitions
// ============================================================================

const TITLE_GENERATION_PROMPT: AgentPromptConfig = {
  mode: 'replace',
  joiner: '\n',
  blocks: [
    {
      id: 'title-gen-main',
      title: 'Title Generation Instructions',
      template: `- you will generate a short title based on the conversation content
- ensure it is not more than 80 characters long
- the title should be a summary of the main topic or question being discussed
- focus on the user's intent and the conversation's core subject
- do not surround the title with quotes
- do not include any introductory phrases like "Title:" or "Summary:"
- do not use markdown. The title must be in plain text, only emojis are allowed`,
      enabled: true,
      order: 0,
      role: 'system',
    },
  ],
  variables: [],
};

/**
 * Registry of all system agents.
 * Add new system agents here as the platform grows.
 */
export const SYSTEM_AGENTS: Record<string, SystemAgentDefinition> = {
  'title-generation': {
    slug: 'title-generation',
    name: 'Title Generation',
    description:
      'Generates concise, descriptive titles for chat conversations based on their content.',
    defaultSettings: {
      modelId: DEFAULT_CHAT_MODEL,
      prompt: TITLE_GENERATION_PROMPT,
    },
  },
};

/**
 * List of all system agent slugs for iteration.
 */
export const SYSTEM_AGENT_SLUGS = Object.keys(SYSTEM_AGENTS) as Array<
  keyof typeof SYSTEM_AGENTS
>;

/**
 * Get a system agent definition by slug.
 */
export function getSystemAgentDefinition(
  slug: string
): SystemAgentDefinition | undefined {
  return SYSTEM_AGENTS[slug];
}

/**
 * Get the default settings for a system agent.
 */
export function getSystemAgentDefaults(
  slug: string
): SystemAgentSettings | undefined {
  return SYSTEM_AGENTS[slug]?.defaultSettings;
}
