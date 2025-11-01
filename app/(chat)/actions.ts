'use server';

import { generateObject, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import type { VisibilityType } from '@/components/visibility-selector';
import { getLanguageModel } from '@/lib/ai/providers';
import { TITLE_GENERATION_MODEL } from '@/lib/ai/models';
import {
  forkChat,
  getChatById,
  getMessagesByChatId,
  branchMessageWithEdit,
  updateHeadMessageByChatId,
  updateChatVisiblityById,
} from '@/lib/db/queries';
import { getAppSession } from '@/lib/auth/session';
import z from 'zod';

const IS_E2E = process.env.APP_E2E === '1';
const E2E_SESSION = {
  user: {
    id: 'e2e-user',
    type: 'guest' as const,
    email: 'playwright@example.com',
  },
};

async function requireSession() {
  if (IS_E2E) {
    return E2E_SESSION;
  }
  const session = await getAppSession();
  if (!session?.user) throw new Error('Unauthorized');
  return session;
}

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
  if (IS_E2E) {
    return;
  }
  await updateChatVisiblityById({ chatId, visibility });
}

export async function updateHeadMessage({
  chatId,
  messageId,
  expectedHeadId,
}: {
  chatId: string;
  messageId: string;
  expectedHeadId?: string | null;
}) {
  if (IS_E2E) {
    return;
  }

  const session = await requireSession();

  await updateHeadMessageByChatId({
    chatId,
    messageId,
    userId: session.user.id,
    expectedHeadId,
  });
}

export async function forkChatAction({
  sourceChatId,
  pivotMessageId,
  mode,
  editedText,
}: {
  sourceChatId: string;
  pivotMessageId: string; // id of message being regenerated (assistant) or edited (user/assistant)
  mode: 'regenerate' | 'edit' | 'clone';
  editedText?: string;
}) {
  if (IS_E2E) {
    return {
      newChatId: `${sourceChatId}-fork`,
      insertedEditedMessageId:
        mode === 'edit' ? `${pivotMessageId}-edited` : undefined,
      previousUserText: mode === 'regenerate' ? 'mocked-user-text' : undefined,
    };
  }

  const session = await requireSession();
  const result = await forkChat({
    sourceChatId,
    pivotMessageId,
    userId: session.user.id,
    mode,
    editedText,
  });
  return result;
}

export async function branchMessageAction({
  chatId,
  messageId,
  editedText,
}: {
  chatId: string;
  messageId: string;
  editedText: string;
}) {
  if (IS_E2E) {
    return {
      newMessageId: `${messageId}-edited`,
      previousHeadId: null,
    } as const;
  }

  const session = await requireSession();

  return branchMessageWithEdit({
    chatId,
    pivotMessageId: messageId,
    userId: session.user.id,
    editedText,
  });
}

export async function getMessageTreeAction({ chatId }: { chatId: string }) {
  if (IS_E2E) {
    throw new Error('E2E mode bypasses server message tree');
  }

  const session = await requireSession();

  const chat = await getChatById({ id: chatId });
  if (!chat) throw new Error('Chat not found');
  if (chat.userId !== session.user.id) throw new Error('Forbidden');

  return getMessagesByChatId({ id: chatId });
}
