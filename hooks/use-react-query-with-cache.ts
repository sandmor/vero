import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEncryptedCache } from '@/components/encrypted-cache-provider';
import type { QueryKey } from '@tanstack/react-query';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import { compareChatBootstrapData } from '@/lib/cache/cache-verification-utils';

interface UseReactQueryWithCacheOptions<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled?: boolean;
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: number | false;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
  // Cache verification options
  verifyCache?: boolean;
  onCacheInvalidated?: (freshData: T) => void;
  // For chat-specific cache operations
  chatId?: string;
}

export function useReactQueryWithCache<T = any>({
  queryKey,
  queryFn,
  enabled = true,
  staleTime = 5 * 60 * 1000, // 5 minutes default
  refetchOnWindowFocus = false,
  refetchOnReconnect = false,
  refetchInterval = false,
  onSuccess,
  onError,
  verifyCache = true,
  onCacheInvalidated,
  chatId,
}: UseReactQueryWithCacheOptions<T>) {
  const queryClient = useQueryClient();
  const {
    getCachedBootstrap,
    upsertChatRecord,
    ready: isCacheReady,
  } = useEncryptedCache();
  const verificationPromiseRef = useRef<Promise<void> | null>(null);

  // Get cached data if available
  const getCachedDataCallback = useCallback(() => {
    if (!chatId || !isCacheReady) return undefined;
    const cached = getCachedBootstrap(chatId);
    return cached as T | undefined;
  }, [chatId, isCacheReady, getCachedBootstrap]);

  // Verify cache with server
  const verifyCacheWithServer = useCallback(async () => {
    if (!verifyCache || !chatId || !isCacheReady || !enabled) {
      return;
    }

    // Prevent multiple concurrent verifications
    if (verificationPromiseRef.current) {
      return verificationPromiseRef.current;
    }

    const cachedData = getCachedDataCallback();
    if (!cachedData) {
      // No cached data, nothing to verify
      return;
    }

    verificationPromiseRef.current = (async () => {
      try {
        // Fetch fresh data from server while sharing state with React Query
        const freshData = await queryClient.fetchQuery({
          queryKey,
          queryFn,
        });

        // Compare cached and fresh data
        let isCacheValid = true;

        // Only compare if both are ChatBootstrapResponse
        if (
          isChatBootstrapResponse(cachedData) &&
          isChatBootstrapResponse(freshData)
        ) {
          isCacheValid = await compareChatBootstrapData(cachedData, freshData);
        } else {
          // For non-ChatBootstrapResponse data, use simple comparison
          isCacheValid =
            JSON.stringify(cachedData) === JSON.stringify(freshData);
        }

        if (!isCacheValid) {
          console.info(
            `Cache verification failed for chat ${chatId}, updating cache`
          );

          // Update encrypted cache if it's a chat bootstrap response with existing chat
          if (
            chatId &&
            isChatBootstrapResponse(freshData) &&
            (freshData as any).kind === 'existing' &&
            (freshData as any).prefetchedChat
          ) {
            const { computeChatLastUpdatedAt } = await import(
              '@/lib/chat/bootstrap-helpers'
            );
            const lastUpdatedAt = computeChatLastUpdatedAt({
              chat: {
                createdAt: new Date(
                  (freshData as any).prefetchedChat.createdAt
                ),
              },
              messages: (freshData as any).initialMessages ?? [],
              branchState: (freshData as any).initialBranchState,
            });

            await upsertChatRecord({
              chatId: (freshData as any).chatId,
              lastUpdatedAt,
              bootstrap: freshData as ChatBootstrapResponse,
              chat: (freshData as any).prefetchedChat,
            });
          }

          // Notify callback
          onCacheInvalidated?.(freshData);
        }
      } catch (error) {
        console.warn('Cache verification failed:', error);
        // Don't throw - verification failures shouldn't break the UI
      } finally {
        verificationPromiseRef.current = null;
      }
    })();

    return verificationPromiseRef.current;
  }, [
    verifyCache,
    chatId,
    isCacheReady,
    enabled,
    getCachedDataCallback,
    queryFn,
    queryKey,
    upsertChatRecord,
    onCacheInvalidated,
  ]);

  // React Query hook with cache integration
  const query = useQuery<T>({
    queryKey,
    queryFn: async () => {
      try {
        const data = await queryFn();

        // Update encrypted cache on successful fetch
        if (
          chatId &&
          data &&
          isChatBootstrapResponse(data) &&
          (data as any).kind === 'existing' &&
          (data as any).prefetchedChat
        ) {
          const { computeChatLastUpdatedAt } = await import(
            '@/lib/chat/bootstrap-helpers'
          );
          const lastUpdatedAt = computeChatLastUpdatedAt({
            chat: {
              createdAt: new Date((data as any).prefetchedChat.createdAt),
            },
            messages: (data as any).initialMessages ?? [],
            branchState: (data as any).initialBranchState,
          });

          await upsertChatRecord({
            chatId: (data as any).chatId,
            lastUpdatedAt,
            bootstrap: data as ChatBootstrapResponse,
            chat: (data as any).prefetchedChat,
          });
        }

        return data;
      } catch (error) {
        onError?.(error as Error);
        throw error;
      }
    },
    initialData: getCachedDataCallback(),
    enabled,
    staleTime,
    refetchOnWindowFocus,
    refetchOnReconnect,
    refetchInterval,
  });

  // Effect to verify cache when using cached data
  useEffect(() => {
    if (query.isLoading && query.data) {
      // We have cached data, verify it in background
      verifyCacheWithServer().catch(() => {
        // Errors are handled internally
      });
    }
  }, [query.isLoading, query.data, verifyCacheWithServer]);

  // Effect to verify cache after successful fetch
  useEffect(() => {
    if (!query.isFetching && query.data && !query.isLoading && verifyCache) {
      verifyCacheWithServer().catch(() => {
        // Errors are handled internally
      });
    }
  }, [
    query.isFetching,
    query.data,
    query.isLoading,
    verifyCache,
    verifyCacheWithServer,
  ]);

  // Call onSuccess callback when data is successfully fetched
  useEffect(() => {
    if (query.data && !query.isFetching && !query.isLoading) {
      onSuccess?.(query.data);
    }
  }, [query.data, query.isFetching, query.isLoading, onSuccess]);

  return {
    ...query,
    verifyCacheWithServer,
  };
}

// Helper function to check if data is a ChatBootstrapResponse
function isChatBootstrapResponse(data: any): data is ChatBootstrapResponse {
  return data && typeof data === 'object' && 'kind' in data && 'chatId' in data;
}
