'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  convertToUIMessages,
  fetchWithErrorHandlers,
  generateUUID,
} from '@/lib/utils';
import { useDataStream } from '@/components/data-stream-provider';
import { toast } from '@/components/toast';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import type { MessageTreeResult } from '@/lib/db/schema';
import type { VisibilityType } from '../visibility-selector';

export function useChatState({
  id,
  initialMessages: initialMessageTree,
  visibilityType,
  currentModelId,
  stagedPinnedSlugs,
  stagedAllowedTools,
  stagedReasoningEffort,
  stagedAgentId,
  chatHasStarted,
  onFinish,
}: {
  id: string;
  initialMessages?: MessageTreeResult;
  visibilityType: VisibilityType;
  currentModelId: string;
  stagedPinnedSlugs: string[];
  stagedAllowedTools: string[] | undefined;
  stagedReasoningEffort: 'low' | 'medium' | 'high' | undefined;
  stagedAgentId: string | undefined;
  chatHasStarted: React.MutableRefObject<boolean>;
  onFinish?: () => void;
}) {
  const queryClient = useQueryClient();
  const { setDataStream } = useDataStream();
  const [usage, setUsage] = useState<AppUsage | undefined>(undefined);

  const initialMessages = useMemo<ChatMessage[]>(
    () =>
      initialMessageTree ? convertToUIMessages(initialMessageTree.branch) : [],
    [initialMessageTree]
  );

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    error: chatError,
    clearError: clearChatError,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        return {
          body: {
            ...request.body,
            id: request.id,
            message: request.messages.at(-1),
            selectedChatModel: currentModelId,
            selectedVisibilityType: visibilityType,
            pinnedSlugs:
              stagedPinnedSlugs.length > 0 ? stagedPinnedSlugs : undefined,
            allowedTools: !chatHasStarted.current
              ? stagedAllowedTools
              : undefined,
            reasoningEffort: !chatHasStarted.current
              ? stagedReasoningEffort
              : undefined,
            agentId: !chatHasStarted.current ? stagedAgentId : undefined,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      onFinish?.();
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      }
    },
  });

  return {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    chatError,
    clearChatError,
    usage,
    setUsage,
  };
}
