import { cookies } from 'next/headers';
import { generateUUID } from '@/lib/utils';
import {
  type GuestSessionPayload,
  signGuestSession,
  parseGuestSession,
} from '@virid/shared/auth';

const COOKIE_NAME = 'guest_session';

function getSecret() {
  const secret = process.env.GUEST_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('Missing GUEST_SECRET (or AUTH_SECRET as fallback)');
  }
  return secret;
}

export type { GuestSessionPayload };

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
  const signature = signGuestSession(json, getSecret());
  const jar = await cookies();
  const domain = process.env.COOKIE_DOMAIN;

  jar.set(COOKIE_NAME, Buffer.from(json).toString('base64') + '.' + signature, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
    secure: process.env.NODE_ENV === 'production',
    domain,
  });
  return payload;
}

export async function readGuestSession(): Promise<GuestSessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const parsed = parseGuestSession(raw, getSecret());

  if (!parsed) {
    // If we have a cookie but it's invalid or expired, clear it.
    try {
      await clearGuestSession();
    } catch {}
    return null;
  }

  return parsed;
}

export async function clearGuestSession() {
  const jar = await cookies();
  const domain = process.env.COOKIE_DOMAIN;
  // Note: 'path' and 'domain' must match how it was set for deletion to work
  jar.delete({ name: COOKIE_NAME, path: '/', domain });
}
