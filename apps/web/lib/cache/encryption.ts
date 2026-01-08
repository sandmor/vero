'use client';

import type { EncryptedEnvelope } from '@/lib/cache/dexie-schema';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const AES_GCM_KEY_LENGTH = 256; // bits
export const AES_GCM_IV_LENGTH = 12; // bytes

function assertWebCrypto(): Crypto {
  const cryptoRef = globalThis.crypto;
  if (!cryptoRef?.subtle) {
    throw new Error('Web Crypto API is not available in this environment.');
  }
  return cryptoRef;
}

function createAlgorithm(iv: Uint8Array, aad?: Uint8Array): AesGcmParams {
  if (iv.byteLength !== AES_GCM_IV_LENGTH) {
    throw new Error('Invalid IV length for AES-GCM.');
  }
  return aad
    ? {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: aad as BufferSource,
      }
    : { name: 'AES-GCM', iv: iv as BufferSource };
}

export function uint8ArrayToBase64(buffer: Uint8Array): string {
  let binary = '';
  const bytes = buffer;
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function importAesKeyFromBase64(
  base64Key: string
): Promise<CryptoKey> {
  const cryptoRef = assertWebCrypto();
  const rawKey = base64ToUint8Array(base64Key);
  const normalized: ArrayBuffer =
    rawKey.byteOffset === 0 && rawKey.byteLength === rawKey.buffer.byteLength
      ? (rawKey.buffer as ArrayBuffer)
      : rawKey.slice().buffer;
  return cryptoRef.subtle.importKey(
    'raw',
    normalized,
    { name: 'AES-GCM', length: AES_GCM_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<EncryptedEnvelope> {
  const cryptoRef = assertWebCrypto();
  const iv = cryptoRef.getRandomValues(new Uint8Array(AES_GCM_IV_LENGTH));
  const algorithm = createAlgorithm(iv, aad);
  const plaintextSource: ArrayBuffer =
    plaintext.byteOffset === 0 &&
    plaintext.byteLength === plaintext.buffer.byteLength
      ? (plaintext.buffer as ArrayBuffer)
      : plaintext.slice().buffer;
  const ciphertextBuffer = await cryptoRef.subtle.encrypt(
    algorithm,
    key,
    plaintextSource
  );
  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    iv,
    aad,
  };
}

export async function decryptBytes(
  key: CryptoKey,
  envelope: EncryptedEnvelope
): Promise<Uint8Array> {
  const cryptoRef = assertWebCrypto();
  const algorithm = createAlgorithm(envelope.iv, envelope.aad);
  const ciphertextSource: ArrayBuffer =
    envelope.ciphertext.byteOffset === 0 &&
    envelope.ciphertext.byteLength === envelope.ciphertext.buffer.byteLength
      ? (envelope.ciphertext.buffer as ArrayBuffer)
      : envelope.ciphertext.slice().buffer;
  const plaintextBuffer = await cryptoRef.subtle.decrypt(
    algorithm,
    key,
    ciphertextSource
  );
  return new Uint8Array(plaintextBuffer);
}

export async function encryptJson<T>(
  key: CryptoKey,
  payload: T,
  aad?: Uint8Array
): Promise<EncryptedEnvelope> {
  const encoded = textEncoder.encode(JSON.stringify(payload));
  return encryptBytes(key, encoded, aad);
}

export async function decryptJson<T>(
  key: CryptoKey,
  envelope: EncryptedEnvelope
): Promise<T> {
  const bytes = await decryptBytes(key, envelope);
  const decoded = textDecoder.decode(bytes);
  return JSON.parse(decoded) as T;
}

export async function fetchEncryptionKey(
  signal?: AbortSignal
): Promise<{ cryptoKey: CryptoKey; base64Key: string }> {
  const url =
    process.env.NEXT_PUBLIC_CACHE_ENCRYPTION_URL || '/api/cache/encryption-key';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    throw new Error('Failed to obtain cache encryption key.');
  }

  const { key } = (await response.json()) as { key: string };
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Received malformed encryption key response.');
  }

  const cryptoKey = await importAesKeyFromBase64(key);
  return { cryptoKey, base64Key: key };
}
