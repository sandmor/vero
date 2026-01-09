'use server';

import { generateText, Output, type UIMessage } from 'ai';
import { cookies } from 'next/headers';
import type { VisibilityType } from '@/components/visibility-selector';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import { getLanguageModel } from '@/lib/ai/providers';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { type SystemAgentSettings } from '@/lib/ai/system-agents';
import { getSystemAgentBySlug } from '@/lib/db/queries';
import { buildPromptFromSystemAgent } from '@/lib/ai/system-agent-prompt';
import {
  forkChat,
  getChatById,
  getMessagesByChatId,
  branchMessageWithEdit,
  updateMessageText,
  updateBranchSelectionByChatId,
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

/**
 * Default system prompt for title generation, used as fallback.
 */
const DEFAULT_TITLE_PROMPT = `- you will generate a short title based on the conversation content
- ensure it is not more than 80 characters long
- the title should be a summary of the main topic or question being discussed
- focus on the user's intent and the conversation's core subject
- do not surround the title with quotes
- do not include any introductory phrases like "Title:" or "Summary:"
- do not use markdown. The title must be in plain text, only emojis are allowed`;

/**
 * Generate a title for a chat based on its message history.
 * Uses the "title-generation" system agent if available and enabled,
 * otherwise falls back to default settings.
 */
export async function generateTitleFromChatHistory({
  messages,
}: {
  messages: UIMessage[];
}) {
  // Try to get the title-generation system agent
  let modelId = DEFAULT_CHAT_MODEL;
  let systemPrompt = DEFAULT_TITLE_PROMPT;

  try {
    const titleAgent = await getSystemAgentBySlug('title-generation');

    if (titleAgent) {
      const settings = titleAgent.settings as SystemAgentSettings | null;

      // Use agent's model if configured
      if (settings?.modelId) {
        modelId = settings.modelId;
      }

      // Build prompt from agent's prompt config
      const agentPrompt = buildPromptFromSystemAgent(settings);
      if (agentPrompt) {
        systemPrompt = agentPrompt;
      }
    }
  } catch (error) {
    // Fall back to defaults if system agent lookup fails
    console.warn(
      'Failed to load title-generation system agent, using defaults:',
      error
    );
  }

  const model = await getLanguageModel(modelId);
  const { output } = await generateText({
    model,
    output: Output.object({
      schema: z.object({
        title: z
          .string()
          .max(80)
          .describe('A short title summarizing the conversation'),
      }),
    }),
    system: systemPrompt,
    prompt: JSON.stringify(messages),
  });

  return output.title;
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
  const session = await requireSession();
  await updateChatVisiblityById({
    chatId,
    visibility,
    userId: session.user.id,
  });
}

export async function updateBranchSelection({
  chatId,
  operation,
  expectedSnapshot,
}: {
  chatId: string;
  operation:
    | { kind: 'root'; rootMessageIndex: number | null; childId?: string }
    | {
        kind: 'child';
        parentId: string;
        selectedChildIndex: number | null;
        childId?: string;
      };
  expectedSnapshot?: BranchSelectionSnapshot;
}) {
  if (IS_E2E) {
    return;
  }

  const session = await requireSession();

  await updateBranchSelectionByChatId({
    chatId,
    userId: session.user.id,
    operation,
    expectedSnapshot,
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

/**
 * Updates a message's text content in place without creating a new version/branch.
 */
export async function updateMessageTextAction({
  chatId,
  messageId,
  editedText,
}: {
  chatId: string;
  messageId: string;
  editedText: string;
}) {
  if (IS_E2E) {
    return { messageId } as const;
  }

  const session = await requireSession();

  return updateMessageText({
    chatId,
    messageId,
    userId: session.user.id,
    editedText,
  });
}
