import { createClerkClient } from '@clerk/backend';
import { parseGuestSession } from '@vero/shared/auth';
import { deriveEncryptionKey } from '@vero/shared/encryption';
import { ExecutionContext, Hono } from 'hono';
import { cors } from 'hono/cors';

export interface Env {
  CACHE_ENCRYPTION_SECRET: string;
  GUEST_SECRET: string;
  CLERK_SECRET_KEY: string;
  CLERK_PUBLISHABLE_KEY: string;
  ALLOWED_ORIGINS: string;
  BASE_PATH?: string;
}

const api = new Hono<{ Bindings: Env }>();

// Global CORS middleware
api.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!c.env.ALLOWED_ORIGINS) return origin; // Allow all if not configured
      
      const allowedList = c.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
      return allowedList.includes(origin) ? origin : 'null';
    },
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Cookie', 'Authorization'],
    credentials: true,
  });
  
  return corsMiddleware(c, next);
});

api.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'vero-edge-gateway',
    timestamp: new Date().toISOString() 
  });
});

api.post('/v1/keys', async (c) => {
  try {
    const cookieHeader = c.req.header('Cookie') ?? '';
    
    // Resolve Session ID
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
        decodedGuestCookie = guestCookie;
      }
    }

    const guest = parseGuestSession(decodedGuestCookie, c.env.GUEST_SECRET);
    let stableId = guest?.uid;

    // Fallback to Clerk if no guest session
    if (!stableId && c.env.CLERK_SECRET_KEY) {
      const clerk = createClerkClient({
        secretKey: c.env.CLERK_SECRET_KEY,
        publishableKey: c.env.CLERK_PUBLISHABLE_KEY,
      });

      try {
        const requestState = await clerk.authenticateRequest(c.req.raw);
        if (requestState.isSignedIn) {
          stableId = requestState.toAuth().sessionId;
        }
      } catch (e) {
        console.error('Clerk auth failed', e);
      }
    }

    if (!stableId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Derive and Return Key
    const key = deriveEncryptionKey(stableId, c.env.CACHE_ENCRYPTION_SECRET);
    
    return c.json({ key }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      }
    });
  } catch (error) {
    console.error('Edge Gateway Error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// Dynamic Routing Wrapper
// This allows the worker to be deployed at a subdomain OR a path prefix (e.g., /edge)
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const app = new Hono<{ Bindings: Env }>();
    
    if (env.BASE_PATH) {
      // If deployed behind a path (e.g. via Cloudflare Rules), mount the API there
      app.route(env.BASE_PATH, api);
    } else {
      // Standard subdomain deployment
      app.route('/', api);
    }

    return app.fetch(request, env, ctx);
  }
};
