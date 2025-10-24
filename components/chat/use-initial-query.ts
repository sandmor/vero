'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { generateUUID } from '@/lib/utils';
import type { ChatMessage } from '@/lib/types';

export function useInitialQuery({
  id,
  messages,
  sendMessage,
  regenerate,
}: {
  id: string;
  messages: ChatMessage[];
  sendMessage: (message: ChatMessage) => void;
  regenerate: () => void;
}) {
  const searchParams = useSearchParams();
  const query = searchParams.get('query');
  const regenerateParam = searchParams.get('regenerate');
  const initialQueryHandledRef = useRef(false);
  const initialRegenerateHandledRef = useRef(false);

  useEffect(() => {
    if (!query) return;
    if (initialQueryHandledRef.current) return;
    const existingSame = messages.some(
      (m) =>
        m.role === 'user' &&
        m.parts.some((p) => p.type === 'text' && p.text === query)
    );
    if (existingSame) {
      initialQueryHandledRef.current = true;
      window.history.replaceState({}, '', `/chat/${id}`);
      return;
    }
    initialQueryHandledRef.current = true;
    sendMessage({
      id: generateUUID(),
      role: 'user' as const,
      parts: [{ type: 'text', text: query }],
    });
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [query, messages, sendMessage, id]);

  useEffect(() => {
    if (!regenerateParam) return;
    if (initialRegenerateHandledRef.current) return;
    if (messages.length === 0) return;
    initialRegenerateHandledRef.current = true;
    regenerate();
    window.history.replaceState({}, '', `/chat/${id}`);
  }, [regenerateParam, messages, regenerate, id]);
}
