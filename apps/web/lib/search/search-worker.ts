/**
 * FlexSearch Worker with Encrypted Persistent Storage
 *
 * This worker provides a search index that:
 * 1. Uses FlexSearch's Document index for chat and message searching
 * 2. Persists data to encrypted IndexedDB for instant search on app load
 * 3. Coordinates with other tabs via BroadcastChannel
 * 4. Supports advanced Lucene-like query parsing
 * 5. Runs entirely off the main thread for non-blocking search
 *
 * Architecture:
 * - On init: Initialize encryption and create fresh indexes
 * - On load: Load existing index from encrypted IndexedDB
 * - On sync: Update in-memory index + persist changes + notify other tabs
 * - On cross-tab notification: Reload index from IndexedDB
 * - Search always uses in-memory FlexSearch for speed
 */

/// <reference lib="webworker" />

import { Document, type DocumentOptions } from 'flexsearch';
import {
  getSearchStorage,
  type ChatIndexEntry,
  type MessageIndexEntry,
} from '@/lib/search/search-storage';
import {
  type SearchTabCoordinator,
  createSearchCoordinator,
} from '@/lib/search/search-coordinator';
import {
  parseAdvancedQuery,
  matchesAllPhrases,
  extractTerms,
  type QueryNode,
  type ParsedAdvancedQuery,
} from '@/lib/search/query-parser';
import type {
  ChatDoc,
  MessageDoc,
  WorkerSearchOptions,
  HighlightRange,
  WorkerRequest,
  WorkerResponse,
} from '@/lib/search/search-index.types';

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_SNIPPET_LENGTH = 140;

/**
 * Chat index configuration - optimized for title search
 */
const chatIndexOptions: DocumentOptions<ChatDoc> = {
  document: {
    id: 'id',
    index: ['title'],
    store: ['id', 'chatId', 'title', 'createdAt', 'updatedAt', 'type'],
  },
  tokenize: 'tolerant',
  preset: 'match',
  context: true,
};

/**
 * Message index configuration - optimized for content and chat title search
 */
const messageIndexOptions: DocumentOptions<MessageDoc> = {
  document: {
    id: 'id',
    index: ['content', 'chatTitle'],
    store: ['id', 'chatId', 'chatTitle', 'content', 'createdAt', 'type'],
  },
  tokenize: 'tolerant',
  preset: 'match',
  context: true,
};

// ============================================================================
// State
// ============================================================================

let chatIndex: Document<ChatDoc> | null = null;
let messageIndex: Document<MessageDoc> | null = null;
let coordinator: SearchTabCoordinator | null = null;
let initialized = false;
let indexLoaded = false;

// In-memory document tracking for incremental sync and storage
const chatMeta = new Map<
  string,
  { docId: string; lastUpdatedAt: string; messageDocIds: string[] }
>();

// ============================================================================
// Utility Functions
// ============================================================================

function chatDocId(chatId: string): string {
  return `chat:${chatId}`;
}

function messageDocId(chatId: string, messageId: string): string {
  return `msg:${chatId}:${messageId}`;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function extractMessageContent(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part) =>
        part && typeof part === 'object' && (part as any).type === 'text'
    )
    .map((part) => {
      const text = (part as any).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join(' ');
}

// ============================================================================
// Snippet Generation
// ============================================================================

function findAllMatches(
  text: string,
  term: string
): { start: number; end: number; score: number }[] {
  const matches: { start: number; end: number; score: number }[] = [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  let index = 0;
  while ((index = lowerText.indexOf(lowerTerm, index)) !== -1) {
    let score = lowerTerm.length;
    if (index === 0 || /\W/.test(text[index - 1])) score += 5;
    const endIndex = index + lowerTerm.length;
    if (endIndex === text.length || /\W/.test(text[endIndex])) score += 5;
    matches.push({ start: index, end: endIndex, score });
    index += 1;
  }

  return matches;
}

function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function buildSnippet(
  content: string,
  parsedQuery: ParsedAdvancedQuery,
  snippetLength: number = DEFAULT_SNIPPET_LENGTH
): { snippet: string; highlights: HighlightRange[] } {
  if (!content) {
    return { snippet: '', highlights: [] };
  }

  const normalizedContent = content.trim().replace(/\s+/g, ' ');
  if (!normalizedContent) {
    return { snippet: '', highlights: [] };
  }

  const phrases = parsedQuery.phrases;
  const terms = extractTerms(parsedQuery.ast);
  const searchTerms = [
    ...phrases,
    ...terms.filter(
      (t) => !phrases.some((p) => p.toLowerCase().includes(t.toLowerCase()))
    ),
  ];

  if (searchTerms.length === 0) {
    const snippet =
      normalizedContent.length > snippetLength
        ? `${normalizedContent.slice(0, snippetLength)}...`
        : normalizedContent;
    return { snippet, highlights: [] };
  }

  type MatchWithTerm = {
    start: number;
    end: number;
    score: number;
    term: string;
  };
  const allMatches: MatchWithTerm[] = [];

  for (const term of searchTerms) {
    const matches = findAllMatches(normalizedContent, term);
    for (const match of matches) {
      const isPhraseMatch = phrases.includes(term);
      allMatches.push({
        ...match,
        score: match.score + (isPhraseMatch ? 10 : 0),
        term,
      });
    }
  }

  if (allMatches.length === 0) {
    const snippet =
      normalizedContent.length > snippetLength
        ? `${normalizedContent.slice(0, snippetLength)}...`
        : normalizedContent;
    return { snippet, highlights: [] };
  }

  allMatches.sort((a, b) => b.score - a.score);
  const bestMatch = allMatches[0];

  const matchCenter = Math.floor((bestMatch.start + bestMatch.end) / 2);
  const halfWindow = Math.floor(snippetLength / 2);

  let windowStart = Math.max(0, matchCenter - halfWindow);
  let windowEnd = Math.min(normalizedContent.length, matchCenter + halfWindow);

  if (bestMatch.start < windowStart) {
    windowStart = bestMatch.start;
    windowEnd = Math.min(normalizedContent.length, windowStart + snippetLength);
  }
  if (bestMatch.end > windowEnd) {
    windowEnd = bestMatch.end;
    windowStart = Math.max(0, windowEnd - snippetLength);
  }

  if (windowStart > 0) {
    const spaceAfter = normalizedContent.indexOf(' ', windowStart);
    if (spaceAfter !== -1 && spaceAfter < windowStart + 15) {
      windowStart = spaceAfter + 1;
    }
  }
  if (windowEnd < normalizedContent.length) {
    const spaceBefore = normalizedContent.lastIndexOf(' ', windowEnd);
    if (spaceBefore !== -1 && spaceBefore > windowEnd - 15) {
      windowEnd = spaceBefore;
    }
  }

  let snippet = normalizedContent.slice(windowStart, windowEnd);
  const prefixAdded = windowStart > 0;
  const suffixAdded = windowEnd < normalizedContent.length;

  if (prefixAdded) snippet = `...${snippet}`;
  if (suffixAdded) snippet = `${snippet}...`;

  const prefixOffset = prefixAdded ? 3 : 0;
  const highlights: HighlightRange[] = [];

  for (const match of allMatches) {
    if (match.end > windowStart && match.start < windowEnd) {
      const highlightStart =
        Math.max(0, match.start - windowStart) + prefixOffset;
      const highlightEnd =
        Math.min(windowEnd - windowStart, match.end - windowStart) +
        prefixOffset;
      highlights.push({ start: highlightStart, end: highlightEnd });
    }
  }

  return {
    snippet,
    highlights: mergeHighlightRanges(highlights),
  };
}

// ============================================================================
// Search Logic
// ============================================================================

function getIdsFromResults(results: any[]): Set<string> {
  const ids = new Set<string>();
  for (const fieldResult of results) {
    if (fieldResult && Array.isArray(fieldResult.result)) {
      for (const id of fieldResult.result) {
        ids.add(String(id));
      }
    }
  }
  return ids;
}

function setIntersection<T>(...sets: Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set();
  if (sets.length === 1) return new Set(sets[0]);

  const [first, ...rest] = sets;
  const result = new Set<T>();

  for (const item of first) {
    if (rest.every((set) => set.has(item))) {
      result.add(item);
    }
  }

  return result;
}

function setUnion<T>(...sets: Set<T>[]): Set<T> {
  const result = new Set<T>();
  for (const set of sets) {
    for (const item of set) {
      result.add(item);
    }
  }
  return result;
}

function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of setA) {
    if (!setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

async function searchQuery(
  index: Document<any>,
  query: string,
  field?: string
): Promise<Set<string>> {
  if (!query.trim()) return new Set();

  const results = await index.searchAsync(query, {
    suggest: true,
    limit: 1000,
    ...(field ? { pluck: field } : {}),
  });

  return getIdsFromResults(results);
}

async function executeAstSearch(
  index: Document<any>,
  node: QueryNode | null,
  field?: string,
  allDocIds?: Set<string>
): Promise<Set<string>> {
  if (!node) return new Set();

  switch (node.type) {
    case 'term':
      return searchQuery(index, node.value, field);

    case 'phrase':
      return searchQuery(index, node.value, field);

    case 'and': {
      if (node.children.length === 0) return new Set();
      const childResults = await Promise.all(
        node.children.map((child) =>
          executeAstSearch(index, child, field, allDocIds)
        )
      );
      return setIntersection(...childResults);
    }

    case 'or': {
      if (node.children.length === 0) return new Set();
      const childResults = await Promise.all(
        node.children.map((child) =>
          executeAstSearch(index, child, field, allDocIds)
        )
      );
      return setUnion(...childResults);
    }

    case 'not': {
      const negatedResults = await executeAstSearch(
        index,
        node.child,
        field,
        allDocIds
      );
      if (allDocIds && allDocIds.size > 0) {
        return setDifference(allDocIds, negatedResults);
      }
      return new Set();
    }

    case 'field': {
      return executeAstSearch(index, node.child, node.field, allDocIds);
    }
  }
}

async function executeSearch(
  index: Document<any>,
  parsedQuery: ParsedAdvancedQuery,
  field?: string,
  allDocIds?: Set<string>
): Promise<Set<string>> {
  if (!parsedQuery.ast) {
    return new Set();
  }
  return executeAstSearch(index, parsedQuery.ast, field, allDocIds);
}

// ============================================================================
// Index Management
// ============================================================================

/**
 * Reset the in-memory indexes to empty state
 */
function resetIndexes(): void {
  chatIndex = new Document<ChatDoc>(chatIndexOptions);
  messageIndex = new Document<MessageDoc>(messageIndexOptions);
  chatMeta.clear();
}

/**
 * Load index from persistent storage into FlexSearch
 */
async function loadIndexFromStorage(): Promise<{
  loaded: boolean;
  chatCount: number;
}> {
  const storage = getSearchStorage();
  const stored = await storage.loadIndex();

  if (!stored) {
    console.info('[SearchWorker] No stored index found, starting fresh');
    resetIndexes();
    return { loaded: false, chatCount: 0 };
  }

  console.info(
    `[SearchWorker] Loading index: ${stored.meta.chatCount} chats, ${stored.meta.messageCount} messages`
  );

  // Reset and rebuild indexes
  resetIndexes();

  // Add all chats to the index
  for (const [chatId, entry] of stored.chats) {
    chatIndex!.add(entry.doc);
    chatMeta.set(chatId, {
      docId: entry.doc.id,
      lastUpdatedAt: entry.lastUpdatedAt,
      messageDocIds: entry.messageDocIds,
    });
  }

  // Add all messages to the index
  for (const [, entry] of stored.messages) {
    messageIndex!.add(entry.doc);
  }

  return { loaded: true, chatCount: stored.chats.size };
}

/**
 * Count all messages across all chats
 */
function countAllMessages(): number {
  let count = 0;
  for (const meta of chatMeta.values()) {
    count += meta.messageDocIds.length;
  }
  return count;
}

// ============================================================================
// Message Handlers
// ============================================================================

async function handleInit(encryptionKey: string): Promise<void> {
  const storage = getSearchStorage();

  // Initialize encryption
  await storage.initializeEncryption(encryptionKey);

  // Create fresh indexes
  resetIndexes();

  // Setup cross-tab coordination
  coordinator = createSearchCoordinator({
    onIndexUpdated: async () => {
      console.info('[SearchWorker] Another tab updated index, reloading...');
      await loadIndexFromStorage();
    },
    onIndexCleared: async () => {
      console.info('[SearchWorker] Another tab cleared index, resetting...');
      resetIndexes();
    },
    debug: false,
  });

  initialized = true;
}

async function handleLoad(): Promise<{
  fromStorage: boolean;
  chatCount: number;
}> {
  if (!initialized) {
    throw new Error('Worker not initialized');
  }

  if (indexLoaded) {
    return { fromStorage: false, chatCount: chatMeta.size };
  }

  const result = await loadIndexFromStorage();
  indexLoaded = true;

  return { fromStorage: result.loaded, chatCount: result.chatCount };
}

interface IndexableChat {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt: string;
  messages: Array<{
    id: string;
    createdAt: string;
    parts?: unknown;
  }>;
}

function removeChat(chatId: string): {
  removed: boolean;
  messageDocIds: string[];
} {
  if (!chatIndex || !messageIndex) return { removed: false, messageDocIds: [] };

  const meta = chatMeta.get(chatId);
  if (!meta) return { removed: false, messageDocIds: [] };

  // Remove chat document
  chatIndex.remove(meta.docId);

  // Remove all message documents
  for (const docId of meta.messageDocIds) {
    messageIndex.remove(docId);
  }

  const messageDocIds = [...meta.messageDocIds];
  chatMeta.delete(chatId);

  return { removed: true, messageDocIds };
}

function indexChat(chat: IndexableChat): {
  chatDoc: ChatDoc;
  messageDocs: MessageDoc[];
  messageDocIds: string[];
} {
  if (!chatIndex || !messageIndex) {
    throw new Error('Indexes not initialized');
  }

  // Remove existing data first
  removeChat(chat.chatId);

  const chatDoc: ChatDoc = {
    id: chatDocId(chat.chatId),
    chatId: chat.chatId,
    title: chat.title || 'Untitled',
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    type: 'chat',
  };

  chatIndex.add(chatDoc);

  const messageDocIds: string[] = [];
  const messageDocs: MessageDoc[] = [];

  for (const message of chat.messages) {
    const content = extractMessageContent(message.parts);
    if (!content.trim()) continue;

    const msgDoc: MessageDoc = {
      id: messageDocId(chat.chatId, message.id),
      chatId: chat.chatId,
      chatTitle: chat.title || 'Untitled',
      content,
      createdAt: message.createdAt,
      type: 'message',
    };

    messageIndex.add(msgDoc);
    messageDocIds.push(msgDoc.id);
    messageDocs.push(msgDoc);
  }

  chatMeta.set(chat.chatId, {
    docId: chatDoc.id,
    lastUpdatedAt: chat.lastUpdatedAt,
    messageDocIds,
  });

  return { chatDoc, messageDocs, messageDocIds };
}

async function handleSync(
  chats: IndexableChat[],
  requestId?: string
): Promise<{ changed: boolean }> {
  if (!chatIndex || !messageIndex) {
    throw new Error('Worker not initialized');
  }

  let changed = false;
  const incomingIds = new Set(chats.map((c) => c.chatId));
  const storage = getSearchStorage();

  const maybeKeepAlive = (rid?: string) => {
    if (!rid) return;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      type: 'keepalive',
      requestId: rid,
    });
  };

  maybeKeepAlive(requestId);
  let processed = 0;

  // Track changes for batch persistence
  const chatsToSave = new Map<string, ChatIndexEntry>();
  const messagesToSave = new Map<string, MessageIndexEntry>();
  const chatsToRemove: { chatId: string; messageDocIds: string[] }[] = [];

  // Remove chats that no longer exist
  for (const chatId of Array.from(chatMeta.keys())) {
    if (!incomingIds.has(chatId)) {
      const { removed, messageDocIds } = removeChat(chatId);
      if (removed) {
        changed = true;
        chatsToRemove.push({ chatId, messageDocIds });
      }
    }
  }

  // Add/update chats
  for (const chat of chats) {
    const meta = chatMeta.get(chat.chatId);
    const indexedAt = meta ? toTimestamp(meta.lastUpdatedAt) : 0;
    const updatedAt = toTimestamp(chat.lastUpdatedAt);

    if (!meta || indexedAt < updatedAt) {
      const { chatDoc, messageDocs, messageDocIds } = indexChat(chat);
      changed = true;

      // Queue for persistence
      chatsToSave.set(chat.chatId, {
        doc: chatDoc,
        lastUpdatedAt: chat.lastUpdatedAt,
        messageDocIds,
      });

      for (const msgDoc of messageDocs) {
        messagesToSave.set(msgDoc.id, { doc: msgDoc });
      }
    }

    processed += 1;
    if (processed % 25 === 0) {
      maybeKeepAlive(requestId);
    }
  }

  maybeKeepAlive(requestId);

  // Persist changes to storage
  if (changed && storage.hasEncryption()) {
    try {
      // Remove deleted chats from storage
      for (const { chatId, messageDocIds } of chatsToRemove) {
        await storage.removeChat(chatId, messageDocIds);
      }

      // Save new/updated data
      if (chatsToSave.size > 0 || messagesToSave.size > 0) {
        await storage.saveBatch(chatsToSave, messagesToSave);
      }

      // Update metadata
      await storage.updateMeta(chatMeta.size, countAllMessages());

      // Notify other tabs
      coordinator?.notifyIndexUpdated(chatMeta.size);
    } catch (error) {
      console.error('[SearchWorker] Failed to persist index:', error);
    }
  }

  return { changed };
}

function passesDateFilter(
  dateValue: string,
  options: WorkerSearchOptions
): boolean {
  if (!options.dateFilter) return true;
  const timestamp = toTimestamp(dateValue);
  const { after, before } = options.dateFilter;
  if (after && timestamp < toTimestamp(after)) return false;
  if (before && timestamp > toTimestamp(before)) return false;
  return true;
}

function sortChatResults(
  chatResults: any[],
  options: WorkerSearchOptions
): any[] {
  const sorted = [...chatResults];
  switch (options.sortBy) {
    case 'newest':
      return sorted.sort(
        (a, b) =>
          toTimestamp(b.createdAt ?? b.updatedAt) -
          toTimestamp(a.createdAt ?? a.updatedAt)
      );
    case 'oldest':
      return sorted.sort(
        (a, b) =>
          toTimestamp(a.createdAt ?? a.updatedAt) -
          toTimestamp(b.createdAt ?? b.updatedAt)
      );
    case 'title':
      return sorted.sort((a, b) =>
        String(a.title).localeCompare(String(b.title))
      );
    case 'relevance':
    default:
      return sorted;
  }
}

function sortMessageResults(
  messageResults: any[],
  options: WorkerSearchOptions
): any[] {
  const sorted = [...messageResults];
  switch (options.sortBy) {
    case 'newest':
      return sorted.sort(
        (a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt)
      );
    case 'oldest':
      return sorted.sort(
        (a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt)
      );
    case 'title':
      return sorted.sort((a, b) =>
        String(a.chatTitle).localeCompare(String(b.chatTitle))
      );
    case 'relevance':
    default:
      return messageResults;
  }
}

async function handleSearch(
  query: string,
  options: WorkerSearchOptions,
  knownChatIds: string[]
): Promise<{
  chatResults: { chatId: string; score: number }[];
  messageResults: {
    messageId: string;
    chatId: string;
    chatTitle: string;
    content: string;
    createdAt: string;
    score: number;
    snippet: string;
    highlights: HighlightRange[];
  }[];
}> {
  if (!chatIndex || !messageIndex) {
    throw new Error('Worker not initialized');
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { chatResults: [], messageResults: [] };
  }

  const knownIds = new Set(knownChatIds);

  const tokenizer = (text: string): string[] => {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
  };

  const parsedQuery = parseAdvancedQuery(normalizedQuery, tokenizer);
  const phrases = parsedQuery.phrases;
  const hasPhrases = phrases.length > 0;

  // Build document ID sets for NOT operations
  const allChatDocIds = parsedQuery.hasComplexBooleans
    ? new Set(Array.from(chatMeta.values()).map((m) => m.docId))
    : undefined;

  const allMessageDocIds = parsedQuery.hasComplexBooleans
    ? new Set(Array.from(chatMeta.values()).flatMap((m) => m.messageDocIds))
    : undefined;

  // Search Chat Index
  const chatDocIds = await executeSearch(
    chatIndex,
    parsedQuery,
    'title',
    allChatDocIds
  );

  const filteredChatResults: any[] = [];
  let chatScore = 1000;

  for (const docId of chatDocIds) {
    const doc = chatIndex.get(docId) as ChatDoc | null;
    if (!doc) continue;

    if (!knownIds.has(doc.chatId)) {
      removeChat(doc.chatId);
      continue;
    }

    if (hasPhrases && !matchesAllPhrases(doc.title, phrases)) {
      continue;
    }

    if (passesDateFilter(doc.createdAt ?? doc.updatedAt, options)) {
      filteredChatResults.push({
        chatId: doc.chatId,
        title: doc.title,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        score: chatScore--,
      });
    }
  }

  // Search Message Index
  const filteredMessageResults: any[] = [];

  if (options.searchMessages !== false) {
    const messageDocIds = await executeSearch(
      messageIndex,
      parsedQuery,
      undefined,
      allMessageDocIds
    );
    let messageScore = 1000;

    for (const docId of messageDocIds) {
      const doc = messageIndex.get(docId) as MessageDoc | null;
      if (!doc) continue;

      if (!knownIds.has(doc.chatId)) {
        removeChat(doc.chatId);
        continue;
      }

      if (hasPhrases && !matchesAllPhrases(doc.content, phrases)) {
        continue;
      }

      if (passesDateFilter(doc.createdAt, options)) {
        const { snippet, highlights } = buildSnippet(doc.content, parsedQuery);
        filteredMessageResults.push({
          messageId: doc.id,
          chatId: doc.chatId,
          chatTitle: doc.chatTitle,
          content: doc.content,
          createdAt: doc.createdAt,
          score: messageScore--,
          snippet,
          highlights,
        });
      }
    }
  }

  const sortedChatResults = sortChatResults(filteredChatResults, options).map(
    (r) => ({
      chatId: r.chatId,
      score: r.score,
    })
  );

  const sortedMessageResults = sortMessageResults(
    filteredMessageResults,
    options
  );

  return {
    chatResults: sortedChatResults,
    messageResults: sortedMessageResults,
  };
}

// ============================================================================
// Worker Message Handler
// ============================================================================

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  const { requestId } = payload;

  const respond = (message: WorkerResponse) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
  };

  const run = async () => {
    try {
      if (payload.type === 'init') {
        await handleInit(payload.encryptionKey);
        respond({ type: 'initialized', requestId });
        return;
      }

      if (!initialized) {
        throw new Error('Worker not initialized - call init first');
      }

      if (payload.type === 'load') {
        const result = await handleLoad();
        respond({
          type: 'loaded',
          requestId,
          fromStorage: result.fromStorage,
          chatCount: result.chatCount,
        } as WorkerResponse);
        return;
      }

      if (payload.type === 'sync') {
        const result = await handleSync(payload.chats, requestId);
        respond({
          type: 'synced',
          requestId,
          changed: result.changed,
        });
        return;
      }

      if (payload.type === 'search') {
        const result = await handleSearch(
          payload.query,
          payload.options,
          payload.knownChatIds
        );
        respond({
          type: 'searchResults',
          requestId,
          chatResults: result.chatResults,
          messageResults: result.messageResults,
        });
        return;
      }

      respond({
        type: 'error',
        requestId,
        message: 'Unknown worker request',
      });
    } catch (error) {
      console.error('[SearchWorker]', error);
      const message =
        error instanceof Error ? error.message : 'Search worker failed';
      respond({ type: 'error', requestId, message });
    }
  };

  run();
});

export {};
