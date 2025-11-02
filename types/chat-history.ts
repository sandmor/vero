import type { Chat } from '@/lib/db/schema';

export type ChatHistory = {
  chats: Chat[];
  hasMore: boolean;
};
