'use client';

import { useMemo } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { updateChatVisibility } from '@/app/(chat)/actions';
import type { ChatHistory } from '@/types/chat-history';
import type { VisibilityType } from '@/components/visibility-selector';

export function useChatVisibility({
  chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  const queryClient = useQueryClient();
  // Local visibility (optimistic) stored in React Query cache
  const visibilityKey = ['chat', 'visibility', chatId];
  const { data: localVisibility } = useQuery<VisibilityType>({
    queryKey: visibilityKey,
    // Provide initial data only; canonical value is derived from history when present
    initialData: initialVisibilityType,
    queryFn: async () => initialVisibilityType,
    staleTime: Infinity,
    enabled: false, // we don't actually fetch
  });
  const history = queryClient.getQueryData<any>(['chat', 'history'])
    ?.pages?.[0] as ChatHistory | undefined; // best-effort; pages structure per infinite query

  const visibilityType = useMemo(() => {
    const chat = history?.chats?.find(
      (currentChat: any) => currentChat.id === chatId
    );
    if (!chat) {
      return 'private';
    }
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setVisibilityType = (updatedVisibilityType: VisibilityType) => {
    queryClient.setQueryData(visibilityKey, updatedVisibilityType);

    updateChatVisibility({
      chatId,
      visibility: updatedVisibilityType,
    });
  };

  return { visibilityType, setVisibilityType };
}
