import type { Prisma } from '@virid/db';
import type { AppUsage } from '../usage';
import type { VisibilityType } from '@/components/visibility-selector';

import type { AgentPromptConfig } from '@/lib/agent-prompt';
import type { ChatToolId } from '@/lib/ai/tool-ids';

// User preferences interface
export interface UserPreferences {
  name?: string;
  occupation?: string;
  customInstructions?: string;
}

// Re-export Prisma model types with the same names previously used across the app
export type User = Prisma.UserGetPayload<{}> & {
  preferences: UserPreferences | null;
};

// Override Chat type to narrow JSON lastContext to our runtime shape
// ChatSettings: forward-compatible container for per-chat configuration.
// pinnedEntries: cached list of currently pinned archive entry slugs (authoritative source remains junction table)
// tools.allow: optional allow-list of tool identifiers; if absent => all tools enabled.
// modelId: persistent chat-level model preference (provider:model slug)
// reasoningEffort: controls how much computational effort the model uses for reasoning (low, medium, high)
// prompt: optional agent-defined prompt configuration (blocks, variables, join behaviour)
export interface ChatSettings {
  pinnedEntries?: string[]; // denormalized convenience cache
  tools?: {
    allow?: ChatToolId[]; // tool ids
  };
  modelId?: string; // composite provider:model id
  reasoningEffort?: 'low' | 'medium' | 'high'; // reasoning effort level
  prompt?: AgentPromptConfig;
}

type PrismaChatWithRelations = Prisma.ChatGetPayload<{
  include: { agent: true };
}>;

export type Chat = Omit<
  PrismaChatWithRelations,
  'lastContext' | 'visibility' | 'settings'
> & {
  lastContext: AppUsage | null;
  visibility: VisibilityType;
  settings: ChatSettings | null;
};
export type Agent = Prisma.AgentGetPayload<{}>;

export type Stream = Prisma.StreamGetPayload<{}>;
export type ArchiveEntry = Prisma.ArchiveEntryGetPayload<{}>;
export type ArchiveLink = Prisma.ArchiveLinkGetPayload<{}>;
export type SystemAgent = Prisma.SystemAgentGetPayload<{}>;

// Message is the current message table used by the app
export type DBMessage = Prisma.MessageGetPayload<{}>;

export interface MessageTreeNode extends DBMessage {
  pathText: string;
  parentPath: string | null;
  depth: number;
  siblingsCount: number; // including self
  siblingIndex: number; // zero-based index among siblings
  children: MessageTreeNode[];
}

export interface MessageTreeResult {
  tree: MessageTreeNode[];
  nodes: MessageTreeNode[];
  branch: MessageTreeNode[];
  rootMessageIndex: number | null;
}
