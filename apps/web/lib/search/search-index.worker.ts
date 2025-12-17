/// <reference lib="webworker" />

import { Document, type DocumentOptions } from 'flexsearch';
import type {
  ChatDoc,
  ChatIndexMeta,
  IndexableChat,
  MessageDoc,
  SearchIndexSnapshot,
  WorkerRequest,
  WorkerResponse,
  WorkerSearchOptions,
} from '@/lib/search/search-index.types';
import {
  initializeEncryptionKey,
  hasEncryptionKey,
  persistSnapshot,
  loadSnapshot,
} from '@/lib/search/worker-storage';
import {
  parseAdvancedQuery,
  matchesAllPhrases,
  extractTerms,
  type QueryNode,
  type ParsedAdvancedQuery,
} from '@/lib/search/query-parser';

const CHAT_DOC_PREFIX = 'chat:';
const MESSAGE_DOC_PREFIX = 'msg:';
const INDEX_VERSION = 1;

/**
 * Configuration for the chat index.
 * Context enabled to improve relevance of multi-term queries.
 */
const chatIndexOptions: DocumentOptions<ChatDoc> = {
  document: {
    id: 'id',
    index: ['title'],
  },
  tokenize: 'bidirectional',
  preset: 'match',
  context: true,
};

/**
 * Configuration for the message index.
 * Context enabled to improve relevance of multi-term queries.
 */
const messageIndexOptions: DocumentOptions<MessageDoc> = {
  document: {
    id: 'id',
    index: ['content', 'chatTitle'],
  },
  tokenize: 'bidirectional',
  preset: 'match',
  context: true,
};

// Start with empty indexes
let chatIndex = new Document<ChatDoc>(chatIndexOptions);
let messageIndex = new Document<MessageDoc>(messageIndexOptions);

let chatDocs = new Map<string, ChatDoc>();
let messageDocs = new Map<string, MessageDoc>();
let chatMeta = new Map<string, ChatIndexMeta>();

function chatDocId(chatId: string): string {
  return `${CHAT_DOC_PREFIX}${chatId}`;
}

function messageDocId(chatId: string, messageId: string): string {
  return `${MESSAGE_DOC_PREFIX}${chatId}:${messageId}`;
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

type HighlightRange = { start: number; end: number };

type SnippetResult = {
  snippet: string;
  highlights: HighlightRange[];
};

const DEFAULT_SNIPPET_LENGTH = 140;

/**
 * Find all occurrences of a search term in text (case-insensitive)
 * Returns positions relative to the original text
 */
function findAllMatches(
  text: string,
  term: string
): { start: number; end: number; score: number }[] {
  const matches: { start: number; end: number; score: number }[] = [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();

  let index = 0;
  while ((index = lowerText.indexOf(lowerTerm, index)) !== -1) {
    // Score based on match quality:
    // - Word boundary matches score higher
    // - Longer matches score higher
    let score = lowerTerm.length;

    // Check if match starts at word boundary
    if (index === 0 || /\W/.test(text[index - 1])) {
      score += 5;
    }

    // Check if match ends at word boundary
    const endIndex = index + lowerTerm.length;
    if (endIndex === text.length || /\W/.test(text[endIndex])) {
      score += 5;
    }

    matches.push({ start: index, end: endIndex, score });
    index += 1;
  }

  return matches;
}

/**
 * Merge overlapping highlight ranges and sort by position
 */
function mergeHighlightRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Overlapping or adjacent - merge
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Build a snippet with highlight ranges from content.
 * Chooses the best match position based on scoring and returns
 * all highlight ranges within the snippet window.
 */
function buildSnippet(
  content: string,
  parsedQuery: ParsedAdvancedQuery,
  snippetLength: number = DEFAULT_SNIPPET_LENGTH
): SnippetResult {
  if (!content) {
    return { snippet: '', highlights: [] };
  }

  const normalizedContent = content.trim().replace(/\s+/g, ' ');
  if (!normalizedContent) {
    return { snippet: '', highlights: [] };
  }

  // Extract all searchable terms from the query (phrases + individual terms)
  const phrases = parsedQuery.phrases;
  const terms = extractTerms(parsedQuery.ast);

  // Combine phrases and terms, with phrases having priority
  const searchTerms = [...phrases, ...terms.filter(t => !phrases.some(p => p.toLowerCase().includes(t.toLowerCase())))];

  if (searchTerms.length === 0) {
    // No search terms - return beginning of content
    const snippet = normalizedContent.length > snippetLength
      ? `${normalizedContent.slice(0, snippetLength)}...`
      : normalizedContent;
    return { snippet, highlights: [] };
  }

  // Find all matches for all terms
  type MatchWithTerm = { start: number; end: number; score: number; term: string };
  const allMatches: MatchWithTerm[] = [];

  for (const term of searchTerms) {
    const matches = findAllMatches(normalizedContent, term);
    for (const match of matches) {
      // Boost phrase matches
      const isPhraseMatch = phrases.includes(term);
      allMatches.push({
        ...match,
        score: match.score + (isPhraseMatch ? 10 : 0),
        term,
      });
    }
  }

  if (allMatches.length === 0) {
    // No matches found - return beginning of content
    const snippet = normalizedContent.length > snippetLength
      ? `${normalizedContent.slice(0, snippetLength)}...`
      : normalizedContent;
    return { snippet, highlights: [] };
  }

  // Sort by score to find the best match
  allMatches.sort((a, b) => b.score - a.score);
  const bestMatch = allMatches[0];

  // Calculate snippet window centered around the best match
  const matchCenter = Math.floor((bestMatch.start + bestMatch.end) / 2);
  const halfWindow = Math.floor(snippetLength / 2);

  let windowStart = Math.max(0, matchCenter - halfWindow);
  let windowEnd = Math.min(normalizedContent.length, matchCenter + halfWindow);

  // Adjust window to ensure we capture the full match
  if (bestMatch.start < windowStart) {
    windowStart = bestMatch.start;
    windowEnd = Math.min(normalizedContent.length, windowStart + snippetLength);
  }
  if (bestMatch.end > windowEnd) {
    windowEnd = bestMatch.end;
    windowStart = Math.max(0, windowEnd - snippetLength);
  }

  // Try to extend to word boundaries for cleaner snippets
  if (windowStart > 0) {
    // Find the next space after windowStart to start at a word boundary
    const spaceAfter = normalizedContent.indexOf(' ', windowStart);
    if (spaceAfter !== -1 && spaceAfter < windowStart + 15) {
      windowStart = spaceAfter + 1;
    }
  }
  if (windowEnd < normalizedContent.length) {
    // Find the last space before windowEnd to end at a word boundary
    const spaceBefore = normalizedContent.lastIndexOf(' ', windowEnd);
    if (spaceBefore !== -1 && spaceBefore > windowEnd - 15) {
      windowEnd = spaceBefore;
    }
  }

  // Extract snippet
  let snippet = normalizedContent.slice(windowStart, windowEnd);
  const prefixAdded = windowStart > 0;
  const suffixAdded = windowEnd < normalizedContent.length;

  if (prefixAdded) snippet = `...${snippet}`;
  if (suffixAdded) snippet = `${snippet}...`;

  // Calculate highlight ranges relative to the snippet
  const prefixOffset = prefixAdded ? 3 : 0; // "..." is 3 characters
  const highlights: HighlightRange[] = [];

  for (const match of allMatches) {
    // Check if match is within our window
    if (match.end > windowStart && match.start < windowEnd) {
      const highlightStart = Math.max(0, match.start - windowStart) + prefixOffset;
      const highlightEnd = Math.min(windowEnd - windowStart, match.end - windowStart) + prefixOffset;

      highlights.push({ start: highlightStart, end: highlightEnd });
    }
  }

  return {
    snippet,
    highlights: mergeHighlightRanges(highlights),
  };
}

function resetIndexes(): void {
  chatIndex = new Document<ChatDoc>(chatIndexOptions);
  messageIndex = new Document<MessageDoc>(messageIndexOptions);
  chatDocs = new Map();
  messageDocs = new Map();
  chatMeta = new Map();
}

async function hydrateFromSnapshot(
  snapshot: SearchIndexSnapshot | null
): Promise<void> {
  resetIndexes();
  if (!snapshot || snapshot.version !== INDEX_VERSION) return;

  try {
    // Import chat index keys
    const chatKeys = Object.keys(snapshot.chatIndex);
    for (const key of chatKeys) {
      await chatIndex.import(key, snapshot.chatIndex[key]);
    }

    // Import message index keys
    const messageKeys = Object.keys(snapshot.messageIndex);
    for (const key of messageKeys) {
      await messageIndex.import(key, snapshot.messageIndex[key]);
    }

    chatDocs = new Map(Object.entries(snapshot.chatDocs));
    messageDocs = new Map(Object.entries(snapshot.messageDocs));
    chatMeta = new Map(Object.entries(snapshot.chatMeta));
  } catch (error) {
    console.warn(
      '[SearchWorker] Failed to hydrate snapshot, resetting index',
      error
    );
    resetIndexes();
  }
}

async function buildSnapshot(): Promise<SearchIndexSnapshot> {
  const chatExport: Record<string, string> = {};
  await chatIndex.export((key, data) => {
    chatExport[key] = data;
  });

  const messageExport: Record<string, string> = {};
  await messageIndex.export((key, data) => {
    messageExport[key] = data;
  });

  return {
    version: INDEX_VERSION,
    chatIndex: chatExport,
    messageIndex: messageExport,
    chatDocs: Object.fromEntries(chatDocs),
    messageDocs: Object.fromEntries(messageDocs),
    chatMeta: Object.fromEntries(chatMeta),
  };
}

function removeChat(chatId: string): boolean {
  const meta = chatMeta.get(chatId);
  if (!meta) return false;

  const chatDoc = chatDocs.get(meta.chatDocId);
  if (chatDoc) {
    chatIndex.remove(chatDoc.id);
    chatDocs.delete(meta.chatDocId);
  }

  for (const docId of meta.messageDocIds) {
    const messageDoc = messageDocs.get(docId);
    if (messageDoc) {
      messageIndex.remove(messageDoc.id);
      messageDocs.delete(docId);
    }
  }

  chatMeta.delete(chatId);
  return true;
}

function reindexChat(chat: IndexableChat): boolean {
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
  chatDocs.set(chatDoc.id, chatDoc);

  const messageDocIds: string[] = [];

  for (const message of chat.messages) {
    const content = extractMessageContent((message as any).parts);
    if (!content.trim()) continue;

    const messageDoc: MessageDoc = {
      id: messageDocId(chat.chatId, message.id),
      chatId: chat.chatId,
      chatTitle: chat.title || 'Untitled',
      content,
      createdAt: message.createdAt,
      type: 'message',
    };

    messageIndex.add(messageDoc);
    messageDocs.set(messageDoc.id, messageDoc);
    messageDocIds.push(messageDoc.id);
  }

  chatMeta.set(chat.chatId, {
    chatDocId: chatDoc.id,
    messageDocIds,
    lastIndexedAt: chat.lastUpdatedAt,
    lastUpdatedAt: chat.lastUpdatedAt,
  });

  return true;
}

async function handleSync(
  chats: IndexableChat[],
  requestId?: string
): Promise<{ changed: boolean }> {
  let changed = false;
  const incomingIds = new Set(chats.map((chat) => chat.chatId));

  const maybeKeepAlive = (requestId?: string) => {
    if (!requestId) return;
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({
      type: 'keepalive',
      requestId,
    });
  };

  maybeKeepAlive(requestId);
  let processed = 0;

  for (const chatId of Array.from(chatMeta.keys())) {
    if (!incomingIds.has(chatId)) {
      if (removeChat(chatId)) changed = true;
    }
  }

  for (const chat of chats) {
    const meta = chatMeta.get(chat.chatId);
    const indexedAt = meta ? toTimestamp(meta.lastIndexedAt) : 0;
    const updatedAt = toTimestamp(chat.lastUpdatedAt);
    if (!meta || indexedAt < updatedAt) {
      if (reindexChat(chat)) changed = true;
    }

    processed += 1;
    if (processed % 25 === 0) {
      maybeKeepAlive(requestId);
    }
  }

  maybeKeepAlive(requestId);

  // Persist snapshot in the background (within the worker) if changed
  if (changed && hasEncryptionKey()) {
    const snapshot = await buildSnapshot();
    // Fire and forget - don't block the response
    persistSnapshot(snapshot).catch((error) => {
      console.warn('[SearchWorker] Failed to persist snapshot:', error);
    });
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
      // FlexSearch results are already sorted by relevance (score)
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

/**
 * Helper to flatten FlexSearch results which are grouped by field.
 */
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

/**
 * Set intersection - returns elements present in all sets
 */
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

/**
 * Set union - returns elements present in any set
 */
function setUnion<T>(...sets: Set<T>[]): Set<T> {
  const result = new Set<T>();
  for (const set of sets) {
    for (const item of set) {
      result.add(item);
    }
  }
  return result;
}

/**
 * Set difference - returns elements in first set but not in second
 */
function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of setA) {
    if (!setB.has(item)) {
      result.add(item);
    }
  }
  return result;
}

/**
 * Execute a simple search query against an index
 */
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

/**
 * Recursively execute search based on AST node
 * Composes boolean operations using set operations on search results
 */
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
      // For phrases, search for the words (phrase matching is done in post-filter)
      return searchQuery(index, node.value, field);

    case 'and': {
      if (node.children.length === 0) return new Set();

      // Execute all child searches in parallel
      const childResults = await Promise.all(
        node.children.map((child) => executeAstSearch(index, child, field, allDocIds))
      );

      // Return intersection of all results
      return setIntersection(...childResults);
    }

    case 'or': {
      if (node.children.length === 0) return new Set();

      // Execute all child searches in parallel
      const childResults = await Promise.all(
        node.children.map((child) => executeAstSearch(index, child, field, allDocIds))
      );

      // Return union of all results
      return setUnion(...childResults);
    }

    case 'not': {
      // Get all documents that match the negated term
      const negatedResults = await executeAstSearch(index, node.child, field, allDocIds);

      // If we have all doc IDs, subtract the negated results
      // Otherwise, NOT alone can't produce results (no base set)
      if (allDocIds && allDocIds.size > 0) {
        return setDifference(allDocIds, negatedResults);
      }

      // Pure NOT query without context - return empty set
      return new Set();
    }

    case 'field': {
      // Execute search against specific field
      return executeAstSearch(index, node.child, node.field, allDocIds);
    }
  }
}

/**
 * Execute search using the parsed query AST
 * Uses native FlexSearch searchAsync with manual set operations for boolean logic
 */
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



/**
 * Performs a search across chat and message indexes.
 * Uses advanced Lucene-like query parsing with boolean operations and phrase matching.
 * Returns results sorted by the requested sort order (or relevance).
 */
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
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { chatResults: [], messageResults: [] };
  }

  const knownIds = new Set(knownChatIds);
  let changed = false;

  // Create tokenizer function to detect single-token phrases
  // A phrase like "AND" is just escaping a keyword and should be treated as a term
  // We use bidirectional tokenization similar to what FlexSearch uses
  const tokenizer = (text: string): string[] => {
    // Simple tokenization that mimics FlexSearch's bidirectional tokenizer
    // Split on whitespace and filter empty strings
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
    return tokens;
  };

  // Parse the query with the tokenizer to handle single-token phrases
  const parsedQuery = parseAdvancedQuery(normalizedQuery, tokenizer);
  const phrases = parsedQuery.phrases;
  const hasPhrases = phrases.length > 0;

  // Get all doc IDs for NOT operations (if query contains NOT)
  const allChatDocIds = parsedQuery.hasComplexBooleans ? new Set(chatDocs.keys()) : undefined;
  const allMessageDocIds = parsedQuery.hasComplexBooleans ? new Set(messageDocs.keys()) : undefined;

  // Search Chat Index
  const chatDocIds = await executeSearch(chatIndex, parsedQuery, 'title', allChatDocIds);

  const filteredChatResults: any[] = [];
  let chatScore = 1000;

  for (const id of chatDocIds) {
    const doc = chatDocs.get(id);
    if (!doc) continue;

    if (!knownIds.has(doc.chatId)) {
      changed = removeChat(doc.chatId) || changed;
      continue;
    }

    // Apply phrase filter if we have multi-token phrase searches
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
    const messageDocIds = await executeSearch(messageIndex, parsedQuery, undefined, allMessageDocIds);
    let messageScore = 1000;

    for (const id of messageDocIds) {
      const doc = messageDocs.get(id);
      if (!doc) continue;

      if (!knownIds.has(doc.chatId)) {
        changed = removeChat(doc.chatId) || changed;
        continue;
      }

      // Apply phrase filter if we have multi-token phrase searches
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
    (result) => ({ chatId: result.chatId, score: result.score })
  );
  const sortedMessageResults = sortMessageResults(
    filteredMessageResults,
    options
  );

  // Persist snapshot in the background if index was modified
  if (changed && hasEncryptionKey()) {
    const snapshot = await buildSnapshot();
    persistSnapshot(snapshot).catch((error) => {
      console.warn('[SearchWorker] Failed to persist snapshot after search:', error);
    });
  }

  return {
    chatResults: sortedChatResults,
    messageResults: sortedMessageResults,
  };
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data;
  const { requestId } = payload;
  const respond = (message: WorkerResponse) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
  };

  const run = async () => {
    try {
      if (payload.type === 'init') {
        await initializeEncryptionKey(payload.encryptionKey);
        respond({ type: 'initialized', requestId });
        return;
      }

      if (payload.type === 'load') {
        // Load snapshot from worker-side IndexedDB storage
        const storedSnapshot = hasEncryptionKey()
          ? await loadSnapshot<SearchIndexSnapshot>()
          : null;
        await hydrateFromSnapshot(storedSnapshot);
        respond({ type: 'loaded', requestId });
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
      console.error(error);
      const message =
        error instanceof Error ? error.message : 'Search worker failed';
      respond({ type: 'error', requestId, message });
    }
  };

  run();
});

export { };
