/**
 * Prompt building utilities for system agents.
 *
 * System agents use a simplified prompt configuration compared to regular agents
 * since they perform specific tasks (like title generation) rather than interactive chats.
 */

import {
  normalizeAgentPromptConfig,
  type AgentPromptConfig,
} from '@/lib/agent-prompt';
import type { SystemAgentSettings } from './system-agents';

/**
 * Build a plain text system prompt from a system agent's settings.
 * Returns null if no valid prompt blocks are configured.
 */
export function buildPromptFromSystemAgent(
  settings: SystemAgentSettings | null | undefined
): string | null {
  if (!settings?.prompt) {
    return null;
  }

  const config = normalizeAgentPromptConfig(settings.prompt);
  return buildPromptFromConfig(config);
}

/**
 * Build a plain text prompt from an AgentPromptConfig.
 * Concatenates enabled blocks with their configured joiner.
 */
export function buildPromptFromConfig(
  config: AgentPromptConfig
): string | null {
  const enabledBlocks = config.blocks.filter(
    (block) => block.enabled && block.template.trim().length > 0
  );

  if (enabledBlocks.length === 0) {
    return null;
  }

  // Sort by order
  const sortedBlocks = [...enabledBlocks].sort((a, b) => a.order - b.order);

  // Join templates
  const joiner = config.joiner || '\n\n';
  const prompt = sortedBlocks
    .map((block) => block.template.trim())
    .join(joiner);

  return prompt || null;
}
