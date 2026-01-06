/**
 * Search Index Types
 *
 * Types for the FlexSearch-based search system with encrypted IndexedDB storage.
 */

export type SortOption = 'relevance' | 'newest' | 'oldest' | 'title';

/**
 * Message structure for indexing
 */
export type IndexedChatMessage = {
  id: string;
  createdAt: string;
  parts?: unknown;
};

/**
 * Chat structure passed from the main thread for indexing
 */
export type IndexableChat = {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt: string;
  messages: IndexedChatMessage[];
};

/**
 * Chat document stored in the FlexSearch index
 */
export type ChatDoc = {
  id: string;
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  type: 'chat';
};

/**
 * Message document stored in the FlexSearch index
 */
export type MessageDoc = {
  id: string;
  chatId: string;
  chatTitle: string;
  content: string;
  createdAt: string;
  type: 'message';
};

export type WorkerSearchOptions = {
  sortBy: SortOption;
  dateFilter?: { after?: string; before?: string } | null;
  searchMessages?: boolean;
  limit?: number;
};

export type WorkerChatResult = {
  chatId: string;
  score: number;
};

export type HighlightRange = {
  start: number;
  end: number;
};

export type WorkerMessageResult = {
  messageId: string;
  chatId: string;
  chatTitle: string;
  content: string;
  createdAt: string;
  score: number;
  snippet: string;
  highlights: HighlightRange[];
};

export type WorkerRequest =
  | { type: 'init'; encryptionKey: string; requestId: string }
  | { type: 'load'; requestId: string }
  | {
    type: 'sync';
    chats: IndexableChat[];
    requestId: string;
  }
  | {
    type: 'search';
    query: string;
    options: WorkerSearchOptions;
    knownChatIds: string[];
    requestId: string;
  };

export type WorkerPayload =
  | { type: 'init'; encryptionKey: string }
  | { type: 'load' }
  | { type: 'sync'; chats: IndexableChat[] }
  | {
    type: 'search';
    query: string;
    options: WorkerSearchOptions;
    knownChatIds: string[];
  };

type WorkerResponseBase = { requestId: string };

export type WorkerResponse =
  | ({ type: 'initialized' } & WorkerResponseBase)
  | ({ type: 'loaded'; fromStorage?: boolean; chatCount?: number } & WorkerResponseBase)
  | ({
    type: 'synced';
    changed: boolean;
  } & WorkerResponseBase)
  | ({
    type: 'searchResults';
    chatResults: WorkerChatResult[];
    messageResults: WorkerMessageResult[];
  } & WorkerResponseBase)
  | ({ type: 'keepalive' } & WorkerResponseBase)
  | ({ type: 'error'; message: string } & WorkerResponseBase);
