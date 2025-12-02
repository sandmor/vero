import { tool } from 'ai';
import { z } from 'zod';
import type { AppSession } from '@/lib/auth/session';
import {
  pinArchiveEntryToChat,
  unpinArchiveEntryFromChat,
} from '@/lib/db/queries';

export const manageChatPins = ({
  session,
  chatId,
}: {
  session: AppSession;
  chatId: string;
}) =>
  tool({
    description: 'Add or remove pinned archive entries for the current chat.',
    inputSchema: z.object({
      add: z
        .array(z.string())
        .optional()
        .describe('A list of entry slugs to pin to the chat.'),
      remove: z
        .array(z.string())
        .optional()
        .describe('A list of entry slugs to unpin from the chat.'),
    }),
    execute: async ({ add, remove }) => {
      if (!session.user?.id) {
        return { error: 'No active user session' };
      }
      const userId = session.user.id;
      const results: { slug: string; status: string; error?: string }[] = [];

      if (remove) {
        for (const slug of remove) {
          try {
            await unpinArchiveEntryFromChat({ userId, chatId, slug });
            results.push({ slug, status: 'unpinned' });
          } catch (e: any) {
            results.push({ slug, status: 'error', error: e.message });
          }
        }
      }

      if (add) {
        for (const slug of add) {
          try {
            await pinArchiveEntryToChat({ userId, chatId, slug });
            results.push({ slug, status: 'pinned' });
          } catch (e: any) {
            results.push({ slug, status: 'error', error: e.message });
          }
        }
      }

      return results;
    },
  });
