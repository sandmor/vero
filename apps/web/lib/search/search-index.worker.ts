/// <reference lib="webworker" />

import MiniSearch from 'minisearch';
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

const CHAT_DOC_PREFIX = 'chat:';
const MESSAGE_DOC_PREFIX = 'msg:';
const INDEX_VERSION = 1;

const chatIndexOptions = {
    fields: ['title'],
    storeFields: ['id', 'chatId', 'title', 'createdAt', 'updatedAt', 'type'],
    searchOptions: { prefix: true, fuzzy: 0.2 },
};

const messageIndexOptions = {
    fields: ['content', 'title'],
    storeFields: ['id', 'chatId', 'chatTitle', 'content', 'createdAt', 'type'],
    searchOptions: { prefix: true, fuzzy: 0.2 },
};

let chatIndex = new MiniSearch<ChatDoc>(chatIndexOptions);
let messageIndex = new MiniSearch<MessageDoc>(messageIndexOptions);
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
        .filter((part) =>
            part && typeof part === 'object' && (part as any).type === 'text'
        )
        .map((part) => {
            const text = (part as any).text;
            return typeof text === 'string' ? text : '';
        })
        .filter(Boolean)
        .join(' ');
}

function buildSnippet(content: string, query: string): string {
    if (!content) return '';
    const normalizedContent = content.trim();
    if (!normalizedContent) return '';
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return normalizedContent.slice(0, 180);

    const lowerContent = normalizedContent.toLowerCase();
    const matchIndex = lowerContent.indexOf(normalizedQuery);

    if (matchIndex === -1) {
        return normalizedContent.length > 180
            ? `${normalizedContent.slice(0, 180)}...`
            : normalizedContent;
    }

    const start = Math.max(0, matchIndex - 80);
    const end = Math.min(normalizedContent.length, matchIndex + normalizedQuery.length + 80);
    let snippet = normalizedContent.slice(start, end);
    if (start > 0) snippet = `...${snippet}`;
    if (end < normalizedContent.length) snippet = `${snippet}...`;
    return snippet;
}

function resetIndexes(): void {
    chatIndex = new MiniSearch<ChatDoc>(chatIndexOptions);
    messageIndex = new MiniSearch<MessageDoc>(messageIndexOptions);
    chatDocs = new Map();
    messageDocs = new Map();
    chatMeta = new Map();
}

function hydrateFromSnapshot(snapshot: SearchIndexSnapshot | null): void {
    resetIndexes();
    if (!snapshot || snapshot.version !== INDEX_VERSION) return;

    const parseIndex = (value: unknown) => {
        if (typeof value === 'string') {
            return JSON.parse(value);
        }
        // Backward compatibility: older snapshots stored plain objects
        if (value && typeof value === 'object') {
            return value;
        }
        throw new Error('Invalid index payload');
    };

    try {
        const chatJson = parseIndex(snapshot.chatIndex);
        const messageJson = parseIndex(snapshot.messageIndex);

        chatIndex = MiniSearch.loadJSON<ChatDoc>(chatJson, chatIndexOptions);
        messageIndex = MiniSearch.loadJSON<MessageDoc>(
            messageJson,
            messageIndexOptions
        );

        chatDocs = new Map(Object.entries(snapshot.chatDocs));
        messageDocs = new Map(Object.entries(snapshot.messageDocs));
        chatMeta = new Map(Object.entries(snapshot.chatMeta));
    } catch (error) {
        // If snapshot is corrupt, fall back to empty indexes
        console.warn('[SearchWorker] Failed to hydrate snapshot, resetting index', error);
        resetIndexes();
    }
}

function buildSnapshot(): SearchIndexSnapshot {
    return {
        version: INDEX_VERSION,
        chatIndex: JSON.stringify(chatIndex.toJSON()),
        messageIndex: JSON.stringify(messageIndex.toJSON()),
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
        chatIndex.remove(chatDoc);
        chatDocs.delete(meta.chatDocId);
    }

    for (const docId of meta.messageDocIds) {
        const messageDoc = messageDocs.get(docId);
        if (messageDoc) {
            messageIndex.remove(messageDoc);
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

function handleSync(
    chats: IndexableChat[],
    requestId?: string
): { changed: boolean; snapshot?: SearchIndexSnapshot } {
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

    return changed ? { changed: true, snapshot: buildSnapshot() } : { changed: false };
}

function passesDateFilter(dateValue: string, options: WorkerSearchOptions): boolean {
    if (!options.dateFilter) return true;
    const timestamp = toTimestamp(dateValue);
    const { after, before } = options.dateFilter;
    if (after && timestamp < toTimestamp(after)) return false;
    if (before && timestamp > toTimestamp(before)) return false;
    return true;
}

function sortChatResults(chatResults: any[], options: WorkerSearchOptions): any[] {
    const sorted = [...chatResults];
    switch (options.sortBy) {
        case 'newest':
            return sorted.sort(
                (a, b) => toTimestamp(b.createdAt ?? b.updatedAt) - toTimestamp(a.createdAt ?? a.updatedAt)
            );
        case 'oldest':
            return sorted.sort(
                (a, b) => toTimestamp(a.createdAt ?? a.updatedAt) - toTimestamp(b.createdAt ?? b.updatedAt)
            );
        case 'title':
            return sorted.sort((a, b) => String(a.title).localeCompare(String(b.title)));
        case 'relevance':
        default:
            return chatResults;
    }
}

function sortMessageResults(messageResults: any[], options: WorkerSearchOptions): any[] {
    const sorted = [...messageResults];
    switch (options.sortBy) {
        case 'newest':
            return sorted.sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt));
        case 'oldest':
            return sorted.sort((a, b) => toTimestamp(a.createdAt) - toTimestamp(b.createdAt));
        case 'title':
            return sorted.sort((a, b) => String(a.chatTitle).localeCompare(String(b.chatTitle)));
        case 'relevance':
        default:
            return messageResults;
    }
}

function handleSearch(
    query: string,
    options: WorkerSearchOptions,
    knownChatIds: string[]
): {
    chatResults: { chatId: string; score: number }[];
    messageResults: {
        messageId: string;
        chatId: string;
        chatTitle: string;
        content: string;
        createdAt: string;
        score: number;
        snippet: string;
    }[];
    snapshot?: SearchIndexSnapshot;
} {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return { chatResults: [], messageResults: [] };
    }

    const knownIds = new Set(knownChatIds);
    let changed = false;

    const chatResultsRaw = chatIndex.search(normalizedQuery, {
        prefix: true,
        fuzzy: 0.2,
        boost: { title: 2 },
    });

    const filteredChatResults = chatResultsRaw
        .map((result) => ({
            chatId: (result as any).chatId,
            title: (result as any).title,
            createdAt: (result as any).createdAt,
            updatedAt: (result as any).updatedAt,
            score: (result as any).score as number,
        }))
        .filter((result) => {
            if (!knownIds.has(result.chatId)) {
                changed = removeChat(result.chatId) || changed;
                return false;
            }
            return passesDateFilter(result.createdAt ?? result.updatedAt, options);
        });

    const messageResultsRaw = options.searchMessages === false
        ? []
        : messageIndex.search(normalizedQuery, {
            prefix: true,
            fuzzy: 0.2,
        });

    const filteredMessageResults = messageResultsRaw
        .map((result) => ({
            messageId: (result as any).id,
            chatId: (result as any).chatId,
            chatTitle: (result as any).chatTitle,
            content: (result as any).content,
            createdAt: (result as any).createdAt,
            score: (result as any).score as number,
        }))
        .filter((result) => {
            if (!knownIds.has(result.chatId)) {
                changed = removeChat(result.chatId) || changed;
                return false;
            }
            return passesDateFilter(result.createdAt, options);
        })
        .map((result) => ({
            ...result,
            snippet: buildSnippet(result.content, normalizedQuery),
        }));

    const sortedChatResults = sortChatResults(filteredChatResults, options).map(
        (result) => ({ chatId: result.chatId, score: result.score })
    );
    const sortedMessageResults = sortMessageResults(
        filteredMessageResults,
        options
    );

    return {
        chatResults: sortedChatResults,
        messageResults: sortedMessageResults,
        snapshot: changed ? buildSnapshot() : undefined,
    };
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    const payload = event.data;
    const { requestId } = payload;
    const respond = (message: WorkerResponse) => {
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
    };

    try {
        if (payload.type === 'load') {
            hydrateFromSnapshot(payload.snapshot);
            respond({ type: 'loaded', requestId });
            return;
        }

        if (payload.type === 'sync') {
            const result = handleSync(payload.chats, requestId);
            respond({
                type: 'synced',
                requestId,
                changed: result.changed,
                snapshot: result.snapshot,
            });
            return;
        }

        if (payload.type === 'search') {
            const result = handleSearch(payload.query, payload.options, payload.knownChatIds);
            respond({
                type: 'searchResults',
                requestId,
                chatResults: result.chatResults,
                messageResults: result.messageResults,
                snapshot: result.snapshot,
            });
            return;
        }

        respond({
            type: 'error',
            requestId,
            message: 'Unknown worker request',
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Search worker failed';
        respond({ type: 'error', requestId, message });
    }
});

export { };