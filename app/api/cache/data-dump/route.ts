import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { getChatsByUserId } from '@/lib/db/queries';
import type { ChatSettings, Chat } from '@/lib/db/schema';
import type { AgentPreset } from '@/types/agent';
import type { ChatBootstrapResponse } from '@/types/chat-bootstrap';
import type { CacheMetadataPayload, CachedChatRecord } from '@/lib/cache/types';
import { ChatSDKError } from '@/lib/errors';
import {
  buildInitialSettings,
  computeChatLastUpdatedAt,
  resolveInitialModel,
  resolveInitialReasoningEffort,
} from '@/lib/chat/bootstrap-helpers';
import { enforceCacheRateLimit } from '@/lib/cache/rate-limit';
import type { MessageTreeResult } from '@/lib/db/schema';
import { serializeChat } from '@/lib/chat/serialization';

const DEFAULT_CHAT_LIMIT = 50;
const MAX_CHAT_LIMIT = 200;
const RATE_LIMIT_LIMIT = 4;
const RATE_LIMIT_WINDOW_MS = 60_000;

function mapAgentToPreset(agent: Chat['agent']): AgentPreset | null {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    settings: agent.settings,
  };
}

export async function POST(request: NextRequest) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const rateResult = enforceCacheRateLimit({
    key: `cache-dump:${session.user.id}`,
    limit: RATE_LIMIT_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (!rateResult.allowed) {
    const retryAfterSeconds = Math.max(
      Math.ceil((rateResult.resetAt - Date.now()) / 1_000),
      1
    );
    return NextResponse.json(
      { error: 'Too many requests. Please wait before retrying.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }

  let requestedLimit = DEFAULT_CHAT_LIMIT;
  if (request.body) {
    try {
      const payload = await request.json();
      if (payload && typeof payload.limit === 'number') {
        requestedLimit = Number.isFinite(payload.limit)
          ? Math.max(1, Math.min(Math.trunc(payload.limit), MAX_CHAT_LIMIT))
          : DEFAULT_CHAT_LIMIT;
      }
    } catch {
      // Ignore body parse errors and fall back to defaults.
    }
  }

  const tier = await getTierForUserType(session.user.type);
  const allowedModels = await resolveChatModelOptions(tier.modelIds);

  const { chats, hasMore } = await getChatsByUserId({
    id: session.user.id,
    limit: requestedLimit,
    startingAfter: null,
    endingBefore: null,
    includeMessageTree: true,
  });

  const cacheEntries: Array<{
    bootstrap: ChatBootstrapResponse;
    messageTree: MessageTreeResult;
    lastUpdatedAt: string;
    chat: ReturnType<typeof serializeChat>;
  }> = [];

  for (const chat of chats) {
    const messageTree = chat.messageTree || { tree: [], nodes: [], branch: [] };

    const chatSettingsModel = normalizeModelId(chat.settings?.modelId);
    const agentSettingsModel = normalizeModelId(
      (chat.agent?.settings as ChatSettings | null)?.modelId
    );

    const initialModel = resolveInitialModel({
      allowedModelIds: tier.modelIds,
      chatSettingsModel,
      agentSettingsModel,
      cookieCandidate: null,
    });

    const chatSettingsReasoning = normalizeReasoningEffort(
      chat.settings?.reasoningEffort
    );
    const agentSettingsReasoning = normalizeReasoningEffort(
      (chat.agent?.settings as ChatSettings | null)?.reasoningEffort
    );

    const initialReasoningEffort = resolveInitialReasoningEffort({
      chatSettingsReasoning,
      agentSettingsReasoning,
      cookieReasoning: undefined,
    });

    const initialSettings = buildInitialSettings(
      chat.settings,
      initialReasoningEffort ?? null
    );

    const bootstrap: ChatBootstrapResponse = {
      kind: 'existing',
      chatId: chat.id,
      autoResume: true,
      isReadonly: false,
      initialChatModel: initialModel ?? DEFAULT_CHAT_MODEL,
      initialVisibilityType: chat.visibility,
      allowedModels,
      initialSettings,
      initialAgent: mapAgentToPreset(chat.agent),
      agentId: chat.agent?.id ?? null,
      initialMessageTree: messageTree,
      initialLastContext: chat.lastContext ?? null,
      shouldSetLastChatUrl: false,
    };

    const lastUpdatedAt = computeChatLastUpdatedAt({ chat, messageTree });

    cacheEntries.push({
      bootstrap: { ...bootstrap, prefetchedChat: serializeChat(chat) },
      messageTree,
      lastUpdatedAt,
      chat: serializeChat(chat),
    });
  }

  const completeFromDate = chats.at(-1)?.createdAt?.toISOString() ?? null;
  const completeToDate = chats.at(0)?.createdAt?.toISOString() ?? null;
  const hasOlderChats = hasMore;

  const metadata: CacheMetadataPayload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    allowedModels,
    cacheCompletionMarker: {
      completeFromDate,
      completeToDate,
      hasOlderChats,
    },
  };

  const chatsPayload: CachedChatRecord[] = cacheEntries.map((entry) => ({
    chatId: entry.bootstrap.chatId,
    lastUpdatedAt: entry.lastUpdatedAt,
    bootstrap: entry.bootstrap,
    chat: entry.chat,
  }));

  const response = {
    metadata,
    chats: chatsPayload,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
