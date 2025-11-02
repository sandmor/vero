'use client';

import Dexie, { Table } from 'dexie';

type SchemaVersion = 1;

export const CACHE_DB_NAME = 'ViridEncryptedCache';
export const CACHE_DB_VERSION: SchemaVersion = 1;

export interface EncryptedEnvelope {
  /** AES-GCM ciphertext bytes */
  ciphertext: Uint8Array;
  /** 96-bit AES-GCM IV */
  iv: Uint8Array;
  /** Optional additional data used during encryption */
  aad?: Uint8Array;
}

export interface ChatCacheRecord extends EncryptedEnvelope {
  chatId: string;
  /** Epoch millis when chat was last updated server-side */
  lastUpdatedAt: number;
  /** Epoch millis when cache entry was persisted */
  cachedAt: number;
  /** Allows migrations/invalidations */
  schemaVersion: SchemaVersion;
  /** Associated metadata (unencrypted) used for optimistic sync */
  optimisticState?: {
    pendingMessageIds?: string[];
    lastClientMutationAt?: number;
  };
}

export interface DocumentCacheRecord extends EncryptedEnvelope {
  documentId: string;
  chatId: string | null;
  /** Epoch millis when document was last updated */
  lastUpdatedAt: number;
  cachedAt: number;
  schemaVersion: SchemaVersion;
}

export interface CacheMetadataRecord extends EncryptedEnvelope {
  key: string;
  cachedAt: number;
  schemaVersion: SchemaVersion;
}

class ViridCacheDatabase extends Dexie {
  chats!: Table<ChatCacheRecord, string>;
  documents!: Table<DocumentCacheRecord, string>;
  metadata!: Table<CacheMetadataRecord, string>;

  constructor() {
    super(CACHE_DB_NAME, { autoOpen: false });

    this.version(CACHE_DB_VERSION).stores({
      chats: 'chatId, lastUpdatedAt',
      documents: 'documentId, chatId, lastUpdatedAt',
      metadata: 'key',
    });
  }
}

let dbInstance: ViridCacheDatabase | null = null;

export function getCacheDB(): ViridCacheDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = new ViridCacheDatabase();
  return dbInstance;
}

export async function deleteCacheDB(): Promise<void> {
  if (dbInstance) {
    try {
      await dbInstance.close();
    } catch {
      /* noop */
    }
    dbInstance = null;
  }

  await Dexie.delete(CACHE_DB_NAME);
}
