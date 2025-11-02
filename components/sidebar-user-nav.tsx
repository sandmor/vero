'use client';

import { useClerk, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronUp } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { guestRegex } from '@/lib/constants';
import { SESSION_QUERY_KEY } from '@/hooks/use-app-session';
import type { SessionUser } from '@/lib/auth/types';

type NavUser = Partial<SessionUser>;

type SidebarUserNavProps = {
  user?: NavUser | null;
  isLoading?: boolean;
};

export function SidebarUserNav({
  user,
  isLoading = false,
}: SidebarUserNavProps) {
  const router = useRouter();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { isSignedIn, user: clerkUser } = useUser();
  const { setTheme, resolvedTheme } = useTheme();
  const authStateRef = useRef<'unknown' | 'signed-in' | 'signed-out'>(
    'unknown'
  );
  const lastClerkUserIdRef = useRef<string | null>(null);

  const clerkUserId = clerkUser?.id ?? null;

  useEffect(() => {
    if (isSignedIn === undefined) return;
    const nextState = isSignedIn ? 'signed-in' : 'signed-out';
    if (authStateRef.current === nextState) return;
    authStateRef.current = nextState;
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [isSignedIn, queryClient]);

  useEffect(() => {
    if (!clerkUserId) return;
    if (lastClerkUserIdRef.current === clerkUserId) return;
    lastClerkUserIdRef.current = clerkUserId;
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [clerkUserId, queryClient]);

  const clerkEmail =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses?.[0]?.emailAddress ??
    null;
  const sessionEmail = user?.email ?? null;
  const effectiveEmail = clerkEmail ?? sessionEmail ?? null;

  const sessionIndicatesGuest =
    user?.type === 'guest' || guestRegex.test(sessionEmail ?? '');
  const signedIn = isSignedIn === true;
  const isGuest = !signedIn && (sessionIndicatesGuest || !user?.id);

  const displayLabel = isLoading
    ? 'Loading…'
    : signedIn
      ? (effectiveEmail ?? 'Account')
      : sessionIndicatesGuest
        ? 'Guest'
        : (sessionEmail ?? 'Guest');

  const avatarSeed =
    effectiveEmail ?? sessionEmail ?? clerkUserId ?? user?.id ?? 'guest';
  const avatarSrc = `https://avatar.vercel.sh/${encodeURIComponent(avatarSeed)}`;
  const avatarAlt = effectiveEmail ?? sessionEmail ?? 'User Avatar';

  const currentTheme = resolvedTheme ?? 'light';
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';

  const handleAuthAction = async () => {
    if (isGuest) {
      router.push('/login');
      return;
    }

    try {
      await signOut();
    } finally {
      authStateRef.current = 'signed-out';
      try {
        await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      } catch {
        /* no-op */
      }
      router.push('/');
      router.refresh();
    }
  };

  const canOpenSettings = !isGuest && !isLoading;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {
              <SidebarMenuButton
                className="h-10 bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                data-testid="user-nav-button"
              >
                <Image
                  alt={avatarAlt}
                  className="rounded-full"
                  height={24}
                  src={avatarSrc}
                  width={24}
                />
                <span className="truncate" data-testid="user-email">
                  {displayLabel}
                </span>
                <ChevronUp className="ml-auto" />
              </SidebarMenuButton>
            }
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-popper-anchor-width)"
            data-testid="user-nav-menu"
            side="top"
          >
            {canOpenSettings && (
              <DropdownMenuItem
                className="cursor-pointer"
                onSelect={() => router.push('/settings?tab=archive')}
              >
                Account & Settings
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="cursor-pointer"
              data-testid="user-nav-item-theme"
              onSelect={() => setTheme(nextTheme)}
            >
              {`Toggle ${nextTheme} mode`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild data-testid="user-nav-item-auth">
              <button
                className="w-full cursor-pointer"
                disabled={isLoading}
                onClick={() => {
                  void handleAuthAction();
                }}
                type="button"
              >
                {isGuest ? 'Login to your account' : 'Sign out'}
              </button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
