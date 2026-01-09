import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { readGuestSession } from '@/lib/auth/guest';
import {
  deriveEncryptionKey,
  deriveTestingKey,
} from '@vero/shared/encryption';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSecretKey(): string | null {
  const secret = process.env.CACHE_ENCRYPTION_SECRET;
  if (!secret) {
    return null;
  }
  return secret;
}

async function resolveStableSessionId(): Promise<{
  userId: string | null;
  stableId: string | null;
}> {
  const hasClerkEnv =
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (hasClerkEnv) {
    try {
      const authState = await auth();
      const { userId, sessionId, sessionClaims } = authState;

      if (userId || sessionId) {
        const claims = sessionClaims as Record<string, unknown> | undefined;
        const stableId =
          sessionId ||
          (typeof claims?.sid === 'string'
            ? (claims.sid as string)
            : undefined) ||
          userId ||
          null;

        return { userId: userId ?? null, stableId };
      }
    } catch (error) {
      console.warn(
        'Failed to resolve Clerk session for encryption key request',
        error
      );
      // Fallthrough to guest check
    }
  }

  // Fallback: Check for guest session
  try {
    const guest = await readGuestSession();
    if (guest?.uid) {
      return { userId: guest.uid, stableId: guest.uid };
    }
  } catch (error) {
    console.warn('Failed to resolve guest session for encryption key', error);
  }

  return { userId: null, stableId: null };
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function POST(_request: NextRequest) {
  // E2E Testing Path
  if (process.env.APP_E2E === '1') {
    const sessionSeed = process.env.APP_E2E_SESSION_ID ?? 'vero-e2e-session';
    const secret = process.env.APP_E2E_SECRET ?? 'vero-e2e-secret';

    const key = deriveTestingKey(sessionSeed, secret);

    return NextResponse.json(
      { key },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }

  // Production/Development Path
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
    const key = deriveEncryptionKey(stableId, secret);

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
