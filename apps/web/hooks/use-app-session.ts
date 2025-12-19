'use client';

import { useQuery } from '@tanstack/react-query';
import type { AppSession } from '@/lib/auth/types';

export const SESSION_QUERY_KEY = ['auth', 'session'] as const;

type SessionResponse = { session: AppSession | null; isAdmin?: boolean };

class SessionFetchError extends Error {
  status?: number;
}

async function fetchSession(): Promise<SessionResponse> {
  const response = await fetch('/api/session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });

  if (!response.ok) {
    const error = new SessionFetchError('Failed to fetch session');
    error.status = response.status;
    throw error;
  }

  return response.json();
}

export function useAppSession() {
  return useQuery<SessionResponse, SessionFetchError>({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 0,
  });
}
