import { cookies } from 'next/headers';
import { ChatSDKError } from '@/lib/errors';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { DEFAULT_CHAT_MODEL, isModelIdAllowed } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { generateUUID } from '@/lib/utils';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import type { ChatSettings } from '@/lib/db/schema';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';

function buildInitialSettings(
  base: ChatSettings | null,
  reasoningEffort?: 'low' | 'medium' | 'high' | null
): ChatSettings | null {
  if (!base && !reasoningEffort) return null;
  const settings: ChatSettings = { ...(base ?? {}) };
  if (reasoningEffort) {
    settings.reasoningEffort = reasoningEffort;
  } else {
    delete settings.reasoningEffort;
  }
  return Object.keys(settings).length > 0 ? settings : null;
}

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get('chatId');
  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');
  const reasoningEffortFromCookie = cookieStore.get('chat-reasoning');

  const tier = await getTierForUserType(session.user.type);
  const allowedModels = await resolveChatModelOptions(tier.modelIds);

  if (chatId) {
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    if (chat.visibility === 'private' && chat.userId !== session.user.id) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    const messageTree = await getMessagesByChatId({ id: chatId });

    const chatSettingsModel = normalizeModelId(chat.settings?.modelId);
    const agentSettingsModel = normalizeModelId(
      (chat.agent?.settings as ChatSettings | null)?.modelId
    );
    const cookieCandidate = modelIdFromCookie?.value;

    const candidateOrder = [
      chatSettingsModel,
      agentSettingsModel,
      cookieCandidate,
      DEFAULT_CHAT_MODEL,
    ];

    let initialModel = candidateOrder.find(
      (candidate): candidate is string =>
        !!candidate && isModelIdAllowed(candidate, tier.modelIds)
    );

    if (!initialModel) {
      initialModel = tier.modelIds[0] ?? DEFAULT_CHAT_MODEL;
    }

    const chatSettingsReasoning = normalizeReasoningEffort(
      chat.settings?.reasoningEffort
    );
    const agentSettingsReasoning = normalizeReasoningEffort(
      (chat.agent?.settings as ChatSettings | null)?.reasoningEffort
    );
    const cookieReasoningEffort = normalizeReasoningEffort(
      reasoningEffortFromCookie?.value
    );
    const initialReasoningEffort =
      chatSettingsReasoning ??
      agentSettingsReasoning ??
      cookieReasoningEffort ??
      undefined;

    const initialSettings = buildInitialSettings(
      chat.settings,
      initialReasoningEffort ?? null
    );

    const response: ChatBootstrapResponse = {
      kind: 'existing',
      chatId,
      autoResume: true,
      isReadonly: session.user.id !== chat.userId,
      initialVisibilityType: chat.visibility,
      initialChatModel: initialModel,
      allowedModels,
      initialSettings,
      initialAgent: chat.agent
        ? {
            id: chat.agent.id,
            name: chat.agent.name,
            description: chat.agent.description,
            settings: chat.agent.settings,
          }
        : null,
      agentId: chat.agent?.id ?? null,
      initialMessageTree: messageTree,
      initialLastContext: chat.lastContext ?? null,
      shouldSetLastChatUrl: false,
    };

    return Response.json(response, { status: 200 });
  }

  const cookieCandidate = modelIdFromCookie?.value;
  const cookieReasoningEffort = normalizeReasoningEffort(
    reasoningEffortFromCookie?.value
  );
  const initialReasoningEffort = cookieReasoningEffort ?? undefined;

  const candidateOrder = [cookieCandidate, DEFAULT_CHAT_MODEL];

  let initialModel = candidateOrder.find(
    (candidate): candidate is string =>
      !!candidate && isModelIdAllowed(candidate, tier.modelIds)
  );

  if (!initialModel) {
    initialModel = tier.modelIds[0] ?? DEFAULT_CHAT_MODEL;
  }

  const initialSettings = buildInitialSettings(null, initialReasoningEffort);

  const response: ChatBootstrapResponse = {
    kind: 'new',
    chatId: generateUUID(),
    autoResume: false,
    isReadonly: false,
    initialVisibilityType: 'private',
    initialChatModel: initialModel,
    allowedModels,
    initialSettings,
    initialAgent: null,
    shouldSetLastChatUrl:
      !!modelIdFromCookie &&
      isModelIdAllowed(modelIdFromCookie.value, tier.modelIds),
  };

  return Response.json(response, { status: 200 });
}
