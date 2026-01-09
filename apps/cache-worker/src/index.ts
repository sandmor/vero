import { createClerkClient } from '@clerk/backend';
import { parseGuestSession } from '@virid/shared/auth';
import { deriveEncryptionKey } from '@virid/shared/encryption';

export interface Env {
  CACHE_ENCRYPTION_SECRET: string;
  GUEST_SECRET: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS: string; // Comma-separated list of allowed origins
}

function getCorsHeaders(origin: string | null, allowedOrigins: string) {
  const allowedList = allowedOrigins.split(',').map((o) => o.trim());
  const isAllowed = origin && allowedList.includes(origin);

  const safeOrigin = isAllowed ? origin : 'null';

  return {
    'Access-Control-Allow-Origin': safeOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin, env.ALLOWED_ORIGINS || '');

    // CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders,
      });
    }

    // Resolve Session ID
    const cookieHeader = request.headers.get('Cookie') ?? '';
    const guestCookie = cookieHeader
      .split('; ')
      .find((s) => s.trim().startsWith('guest_session='))
      ?.slice('guest_session='.length);

    let decodedGuestCookie: string | undefined;
    if (guestCookie) {
      try {
        decodedGuestCookie = decodeURIComponent(guestCookie);
      } catch (e) {
        console.error('Failed to decode guest_session cookie:', e);
        decodedGuestCookie = guestCookie; // fallback to raw value
      }
    }

    const guest = parseGuestSession(decodedGuestCookie, env.GUEST_SECRET);
    let stableId = guest?.uid;

    // Fallback to Clerk
    if (!stableId && env.CLERK_SECRET_KEY) {
      const clerk = createClerkClient({
        secretKey: env.CLERK_SECRET_KEY,
        publishableKey: env.CLERK_PUBLISHABLE_KEY,
      });

      try {
        const requestState = await clerk.authenticateRequest(request);
        if (requestState.isSignedIn) {
          stableId = requestState.toAuth().sessionId;
        }
      } catch (e) {
        console.error('Clerk auth failed', e);
      }
    }

    if (!stableId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }

    // Derive and Return Key
    try {
      const key = deriveEncryptionKey(stableId, env.CACHE_ENCRYPTION_SECRET);
      return new Response(JSON.stringify({ key }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          ...corsHeaders,
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      });
    }
  },
};
