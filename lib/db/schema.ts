import type { Prisma } from '../../generated/prisma-client';
import type { AppUsage } from '../usage';
import type { VisibilityType } from '@/components/visibility-selector';
import type { ArtifactKind } from '@/components/artifact';
import type { AgentPromptConfig } from '@/lib/agent-prompt';
import type { ChatToolId } from '@/lib/ai/tool-ids';

// Re-export Prisma model types with the same names previously used across the app
export type User = Prisma.UserGetPayload<{}>;
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

export type Chat = Omit<
  Prisma.ChatGetPayload<{ include: { agent: true } }>,
  'lastContext' | 'visibility' | 'settings'
> & {
  lastContext: AppUsage | null;
  visibility: VisibilityType;
  settings: ChatSettings | null;
};
export type Agent = Prisma.AgentGetPayload<{}>;
export type Document = Omit<Prisma.DocumentGetPayload<{}>, 'kind'> & {
  kind: ArtifactKind;
};
export type Suggestion = Prisma.SuggestionGetPayload<{}>;
export type Stream = Prisma.StreamGetPayload<{}>;
export type ArchiveEntry = Prisma.ArchiveEntryGetPayload<{}>;
export type ArchiveLink = Prisma.ArchiveLinkGetPayload<{}>;

// Message is the current message table used by the app
export type DBMessage = Prisma.MessageGetPayload<{}>;

export interface MessageTreeNode extends DBMessage {
  pathText: string;
  parentPath: string | null;
  depth: number;
  children: MessageTreeNode[];
}

export interface MessageTreeResult {
  tree: MessageTreeNode[];
  nodes: MessageTreeNode[];
  branch: MessageTreeNode[];
}
