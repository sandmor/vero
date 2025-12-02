import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { hkdfSync } from 'crypto';

const KEY_LENGTH_BYTES = 32;
const HKDF_DIGEST = 'sha256';
const HKDF_INFO = Buffer.from('virid-cache-encryption', 'utf8');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSecretKey(): Buffer | null {
  const secret = process.env.CACHE_ENCRYPTION_SECRET;
  if (!secret) {
    return null;
  }
  return Buffer.from(secret, 'base64');
}

function deriveKey(stableId: string, secret: Buffer): string {
  const ikm = Buffer.from(stableId, 'utf8');
  const salt = secret;
  const derived = hkdfSync(HKDF_DIGEST, ikm, salt, HKDF_INFO, KEY_LENGTH_BYTES);
  return Buffer.from(derived).toString('base64');
}

function e2eKey(): string {
  const sessionSeed = process.env.APP_E2E_SESSION_ID ?? 'virid-e2e-session';
  const secret = process.env.APP_E2E_SECRET ?? 'virid-e2e-secret';
  return deriveKey(sessionSeed, Buffer.from(secret, 'utf8'));
}

async function resolveStableSessionId(): Promise<{
  userId: string | null;
  stableId: string | null;
}> {
  const hasClerkEnv =
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!hasClerkEnv) {
    return { userId: null, stableId: null };
  }

  try {
    const authState = await auth();
    const { userId, sessionId, sessionClaims } = authState;

    const claims = sessionClaims as Record<string, unknown> | undefined;
    const stableId =
      sessionId ||
      (typeof claims?.sid === 'string' ? (claims.sid as string) : undefined) ||
      userId ||
      null;

    return { userId: userId ?? null, stableId };
  } catch (error) {
    console.warn(
      'Failed to resolve Clerk session for encryption key request',
      error
    );
    return { userId: null, stableId: null };
  }
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(_request: NextRequest) {
  if (process.env.APP_E2E === '1') {
    const key = e2eKey();
    return NextResponse.json(
      { key },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }

  const secret = getSecretKey();
  if (!secret) {
    console.error('CACHE_ENCRYPTION_SECRET is not configured.');
    return NextResponse.json(
      { error: 'Cache encryption is not configured.' },
      { status: 503 }
    );
  }

  const { userId, stableId } = await resolveStableSessionId();

  if (!userId || !stableId) {
    return unauthorizedResponse();
  }

  try {
    const key = deriveKey(stableId, secret);

    return NextResponse.json(
      { key },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('Failed to derive cache encryption key', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
