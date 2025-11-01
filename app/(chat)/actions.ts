'use server';

import { generateObject, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import type { VisibilityType } from '@/components/visibility-selector';
import { getLanguageModel } from '@/lib/ai/providers';
import { TITLE_GENERATION_MODEL } from '@/lib/ai/models';
import { forkChat, updateChatVisiblityById } from '@/lib/db/queries';
import { getAppSession } from '@/lib/auth/session';
import z from 'zod';

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set('chat-model', model);
}

export async function saveReasoningEffortAsCookie(
  effort: 'low' | 'medium' | 'high' | null
) {
  const cookieStore = await cookies();
  if (!effort) {
    cookieStore.delete('chat-reasoning');
    return;
  }
  cookieStore.set('chat-reasoning', effort);
}

export async function generateTitleFromChatHistory({
  messages,
}: {
  messages: UIMessage[];
}) {
  const model = await getLanguageModel(TITLE_GENERATION_MODEL);
  const { object } = await generateObject({
    model,
    schema: z.object({
      title: z
        .string()
        .max(80)
        .describe('A short title summarizing the conversation'),
    }),
    system: `\n
    - you will generate a short title based on the conversation content
    - ensure it is not more than 80 characters long
    - the title should be a summary of the main topic or question being discussed
    - focus on the user's intent and the conversation's core subject
    - do not surround the title with quotes
    - do not include any introductory phrases like "Title:" or "Summary:"
    - do not use markdown. The title must be in plain text, only emojis are allowed`,
    prompt: JSON.stringify(messages),
  });

  return object.title;
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  await updateChatVisiblityById({ chatId, visibility });
}

export async function forkChatAction({
  sourceChatId,
  pivotMessageId,
  mode,
  editedText,
}: {
  sourceChatId: string;
  pivotMessageId: string; // id of message being regenerated (assistant) or edited (user/assistant)
  mode: 'regenerate' | 'edit';
  editedText?: string;
}) {
  const session = await getAppSession();
  if (!session?.user) throw new Error('Unauthorized');
  const result = await forkChat({
    sourceChatId,
    pivotMessageId,
    userId: session.user.id,
    mode,
    editedText,
  });
  return result;
}
