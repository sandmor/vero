import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import type { ChatModelOption } from '@/lib/ai/models';
import type { Chat } from '@/lib/db/schema';

export type CacheCompletionMarker = {
  completeFromDate: string | null;
  completeToDate: string | null;
  hasOlderChats: boolean;
};

export type CacheMetadataPayload = {
  version: number;
  generatedAt: string;
  cacheCompletionMarker: CacheCompletionMarker;
  allowedModels: ChatModelOption[];
  // Sync tracking
  lastSyncedAt?: string;
  totalChats?: number;
};

export type SerializedAgent = {
  id: string;
  name: string;
  description: string | null;
  settings: unknown;
  userId: string;
  createdAt: string;
  updatedAt: string;
} | null;

export type SerializedChat = Omit<Chat, 'createdAt' | 'updatedAt' | 'agent'> & {
  createdAt: string;
  updatedAt: string;
  agent: SerializedAgent;
};

export type CachedChatRecord = {
  chatId: string;
  lastUpdatedAt: string;
  bootstrap: ChatBootstrapResponse;
  chat: SerializedChat;
};

// Sync API types
export type SyncRequest = {
  lastSyncedAt: string | null;
  pageSize?: number;
  cursor?: string | null;
};

export type SyncResponse = {
  upserts: CachedChatRecord[];
  deletions: string[];
  serverTimestamp: string;
  hasMore: boolean;
  nextCursor: string | null;
  metadata?: CacheMetadataPayload;
  totalChats: number;
};
