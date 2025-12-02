'use client';

import { useSignIn, useSignUp } from '@clerk/nextjs';
import { useCallback } from 'react';
import { LogoGoogle } from '@/components/icons';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import {
  buildAbsoluteRedirectUrl,
  sanitizeRedirectPath,
} from '@/lib/auth/redirects';

export function SocialAuthButtons({
  mode,
  redirectUrlComplete = '/',
}: {
  mode: 'sign-in' | 'sign-up';
  redirectUrlComplete?: string;
}) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return null; // Clerk not configured
  if (process.env.NEXT_PUBLIC_DISABLE_SOCIAL_AUTH === '1') return null; // explicit disable
  if (process.env.PLAYWRIGHT || process.env.CI_PLAYWRIGHT) return null; // skip in test env to avoid external redirects

  const safeRedirect = sanitizeRedirectPath(redirectUrlComplete);
  const absoluteRedirect = buildAbsoluteRedirectUrl(safeRedirect);

  // We differentiate sign-in vs sign-up for metrics / potential provider routing.
  return <GoogleButton mode={mode} redirectUrlComplete={absoluteRedirect} />;
}

function GoogleButton({
  mode,
  redirectUrlComplete,
}: {
  mode: 'sign-in' | 'sign-up';
  redirectUrlComplete: string;
}) {
  const signInCtx = useSignIn();
  const signUpCtx = useSignUp();
  const isLoaded = mode === 'sign-in' ? signInCtx.isLoaded : signUpCtx.isLoaded;

  const handle = useCallback(async () => {
    if (!isLoaded) return;
    try {
      if (mode === 'sign-in') {
        await signInCtx.signIn?.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: '/sso-callback',
          redirectUrlComplete,
        });
      } else {
        await signUpCtx.signUp?.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: '/sso-callback',
          redirectUrlComplete,
        });
      }
    } catch (e: any) {
      toast({
        type: 'error',
        description:
          e?.errors?.[0]?.message ||
          `Google ${mode === 'sign-in' ? 'sign-in' : 'sign-up'} failed`,
      });
    }
  }, [isLoaded, mode, redirectUrlComplete, signInCtx.signIn, signUpCtx.signUp]);

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handle}
      disabled={!isLoaded}
      className="w-full"
      aria-label={`Continue with Google (${mode})`}
      data-testid={`google-${mode}-button`}
    >
      <LogoGoogle size={18} />
      Continue with Google
    </Button>
  );
}
