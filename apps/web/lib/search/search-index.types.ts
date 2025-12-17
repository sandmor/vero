export type SerializedIndexJSON = Record<string, string>;

export type SortOption = 'relevance' | 'newest' | 'oldest' | 'title';

export type IndexedChatMessage = {
  id: string;
  createdAt: string;
  parts?: unknown;
};

export type IndexableChat = {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt: string;
  messages: IndexedChatMessage[];
};

export type ChatIndexMeta = {
  chatDocId: string;
  messageDocIds: string[];
  lastIndexedAt: string;
  lastUpdatedAt: string;
};

export type ChatDoc = {
  id: string;
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  type: 'chat';
};

export type MessageDoc = {
  id: string;
  chatId: string;
  chatTitle: string;
  content: string;
  createdAt: string;
  type: 'message';
};

export type SearchIndexSnapshot = {
  version: 1;
  chatIndex: SerializedIndexJSON;
  messageIndex: SerializedIndexJSON;
  chatDocs: Record<string, ChatDoc>;
  messageDocs: Record<string, MessageDoc>;
  chatMeta: Record<string, ChatIndexMeta>;
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
  | ({ type: 'loaded' } & WorkerResponseBase)
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
