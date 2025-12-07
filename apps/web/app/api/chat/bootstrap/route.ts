import { cookies } from 'next/headers';
import { ChatSDKError } from '@/lib/errors';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { isModelIdAllowed } from '@/lib/ai/models';
import {
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { generateUUID } from '@/lib/utils';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import {
  buildInitialSettings,
  resolveInitialModel,
} from '@/lib/chat/bootstrap-helpers';
import { getUserByokConfig } from '@/lib/queries/user-keys';

export async function GET(request: Request) {
  const session = await getAppSession();
  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

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
