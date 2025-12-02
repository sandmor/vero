'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

// Centralized QueryClient so components can share caching logic.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Create once per browser session. Using function form ensures no SSR mismatch.
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1 minute default freshness for lightweight metadata
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount: number, error: unknown) => {
              // Avoid hammering server on auth / 4xx or custom errors
              if (typeof error === 'object' && error && 'status' in error) {
                const status = (error as any).status;
                if (typeof status === 'number' && status >= 400 && status < 500)
                  return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {/* Devtools auto tree-shakes from prod because of process.env.NODE_ENV */}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
    </QueryClientProvider>
  );
}
