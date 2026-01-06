/**
 * Search Index Persistent Storage
 *
 * This module handles encrypted persistence of the search index to IndexedDB.
 * Unlike FlexSearch's native storage which stores index internals, we store
 * the actual documents and rebuild the FlexSearch index on load.
 *
 * This approach:
 * 1. Enables encryption at the document level
 * 2. Supports cross-tab coordination (IndexedDB is shared)
 * 3. Allows instant search on app load by pre-loading documents
 * 4. Is simpler and more maintainable than intercepting FlexSearch internals
 *
 * Storage Schema:
 * - meta: { version, lastUpdatedAt, chatCount, messageCount }
 * - chats: chatId → encrypted { doc, lastUpdatedAt, messageDocIds }
 * - messages: messageDocId → encrypted { doc }
 */

import type { ChatDoc, MessageDoc } from './search-index.types';

const DB_NAME = 'ViridSearchIndex';
const DB_VERSION = 1;
const AES_GCM_IV_LENGTH = 12;

const STORES = {
    META: 'meta',
    CHATS: 'chats',
    MESSAGES: 'messages',
} as const;

const META_KEY = 'index-meta';
const CURRENT_VERSION = 1;

// ============================================================================
// Types
// ============================================================================

export interface ChatIndexEntry {
    doc: ChatDoc;
    lastUpdatedAt: string;
    messageDocIds: string[];
}

export interface MessageIndexEntry {
    doc: MessageDoc;
}

export interface IndexMeta {
    version: number;
    lastUpdatedAt: number;
    chatCount: number;
    messageCount: number;
}

interface EncryptedValue {
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
}

export interface StoredIndex {
    meta: IndexMeta;
    chats: Map<string, ChatIndexEntry>;
    messages: Map<string, MessageIndexEntry>;
}

// ============================================================================
// Utilities
// ============================================================================

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('Transaction aborted'));
    });
}

// ============================================================================
// SearchStorage Class
// ============================================================================

export class SearchStorage {
    private db: IDBDatabase | null = null;
    private encryptionKey: CryptoKey | null = null;
    private openPromise: Promise<void> | null = null;

    /**
     * Initialize encryption with a base64-encoded key
     */
    async initializeEncryption(base64Key: string): Promise<void> {
        const rawKey = base64ToUint8Array(base64Key);
        const normalized: ArrayBuffer =
            rawKey.byteOffset === 0 && rawKey.byteLength === rawKey.buffer.byteLength
                ? (rawKey.buffer as ArrayBuffer)
                : rawKey.slice().buffer;

        this.encryptionKey = await crypto.subtle.importKey(
            'raw',
            normalized,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    hasEncryption(): boolean {
        return this.encryptionKey !== null;
    }

    private async encrypt<T>(data: T): Promise<EncryptedValue> {
        if (!this.encryptionKey) {
            throw new Error('[SearchStorage] Encryption key not initialized');
        }

        const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
        const encoded = new TextEncoder().encode(JSON.stringify(data));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            this.encryptionKey,
            encoded
        );

        return { ciphertext, iv };
    }

    private async decrypt<T>(encrypted: EncryptedValue): Promise<T> {
        if (!this.encryptionKey) {
            throw new Error('[SearchStorage] Encryption key not initialized');
        }

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: encrypted.iv as BufferSource },
            this.encryptionKey,
            encrypted.ciphertext
        );

        const decoded = new TextDecoder().decode(decrypted);
        return JSON.parse(decoded) as T;
    }

    /**
     * Open the database connection
     */
    async open(): Promise<void> {
        if (this.db) return;
        if (this.openPromise) return this.openPromise;

        // Request persistent storage
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
            navigator.storage.persist().catch(() => { });
        }

        this.openPromise = new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                this.openPromise = null;
                reject(request.error);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                // Create object stores
                if (!db.objectStoreNames.contains(STORES.META)) {
                    db.createObjectStore(STORES.META);
                }
                if (!db.objectStoreNames.contains(STORES.CHATS)) {
                    db.createObjectStore(STORES.CHATS);
                }
                if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
                    db.createObjectStore(STORES.MESSAGES);
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.db.onversionchange = () => {
                    this.close();
                };
                this.openPromise = null;
                resolve();
            };
        });

        return this.openPromise;
    }

    /**
     * Close the database connection
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    /**
     * Get the current index metadata
     */
    async getMeta(): Promise<IndexMeta | null> {
        if (!this.hasEncryption()) return null;

        await this.open();
        if (!this.db) return null;

        try {
            const transaction = this.db.transaction(STORES.META, 'readonly');
            const store = transaction.objectStore(STORES.META);
            const encrypted = await promisify(store.get(META_KEY));

            if (!encrypted) return null;

            const meta = await this.decrypt<IndexMeta>(encrypted);
            if (meta.version !== CURRENT_VERSION) {
                return null; // Version mismatch, will rebuild
            }

            return meta;
        } catch {
            return null;
        }
    }

    /**
     * Load the full index from storage
     */
    async loadIndex(): Promise<StoredIndex | null> {
        if (!this.hasEncryption()) return null;

        await this.open();
        if (!this.db) return null;

        try {
            // Get metadata first
            const meta = await this.getMeta();
            if (!meta) return null;

            const chats = new Map<string, ChatIndexEntry>();
            const messages = new Map<string, MessageIndexEntry>();

            // Load all chats
            const chatTransaction = this.db.transaction(STORES.CHATS, 'readonly');
            const chatStore = chatTransaction.objectStore(STORES.CHATS);

            await new Promise<void>((resolve, reject) => {
                const cursorRequest = chatStore.openCursor();
                cursorRequest.onerror = () => reject(cursorRequest.error);
                cursorRequest.onsuccess = async () => {
                    const cursor = cursorRequest.result;
                    if (cursor) {
                        try {
                            const entry = await this.decrypt<ChatIndexEntry>(cursor.value);
                            chats.set(cursor.key as string, entry);
                            cursor.continue();
                        } catch {
                            // Skip corrupted entry
                            cursor.continue();
                        }
                    } else {
                        resolve();
                    }
                };
            });

            // Load all messages
            const messageTransaction = this.db.transaction(STORES.MESSAGES, 'readonly');
            const messageStore = messageTransaction.objectStore(STORES.MESSAGES);

            await new Promise<void>((resolve, reject) => {
                const cursorRequest = messageStore.openCursor();
                cursorRequest.onerror = () => reject(cursorRequest.error);
                cursorRequest.onsuccess = async () => {
                    const cursor = cursorRequest.result;
                    if (cursor) {
                        try {
                            const entry = await this.decrypt<MessageIndexEntry>(cursor.value);
                            messages.set(cursor.key as string, entry);
                            cursor.continue();
                        } catch {
                            // Skip corrupted entry
                            cursor.continue();
                        }
                    } else {
                        resolve();
                    }
                };
            });

            return { meta, chats, messages };
        } catch (error) {
            console.warn('[SearchStorage] Failed to load index:', error);
            return null;
        }
    }

    /**
     * Save a chat entry to storage
     */
    async saveChat(chatId: string, entry: ChatIndexEntry): Promise<void> {
        if (!this.hasEncryption()) return;

        await this.open();
        if (!this.db) return;

        const encrypted = await this.encrypt(entry);
        const transaction = this.db.transaction(STORES.CHATS, 'readwrite');
        const store = transaction.objectStore(STORES.CHATS);
        store.put(encrypted, chatId);
        await promisifyTransaction(transaction);
    }

    /**
     * Save a message entry to storage
     */
    async saveMessage(messageDocId: string, entry: MessageIndexEntry): Promise<void> {
        if (!this.hasEncryption()) return;

        await this.open();
        if (!this.db) return;

        const encrypted = await this.encrypt(entry);
        const transaction = this.db.transaction(STORES.MESSAGES, 'readwrite');
        const store = transaction.objectStore(STORES.MESSAGES);
        store.put(encrypted, messageDocId);
        await promisifyTransaction(transaction);
    }

    /**
     * Save multiple entries in a batch (more efficient)
     */
    async saveBatch(
        chats: Map<string, ChatIndexEntry>,
        messages: Map<string, MessageIndexEntry>
    ): Promise<void> {
        if (!this.hasEncryption()) return;

        await this.open();
        if (!this.db) return;

        // Save chats
        if (chats.size > 0) {
            const chatTransaction = this.db.transaction(STORES.CHATS, 'readwrite');
            const chatStore = chatTransaction.objectStore(STORES.CHATS);

            for (const [chatId, entry] of chats) {
                const encrypted = await this.encrypt(entry);
                chatStore.put(encrypted, chatId);
            }

            await promisifyTransaction(chatTransaction);
        }

        // Save messages
        if (messages.size > 0) {
            const messageTransaction = this.db.transaction(STORES.MESSAGES, 'readwrite');
            const messageStore = messageTransaction.objectStore(STORES.MESSAGES);

            for (const [docId, entry] of messages) {
                const encrypted = await this.encrypt(entry);
                messageStore.put(encrypted, docId);
            }

            await promisifyTransaction(messageTransaction);
        }
    }

    /**
     * Remove a chat and its messages from storage
     */
    async removeChat(chatId: string, messageDocIds: string[]): Promise<void> {
        if (!this.hasEncryption()) return;

        await this.open();
        if (!this.db) return;

        // Remove chat
        const chatTransaction = this.db.transaction(STORES.CHATS, 'readwrite');
        chatTransaction.objectStore(STORES.CHATS).delete(chatId);
        await promisifyTransaction(chatTransaction);

        // Remove messages
        if (messageDocIds.length > 0) {
            const messageTransaction = this.db.transaction(STORES.MESSAGES, 'readwrite');
            const messageStore = messageTransaction.objectStore(STORES.MESSAGES);
            for (const docId of messageDocIds) {
                messageStore.delete(docId);
            }
            await promisifyTransaction(messageTransaction);
        }
    }

    /**
     * Update the index metadata
     */
    async updateMeta(chatCount: number, messageCount: number): Promise<void> {
        if (!this.hasEncryption()) return;

        await this.open();
        if (!this.db) return;

        const meta: IndexMeta = {
            version: CURRENT_VERSION,
            lastUpdatedAt: Date.now(),
            chatCount,
            messageCount,
        };

        const encrypted = await this.encrypt(meta);
        const transaction = this.db.transaction(STORES.META, 'readwrite');
        transaction.objectStore(STORES.META).put(encrypted, META_KEY);
        await promisifyTransaction(transaction);
    }

    /**
     * Clear all index data
     */
    async clear(): Promise<void> {
        await this.open();
        if (!this.db) return;

        const transaction = this.db.transaction(
            [STORES.META, STORES.CHATS, STORES.MESSAGES],
            'readwrite'
        );

        transaction.objectStore(STORES.META).clear();
        transaction.objectStore(STORES.CHATS).clear();
        transaction.objectStore(STORES.MESSAGES).clear();

        await promisifyTransaction(transaction);
    }

    /**
     * Destroy the database completely
     */
    async destroy(): Promise<void> {
        this.close();
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(DB_NAME);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
}

// Singleton instance for the worker
let storageInstance: SearchStorage | null = null;

export function getSearchStorage(): SearchStorage {
    if (!storageInstance) {
        storageInstance = new SearchStorage();
    }
    return storageInstance;
}
