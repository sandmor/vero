import { hkdfSync } from 'node:crypto';

export const KEY_LENGTH_BYTES = 32;
export const HKDF_DIGEST = 'sha256';
export const HKDF_INFO = Buffer.from('virid-cache-encryption', 'utf8');

/**
 * Derives the production encryption key using HKDF.
 * Isomorphic: Works in Node.js and Cloudflare Workers.
 */
export function deriveEncryptionKey(
  stableId: string,
  secretBase64: string
): string {
  const ikm = Buffer.from(stableId, 'utf8');
  const salt = Buffer.from(secretBase64, 'base64');

  const derived = hkdfSync(HKDF_DIGEST, ikm, salt, HKDF_INFO, KEY_LENGTH_BYTES);

  return Buffer.from(derived).toString('base64');
}

/**
 * Derives a predictable key for Testing/E2E environments.
 */
export function deriveTestingKey(
  sessionId: string,
  testSecret: string
): string {
  const ikm = Buffer.from(sessionId, 'utf8');
  const salt = Buffer.from(testSecret, 'utf8');

  const derived = hkdfSync(HKDF_DIGEST, ikm, salt, HKDF_INFO, KEY_LENGTH_BYTES);

  return Buffer.from(derived).toString('base64');
}
