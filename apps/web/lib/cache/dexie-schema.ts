'use client';

import Dexie from 'dexie';

type SchemaVersion = 1;

export const CACHE_DB_NAME = 'VeroEncryptedCache';
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

class VeroCacheDatabase extends Dexie {
  chats!: Dexie.Table<ChatCacheRecord, string>;
  documents!: Dexie.Table<DocumentCacheRecord, string>;
  metadata!: Dexie.Table<CacheMetadataRecord, string>;

  constructor() {
    super(CACHE_DB_NAME, { autoOpen: false });

    (this as any).version(CACHE_DB_VERSION).stores({
      chats: 'chatId, lastUpdatedAt',
      documents: 'documentId, chatId, lastUpdatedAt',
      metadata: 'key',
    });
  }
}

let dbInstance: VeroCacheDatabase | null = null;

export function getCacheDB(): VeroCacheDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = new VeroCacheDatabase();
  return dbInstance;
}

export async function deleteCacheDB(): Promise<void> {
  if (dbInstance) {
    try {
      await (dbInstance as any).close();
    } catch {
      /* noop */
    }
    dbInstance = null;
  }

  await Dexie.delete(CACHE_DB_NAME);
}
