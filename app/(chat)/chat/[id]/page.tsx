import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { getAppSession } from '@/lib/auth/session';
import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { DEFAULT_CHAT_MODEL, isModelIdAllowed } from '@/lib/ai/models';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { getTierForUserType } from '@/lib/ai/tiers';
import { getChatById, getMessagesByChatId } from '@/lib/db/queries';
import { convertToUIMessages } from '@/lib/utils';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import type { ChatSettings } from '@/lib/db/schema';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { id } = params;
  const chat = await getChatById({ id });

  if (!chat) {
    notFound();
  }

  const session = await getAppSession();

  if (!session) {
    redirect('/api/auth/guest');
  }

  if (chat.visibility === 'private') {
    if (!session.user) {
      return notFound();
    }

    if (session.user.id !== chat.userId) {
      return notFound();
    }
  }

  const messageTree = await getMessagesByChatId({
    id,
  });

  const uiMessages = convertToUIMessages(messageTree.branch);

  // Fetch agent if exists
  let initialAgent = null;
  if (chat.agent) {
    initialAgent = {
      id: chat.agent.id,
      name: chat.agent.name,
      description: chat.agent.description,
      settings: chat.agent.settings,
    };
  }

  const cookieStore = await cookies();
  const chatModelFromCookie = cookieStore.get('chat-model');
  const reasoningEffortFromCookie = cookieStore.get('chat-reasoning');
  const { modelIds: allowedModelIds } = await getTierForUserType(
    session.user.type
  );
  const allowedModels = await resolveChatModelOptions(allowedModelIds);
  const cookieCandidate = chatModelFromCookie
    ? chatModelFromCookie.value
    : undefined;
  const cookieReasoningEffort = normalizeReasoningEffort(
    reasoningEffortFromCookie?.value
  );

  const chatSettingsModel = normalizeModelId(chat.settings?.modelId);
  const agentSettingsModel = normalizeModelId(
    (chat.agent?.settings as any)?.modelId
  );
  const chatSettingsReasoning = normalizeReasoningEffort(
    chat.settings?.reasoningEffort
  );
  const agentSettingsReasoning = normalizeReasoningEffort(
    (chat.agent?.settings as any)?.reasoningEffort
  );
  const initialReasoningEffort =
    chatSettingsReasoning ??
    agentSettingsReasoning ??
    cookieReasoningEffort ??
    undefined;
  const initialChatSettings = (() => {
    const base: ChatSettings = {
      ...(chat.settings ?? {}),
    };
    if (initialReasoningEffort) {
      base.reasoningEffort = initialReasoningEffort;
    } else {
      delete base.reasoningEffort;
    }
    return Object.keys(base).length > 0 ? base : null;
  })();

  const candidateOrder = [
    chatSettingsModel,
    agentSettingsModel,
    cookieCandidate,
    DEFAULT_CHAT_MODEL,
  ];

  let initialModel = candidateOrder.find(
    (candidate): candidate is string =>
      !!candidate && isModelIdAllowed(candidate, allowedModelIds)
  );

  if (!initialModel) {
    initialModel = allowedModelIds[0] ?? DEFAULT_CHAT_MODEL;
  }

  if (
    !chatModelFromCookie ||
    !isModelIdAllowed(chatModelFromCookie.value, allowedModelIds)
  ) {
    return (
      <>
        <Chat
          autoResume={true}
          id={chat.id}
          initialChatModel={initialModel}
          initialLastContext={chat.lastContext ?? undefined}
          initialMessages={uiMessages}
          initialVisibilityType={chat.visibility}
          isReadonly={session?.user?.id !== chat.userId}
          allowedModels={allowedModels}
          agentId={chat.agent?.id}
          initialAgent={initialAgent}
          initialSettings={initialChatSettings}
          key={chat.id}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <Chat
        autoResume={true}
        id={chat.id}
        initialChatModel={initialModel}
        initialLastContext={chat.lastContext ?? undefined}
        initialMessages={uiMessages}
        initialVisibilityType={chat.visibility}
        isReadonly={session?.user?.id !== chat.userId}
        allowedModels={allowedModels}
        agentId={chat.agent?.id}
        initialAgent={initialAgent}
        initialSettings={initialChatSettings}
        key={chat.id}
      />
      <DataStreamHandler />
    </>
  );
}
