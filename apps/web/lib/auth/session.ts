import { auth, clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@vero/db';
import { readGuestSession, clearGuestSession } from './guest';
import { migrateGuestData } from './migration';
import type { AppSession } from './types';

export async function getAppSession(): Promise<AppSession | null> {
  if (process.env.APP_E2E === '1') {
    return {
      user: {
        id: 'e2e-user',
        type: 'guest',
        email: 'playwright@example.com',
      },
    };
  }
  // If Clerk environment variables are not present (e.g. local CI/test), skip auth() and fall back to guest logic.
  const hasClerkEnv =
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (hasClerkEnv) {
    try {
      const a = await auth();
      if (a.userId) {
        // Resolve email reliably from Clerk user profile; session claims may not include it for some providers
        let resolvedEmail: string | undefined;
        try {
          const client = await clerkClient();
          const user = await client.users.getUser(a.userId);
          resolvedEmail =
            user.primaryEmailAddress?.emailAddress ||
            user.emailAddresses?.[0]?.emailAddress ||
            undefined;
        } catch {
          /* ignore, fallback below */
        }
        if (!resolvedEmail) {
          const claims = a.sessionClaims as any;
          resolvedEmail =
            claims?.email ||
            claims?.email_address ||
            (claims?.primary_email_address as string | undefined);
        }
        try {
          await prisma.user.upsert({
            where: { id: a.userId },
            update: { email: resolvedEmail },
            create: {
              id: a.userId,
              email: resolvedEmail || 'user@unknown',
            },
          });
        } catch {
          /* non-fatal */
        }

        // Check for upgrade path: User is logged in, but has a guest session cookie
        try {
          const guest = await readGuestSession();
          if (guest?.uid && guest.uid !== a.userId) {
            // Found a guest session that doesn't match current user (different ID)
            // Migrate server-side data from guest -> user
            await migrateGuestData(guest.uid, a.userId);
            // Cleanup guest session immediately after migration
            await clearGuestSession();
          }
        } catch (e) {
          console.warn('Failed to migrate guest session', e);
        }

        return {
          user: {
            id: a.userId,
            type: 'regular',
            email: resolvedEmail,
          },
        };
      }
    } catch {
      // Ignore – treat as guest below.
    }
  }

  // Guest cookie fallback
  const guest = await readGuestSession();
  if (guest) {
    try {
      await prisma.user.upsert({
        where: { id: guest.uid },
        update: { email: guest.email },
        create: { id: guest.uid, email: guest.email },
      });
    } catch {
      /* ignore */
    }
    return { user: { id: guest.uid, type: 'guest', email: guest.email } };
  }

  return null;
}

export type { AppSession } from './types';
