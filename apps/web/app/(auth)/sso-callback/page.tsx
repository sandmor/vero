'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useClerk, useAuth } from '@clerk/nextjs';
import { Loader } from 'lucide-react';

// Generic OAuth callback landing page. Clerk will redirect here first, then to redirectUrlComplete.
// We still attempt a defensive redirect if a session is already present but Clerk didn't auto-forward.
export default function SSOCallbackPage() {
  const router = useRouter();
  const { sessionId } = useAuth();
  const clerk = useClerk();

  useEffect(() => {
    // If Clerk hasn't performed the final redirect yet but we have a session, push user onward.
    if (sessionId) {
      const t = setTimeout(() => router.replace('/'), 300);
      return () => clearTimeout(t);
    }
  }, [sessionId, router]);

  return (
    <div className="flex h-dvh w-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground">
        <Loader />
        <p>Finishing sign-in with Google…</p>
        {!sessionId && (
          <button
            type="button"
            onClick={() => clerk.redirectToSignIn()}
            className="text-primary underline-offset-4 hover:underline"
          >
            Having trouble? Restart sign-in
          </button>
        )}
      </div>
    </div>
  );
}
