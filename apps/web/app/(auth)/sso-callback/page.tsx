'use client';

import { Logo } from '@/components/logo';
import { useClerk } from '@clerk/nextjs';
import { useEffect, useState } from 'react';

export default function SSOCallbackPage() {
  const { handleRedirectCallback } = useClerk();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        await handleRedirectCallback({
          // We provide these as safe defaults, but Clerk will prioritize
          // the 'redirectUrlComplete' passed during the initial authenticateWithRedirect() call.
          signInFallbackRedirectUrl: '/',
          signUpFallbackRedirectUrl: '/',
        });
      } catch (e: any) {
        // Capture detailed Clerk errors if available
        setError(
          e?.errors?.[0]?.message ||
            e?.message ||
            'An error occurred during verification'
        );
      }
    };

    handleCallback();
  }, [handleRedirectCallback]);

  if (error) {
    return (
      <div className="flex h-dvh w-screen flex-col items-center justify-center gap-6 bg-background text-center">
        <Logo size={64} className="grayscale opacity-20" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-destructive">
            Authentication Error
          </h3>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            {error}
          </p>
        </div>
        <a
          href="/login"
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          Back to Login
        </a>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh w-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center justify-center">
        <Logo size={64} className="animate-pulse" />
        <p className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground animate-pulse">
          Syncing Credentials
        </p>
      </div>
      <div id="clerk-captcha" className="absolute bottom-4" />
    </div>
  );
}
