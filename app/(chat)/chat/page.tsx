import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Chat } from '@/components/chat';
import { DataStreamHandler } from '@/components/data-stream-handler';
import { SetLastChatUrl } from '@/components/set-last-chat-url';
import { DEFAULT_CHAT_MODEL, isModelIdAllowed } from '@/lib/ai/models';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { getTierForUserType } from '@/lib/ai/tiers';
import { generateUUID, isValidUUID } from '@/lib/utils';
import { getAppSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import type { Agent as AgentModel } from '@/lib/db/schema';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getAppSession();

  if (!session) {
    redirect('/api/auth/guest');
  }

  const resolvedSearchParams = await searchParams;

  const id = generateUUID();

  const cookieStore = await cookies();
  const modelIdFromCookie = cookieStore.get('chat-model');

  const { modelIds: allowedModelIds } = await getTierForUserType(
    session.user.type
  );
  const allowedModels = await resolveChatModelOptions(allowedModelIds);
  // Check for agentId
  const rawAgentId =
    typeof resolvedSearchParams?.agentId === 'string'
      ? resolvedSearchParams.agentId
      : undefined;
  const agentId =
    rawAgentId && isValidUUID(rawAgentId) ? rawAgentId : undefined;
  let initialAgent: Pick<
    AgentModel,
    'id' | 'name' | 'description' | 'settings'
  > | null = null;
  if (agentId) {
    try {
      const agent = await prisma.agent.findFirst({
        where: { id: agentId, userId: session.user.id },
      });
      if (agent) {
        initialAgent = {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          settings: agent.settings,
        };
      }
    } catch {
      // Ignore errors; fall back to default selections
    }
  }

  const cookieCandidate = modelIdFromCookie
    ? modelIdFromCookie.value
    : undefined;
  const reasoningEffortFromCookie = cookieStore.get('chat-reasoning');
  const cookieReasoningEffort = normalizeReasoningEffort(
    reasoningEffortFromCookie?.value
  );
  const agentModelPreference = normalizeModelId(
    initialAgent?.settings ? (initialAgent.settings as any)?.modelId : undefined
  );
  const agentReasoningPreference = normalizeReasoningEffort(
    initialAgent?.settings
      ? (initialAgent.settings as any)?.reasoningEffort
      : undefined
  );
  const initialReasoningEffort =
    agentReasoningPreference ?? cookieReasoningEffort ?? undefined;
  const initialChatSettings = initialReasoningEffort
    ? { reasoningEffort: initialReasoningEffort }
    : null;

  const candidateOrder = [
    agentModelPreference,
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
    !modelIdFromCookie ||
    !isModelIdAllowed(modelIdFromCookie.value, allowedModelIds)
  ) {
    return (
      <>
        <Chat
          autoResume={false}
          id={id}
          initialChatModel={initialModel}
          initialVisibilityType="private"
          isReadonly={false}
          key={id}
          allowedModels={allowedModels}
          agentId={agentId}
          initialAgent={initialAgent}
          initialSettings={initialChatSettings}
        />
        <DataStreamHandler />
      </>
    );
  }

  return (
    <>
      <SetLastChatUrl />
      <Chat
        key={id}
        id={id}
        initialChatModel={initialModel}
        initialVisibilityType="private"
        isReadonly={false}
        autoResume={false}
        allowedModels={allowedModels}
        agentId={agentId}
        initialAgent={initialAgent}
        initialSettings={initialChatSettings}
      />
      <DataStreamHandler />
    </>
  );
}
