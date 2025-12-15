/**
 * Worker-side storage utilities for search index persistence.
 * This module handles encryption and IndexedDB storage entirely within the worker
 * to avoid blocking the main thread.
 */

const DB_NAME = 'ViridSearchIndex';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'search-index-v1';

const AES_GCM_IV_LENGTH = 12;

let db: IDBDatabase | null = null;
let encryptionKey: CryptoKey | null = null;

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export async function initializeEncryptionKey(
    base64Key: string
): Promise<void> {
    const rawKey = base64ToUint8Array(base64Key);
    const normalized: ArrayBuffer =
        rawKey.byteOffset === 0 && rawKey.byteLength === rawKey.buffer.byteLength
            ? (rawKey.buffer as ArrayBuffer)
            : rawKey.slice().buffer;

    encryptionKey = await crypto.subtle.importKey(
        'raw',
        normalized,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export function hasEncryptionKey(): boolean {
    return encryptionKey !== null;
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            reject(new Error('Failed to open search index database'));
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = (event.target as IDBOpenDBRequest).result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}

interface EncryptedRecord {
    key: string;
    ciphertext: ArrayBuffer;
    iv: Uint8Array;
    cachedAt: number;
}

async function encryptData<T>(data: T): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array }> {
    if (!encryptionKey) {
        throw new Error('Encryption key not initialized');
    }

    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
    const encoded = new TextEncoder().encode(JSON.stringify(data));

    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        encryptionKey,
        encoded
    );

    return { ciphertext, iv };
}

async function decryptData<T>(ciphertext: ArrayBuffer, iv: Uint8Array): Promise<T> {
    if (!encryptionKey) {
        throw new Error('Encryption key not initialized');
    }

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        encryptionKey,
        ciphertext
    );

    const decoded = new TextDecoder().decode(decrypted);
    return JSON.parse(decoded) as T;
}

export async function persistSnapshot<T>(snapshot: T): Promise<void> {
    if (!encryptionKey) {
        console.warn('[WorkerStorage] Cannot persist: no encryption key');
        return;
    }

    const database = await openDB();
    const { ciphertext, iv } = await encryptData(snapshot);

    const record: EncryptedRecord = {
        key: SNAPSHOT_KEY,
        ciphertext,
        iv,
        cachedAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onerror = () => {
            reject(new Error('Failed to persist search index snapshot'));
        };

        request.onsuccess = () => {
            resolve();
        };
    });
}

export async function loadSnapshot<T>(): Promise<T | null> {
    if (!encryptionKey) {
        console.warn('[WorkerStorage] Cannot load: no encryption key');
        return null;
    }

    const database = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(SNAPSHOT_KEY);

        request.onerror = () => {
            reject(new Error('Failed to load search index snapshot'));
        };

        request.onsuccess = () => {
            const record = request.result as EncryptedRecord | undefined;
            if (!record) {
                resolve(null);
                return;
            }

            decryptData<T>(record.ciphertext, record.iv)
                .then(resolve)
                .catch((error) => {
                    console.warn('[WorkerStorage] Failed to decrypt snapshot:', error);
                    resolve(null);
                });
        };
    });
}

export async function clearSnapshot(): Promise<void> {
    const database = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(SNAPSHOT_KEY);

        request.onerror = () => {
            reject(new Error('Failed to clear search index snapshot'));
        };

        request.onsuccess = () => {
            resolve();
        };
    });
}
