import { createHmac } from 'node:crypto';

export type GuestSessionPayload = {
  uid: string;
  email: string;
  type: 'guest';
  iat: number;
  exp: number;
};

const GUEST_ALGO = 'sha256';

/**
 * Signs a guest session payload.
 */
export function signGuestSession(json: string, secret: string): string {
  return createHmac(GUEST_ALGO, secret).update(json).digest('hex');
}

/**
 * Verifies the HMAC signature of a guest session.
 */
export function verifyGuestSignature(json: string, signature: string, secret: string): boolean {
  const expected = createHmac(GUEST_ALGO, secret).update(json).digest('hex');
  return expected === signature;
}

/**
 * Parses and validates a guest session cookie string.
 */
export function parseGuestSession(
  cookieValue: string | undefined, 
  secret: string
): GuestSessionPayload | null {
  if (!cookieValue) return null;

  const [b64, sig] = cookieValue.split('.');
  if (!b64 || !sig) return null;

  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    if (!verifyGuestSignature(json, sig, secret)) return null;

    const parsed = JSON.parse(json) as GuestSessionPayload;
    // Check expiry
    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
