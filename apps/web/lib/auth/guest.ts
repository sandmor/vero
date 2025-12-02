import { cookies } from 'next/headers';
import crypto from 'node:crypto';
import { generateUUID } from '@/lib/utils';

const COOKIE_NAME = 'guest_session';
const ALGO = 'sha256';

function getSecret() {
  const secret = process.env.GUEST_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('Missing GUEST_SECRET (or AUTH_SECRET as fallback)');
  }
  return secret;
}

export type GuestSessionPayload = {
  uid: string; // maps to prisma user id
  email: string;
  type: 'guest';
  iat: number; // issued at (ms)
  exp: number; // expiry (ms)
};

function sign(value: string) {
  return crypto.createHmac(ALGO, getSecret()).update(value).digest('hex');
}

export async function createGuestSession(maxAgeSeconds = 60 * 60 * 24) {
  // default 24h
  const now = Date.now();
  const email = `guest-${now}`; // deterministic pattern used for UI detection
  const uid = generateUUID();
  const exp = now + maxAgeSeconds * 1000;
  const payload: GuestSessionPayload = {
    uid,
    email,
    type: 'guest',
    iat: now,
    exp,
  };
  const json = JSON.stringify(payload);
  const signature = sign(json);
  const jar = await cookies();
  jar.set(COOKIE_NAME, Buffer.from(json).toString('base64') + '.' + signature, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === 'production',
  });
  return payload;
}

export async function readGuestSession(): Promise<GuestSessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [b64, sig] = raw.split('.');
  if (!b64 || !sig) return null;
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    if (sign(json) !== sig) return null;
    const parsed = JSON.parse(json) as GuestSessionPayload;
    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) {
      // expired -> clear cookie lazily
      try {
        await clearGuestSession();
      } catch {}
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearGuestSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
