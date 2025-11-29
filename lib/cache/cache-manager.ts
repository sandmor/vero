'use client';

import {
  CACHE_DB_VERSION,
  getCacheDB,
  deleteCacheDB,
} from '@/lib/cache/dexie-schema';
import type {
  CacheMetadataRecord,
  ChatCacheRecord,
  DocumentCacheRecord,
  EncryptedEnvelope,
} from '@/lib/cache/dexie-schema';
import { decryptJson, encryptJson } from '@/lib/cache/encryption';

export type CachedChatPayload<T = unknown> = {
  chatId: string;
  data: T;
  lastUpdatedAt: number;
  cachedAt: number;
  optimisticState?: ChatCacheRecord['optimisticState'];
};

export type CachedDocumentPayload<T = unknown> = {
  documentId: string;
  chatId: string | null;
  data: T;
  lastUpdatedAt: number;
  cachedAt: number;
};

export type MetadataPayload<T = unknown> = {
  key: string;
  data: T;
  cachedAt: number;
};

export class EncryptedCacheManager {
  private key: CryptoKey | null = null;

  private db = getCacheDB();

  private openPromise: Promise<void> | null = null;

  private isActive = false;

  async activate(key: CryptoKey): Promise<void> {
    this.key = key;
    this.isActive = true;
    await this.ensureOpen();
  }

  isInitialized(): boolean {
    return this.isActive && !!this.key;
  }

  async storeChats<T>(
    records: Array<{
      chatId: string;
      data: T;
      lastUpdatedAt: number;
      optimisticState?: ChatCacheRecord['optimisticState'];
    }>
  ): Promise<void> {
    if (!this.key || !this.isActive || records.length === 0) return;

    await this.ensureOpen();
    const now = Date.now();
    const encrypted = await Promise.all(
      records.map(async (record) => ({
        chatId: record.chatId,
        lastUpdatedAt: record.lastUpdatedAt,
        cachedAt: now,
        optimisticState: record.optimisticState,
        envelope: await encryptJson(this.key as CryptoKey, record.data),
      }))
    );

    for (const item of encrypted) {
      const payload: ChatCacheRecord = {
        chatId: item.chatId,
        lastUpdatedAt: item.lastUpdatedAt,
        cachedAt: item.cachedAt,
        schemaVersion: CACHE_DB_VERSION,
        ciphertext: item.envelope.ciphertext,
        iv: item.envelope.iv,
        aad: item.envelope.aad,
        optimisticState: item.optimisticState,
      };
      await this.db.chats.put(payload);
    }
  }

  async storeDocuments<T>(
    records: Array<{
      documentId: string;
      chatId: string | null;
      data: T;
      lastUpdatedAt: number;
    }>
  ): Promise<void> {
    if (!this.key || !this.isActive || records.length === 0) return;
    await this.ensureOpen();
    const now = Date.now();
    const encrypted = await Promise.all(
      records.map(async (record) => ({
        documentId: record.documentId,
        chatId: record.chatId,
        lastUpdatedAt: record.lastUpdatedAt,
        cachedAt: now,
        envelope: await encryptJson(this.key as CryptoKey, record.data),
      }))
    );

    for (const item of encrypted) {
      const payload: DocumentCacheRecord = {
        documentId: item.documentId,
        chatId: item.chatId,
        lastUpdatedAt: item.lastUpdatedAt,
        cachedAt: item.cachedAt,
        schemaVersion: CACHE_DB_VERSION,
        ciphertext: item.envelope.ciphertext,
        iv: item.envelope.iv,
        aad: item.envelope.aad,
      };
      await this.db.documents.put(payload);
    }
  }

  async storeMetadata<T>(key: string, data: T): Promise<void> {
    if (!this.key || !this.isActive) return;
    await this.ensureOpen();
    const now = Date.now();
    const envelope = await encryptJson(this.key as CryptoKey, data);
    const payload: CacheMetadataRecord = {
      key,
      cachedAt: now,
      schemaVersion: CACHE_DB_VERSION,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      aad: envelope.aad,
    };

    await this.db.metadata.put(payload);
  }

  async readMetadata<T>(key: string): Promise<MetadataPayload<T> | null> {
    if (!this.key || !this.isActive) return null;
    await this.ensureOpen();
    const record = await this.db.metadata.get(key);
    if (!record) return null;
    const data = await this.decryptEnvelope<T>(record);
    return { key: record.key, data, cachedAt: record.cachedAt };
  }

  async getChat<T>(chatId: string): Promise<CachedChatPayload<T> | null> {
    if (!this.key || !this.isActive) return null;
    await this.ensureOpen();
    const record = await this.db.chats.get(chatId);
    if (!record) return null;
    const data = await this.decryptEnvelope<T>(record);
    return {
      chatId: record.chatId,
      data,
      lastUpdatedAt: record.lastUpdatedAt,
      cachedAt: record.cachedAt,
      optimisticState: record.optimisticState,
    };
  }

  async getChats<T>(): Promise<CachedChatPayload<T>[]> {
    if (!this.key || !this.isActive) return [];
    await this.ensureOpen();
    const records = await this.db.chats
      .orderBy('lastUpdatedAt')
      .reverse()
      .toArray();
    const decrypted: CachedChatPayload<T>[] = [];
    for (const record of records) {
      const data = await this.decryptEnvelope<T>(record);
      decrypted.push({
        chatId: record.chatId,
        data,
        lastUpdatedAt: record.lastUpdatedAt,
        cachedAt: record.cachedAt,
        optimisticState: record.optimisticState,
      });
    }
    return decrypted;
  }

  async getDocuments<T>(): Promise<CachedDocumentPayload<T>[]> {
    if (!this.key || !this.isActive) return [];
    await this.ensureOpen();
    const records = await this.db.documents.toArray();
    const decrypted: CachedDocumentPayload<T>[] = [];
    for (const record of records) {
      const data = await this.decryptEnvelope<T>(record);
      decrypted.push({
        documentId: record.documentId,
        chatId: record.chatId,
        data,
        lastUpdatedAt: record.lastUpdatedAt,
        cachedAt: record.cachedAt,
      });
    }
    return decrypted;
  }

  async removeChat(chatId: string): Promise<void> {
    await this.ensureOpen();
    await this.db.chats.delete(chatId);
  }

  async reset(): Promise<void> {
    this.isActive = false;
    this.key = null;
    if ((this.db as any).isOpen()) {
      (this.db as any).close();
    }
    await deleteCacheDB();
    this.db = getCacheDB();
    this.openPromise = null;
  }

  deactivate(): void {
    this.key = null;
    this.isActive = false;
  }

  private async decryptEnvelope<T>(record: EncryptedEnvelope): Promise<T> {
    if (!this.key) {
      throw new Error('Cache manager used without an active key.');
    }
    return decryptJson<T>(this.key, record);
  }

  private async ensureOpen(): Promise<void> {
    if ((this.db as any).isOpen()) return;
    if (!this.openPromise) {
      this.openPromise = (this.db as any).open().then(() => {});
    }
    try {
      await this.openPromise;
    } catch (error) {
      this.openPromise = null;
      throw error;
    }
  }
}

let singletonManager: EncryptedCacheManager | null = null;

export function getEncryptedCacheManager(): EncryptedCacheManager {
  if (!singletonManager) {
    singletonManager = new EncryptedCacheManager();
  }
  return singletonManager;
}
