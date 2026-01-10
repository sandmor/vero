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

import type { AgentPromptConfig } from '@/lib/agent-prompt';
import type { AgentSettingsValue } from '@/lib/agent-settings';
import {
  ARCHIVE_PROMPT,
  BASE_BEHAVIOR_PROMPT,
  FORMATTING_PROMPT,
  PINNED_MEMORY_TEMPLATE,
  REQUEST_ORIGIN_TEMPLATE,
  RUN_CODE_PROMPT,
} from '@/lib/ai/prompts';
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

export const DEFAULT_CHAT_SYSTEM_AGENT_SLUG = 'default-chat';

export const DEFAULT_CHAT_SYSTEM_AGENT_PROMPT: AgentPromptConfig = {
  mode: 'replace',
  joiner: '\n\n',
  blocks: [
    {
      id: 'behavior',
      title: 'Behavior',
      template: BASE_BEHAVIOR_PROMPT,
      enabled: true,
      order: 0,
      role: 'system',
    },
    {
      id: 'user-context',
      title: 'User context',
      template: `User Context:
{{#if user.name}}You are speaking with {{user.name}}. {{/if}}{{#if user.occupation}}Their occupation is {{user.occupation}}. {{/if}}{{#if user.customInstructions}}
IMPORTANT: Follow these custom instructions from the user:
{{user.customInstructions}}{{/if}}`,
      enabled: true,
      order: 1,
      role: 'system',
    },
    {
      id: 'formatting',
      title: 'Formatting expectations',
      template: FORMATTING_PROMPT,
      enabled: true,
      order: 2,
      role: 'system',
    },
    {
      id: 'run-code',
      title: 'Run code tool',
      template: `{{#if tools.runCode}}${RUN_CODE_PROMPT}{{/if}}`,
      enabled: true,
      order: 3,
      role: 'system',
    },
    {
      id: 'request-origin',
      title: 'Request origin',
      template: REQUEST_ORIGIN_TEMPLATE,
      enabled: true,
      order: 4,
      role: 'system',
    },
    {
      id: 'archive',
      title: 'Archive guidance',
      template: `{{#if tools.archive}}${ARCHIVE_PROMPT}{{/if}}`,
      enabled: true,
      order: 5,
      role: 'system',
    },
    {
      id: 'pinned-memory',
      title: 'Pinned memory',
      template: `{{#if pinnedEntriesBlock}}${PINNED_MEMORY_TEMPLATE}{{/if}}`,
      enabled: true,
      order: 6,
      role: 'system',
    },
  ],
  variables: [],
};

export const DEFAULT_CHAT_SYSTEM_AGENT_SETTINGS: SystemAgentSettings = {
  modelId: DEFAULT_CHAT_MODEL,
  prompt: DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
};

const DEFAULT_CHAT_SYSTEM_AGENT_DEFINITION: SystemAgentDefinition = {
  slug: DEFAULT_CHAT_SYSTEM_AGENT_SLUG,
  name: 'Default Chat Agent',
  description:
    'Workspace default agent used for interactive chats. Admins can tune its prompt and default model.',
  defaultSettings: DEFAULT_CHAT_SYSTEM_AGENT_SETTINGS,
};

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
  [DEFAULT_CHAT_SYSTEM_AGENT_SLUG]: DEFAULT_CHAT_SYSTEM_AGENT_DEFINITION,
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
 * List of system agent slugs for iteration.
 */
export const SYSTEM_AGENT_SLUGS = [
  DEFAULT_CHAT_SYSTEM_AGENT_SLUG,
  'title-generation',
] as const;

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
