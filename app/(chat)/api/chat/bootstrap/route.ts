import { cookies } from 'next/headers';
import { ChatSDKError } from '@/lib/errors';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { isModelIdAllowed } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { generateUUID } from '@/lib/utils';
import { getChatById, getMessagesByChatIdRaw } from '@/lib/db/queries';
import type { ChatSettings } from '@/lib/db/schema';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import {
  buildInitialSettings,
  mapAgentToPreset,
  resolveInitialModel,
  resolveInitialReasoningEffort,
} from '@/lib/chat/bootstrap-helpers';
import { serializeChat } from '@/lib/chat/serialization';
import { getUserByokConfig } from '@/lib/queries/user-keys';

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
  const byokConfig = await getUserByokConfig(session.user.id);
  const combinedModelIds = Array.from(
    new Set([...tier.modelIds, ...byokConfig.modelIds])
  );
  const allowedModels = await resolveChatModelOptions(tier.modelIds, {
    extraModelIds: byokConfig.modelIds,
    highlightIds: byokConfig.modelIds,
  });

  if (chatId) {
    const chat = await getChatById({ id: chatId });
    if (!chat) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    if (chat.visibility === 'private' && chat.userId !== session.user.id) {
      return new ChatSDKError('not_found:chat').toResponse();
    }

    const { messages, rootMessageIndex } = await getMessagesByChatIdRaw({
      id: chatId,
    });

    const chatSettingsModel = normalizeModelId(chat.settings?.modelId);
    const agentSettingsModel = normalizeModelId(
      (chat.agent?.settings as ChatSettings | null)?.modelId
    );
    const cookieCandidate = modelIdFromCookie?.value;

    const initialModel = resolveInitialModel({
      allowedModelIds: combinedModelIds,
      chatSettingsModel,
      agentSettingsModel,
      cookieCandidate,
    });

    const chatSettingsReasoning = normalizeReasoningEffort(
      chat.settings?.reasoningEffort
    );
    const agentSettingsReasoning = normalizeReasoningEffort(
      (chat.agent?.settings as ChatSettings | null)?.reasoningEffort
    );
    const cookieReasoningEffort = normalizeReasoningEffort(
      reasoningEffortFromCookie?.value
    );
    const initialReasoningEffort = resolveInitialReasoningEffort({
      chatSettingsReasoning,
      agentSettingsReasoning,
      cookieReasoning: cookieReasoningEffort,
    });

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
      initialAgent: mapAgentToPreset(chat.agent),
      agentId: chat.agent?.id ?? null,
      initialMessages: messages,
      initialBranchState: { rootMessageIndex },
      initialLastContext: chat.lastContext ?? null,
      shouldSetLastChatUrl: false,
      prefetchedChat: serializeChat(chat),
    };

    return Response.json(response, { status: 200 });
  }

  const cookieCandidate = modelIdFromCookie?.value;
  const cookieReasoningEffort = normalizeReasoningEffort(
    reasoningEffortFromCookie?.value
  );
  const initialReasoningEffort = cookieReasoningEffort ?? undefined;

  const initialModel = resolveInitialModel({
    allowedModelIds: combinedModelIds,
    chatSettingsModel: null,
    agentSettingsModel: null,
    cookieCandidate,
  });

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
    initialBranchState: { rootMessageIndex: null },
    shouldSetLastChatUrl:
      !!modelIdFromCookie &&
      isModelIdAllowed(modelIdFromCookie.value, combinedModelIds),
  };

  return Response.json(response, { status: 200 });
}
