import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import {
  normalizeModelId,
  normalizeReasoningEffort,
} from '@/lib/agent-settings';
import { prisma } from '@virid/db';
import type { ChatSettings, Chat, DBMessage } from '@/lib/db/schema';
import type {
  BranchSelectionSnapshot,
  ChatBootstrapResponse,
} from '@/types/chat-bootstrap';
import type { CacheMetadataPayload, CachedChatRecord } from '@/lib/cache/types';
import { ChatSDKError } from '@/lib/errors';
import {
  buildInitialSettings,
  mapAgentToPreset,
  resolveInitialModel,
  resolveInitialReasoningEffort,
} from '@/lib/chat/bootstrap-helpers';
import { serializeChat } from '@/lib/chat/serialization';
import { getUserByokModels } from '@/lib/queries/byok';
import { enforceCacheRateLimit } from '@/lib/cache/rate-limit';
import { displayProviderName } from '@/lib/ai/registry';

// Sync request payload
export type SyncRequest = {
  // Last sync timestamp - ISO string. If null, this is an initial sync
  lastSyncedAt: string | null;
  // Page size for chunked responses
  pageSize?: number;
  // Cursor for pagination (chat ID to continue from)
  cursor?: string | null;
};

// Sync response payload
export type SyncResponse = {
  // Chats that were created or updated since lastSyncedAt
  upserts: CachedChatRecord[];
  // Chat IDs that were deleted since lastSyncedAt (for incremental sync)
  deletions: string[];
  // Server timestamp for the next sync
  serverTimestamp: string;
  // Pagination info
  hasMore: boolean;
  nextCursor: string | null;
  // Metadata (only on first page / initial sync)
  metadata?: CacheMetadataPayload;
  // Total count of user's chats (useful for client to know if cache is complete)
  totalChats: number;
};

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
// Rate limiting: more permissive than data-dump since sync is incremental
const isDevEnvironment = process.env.NODE_ENV !== 'production';
const RATE_LIMIT_LIMIT = isDevEnvironment ? 100 : 60; // 60 requests per window
const RATE_LIMIT_WINDOW_MS = isDevEnvironment ? 60_000 : 60_000; // 1 minute window

// Sliding window to account for clock skew and transaction latency
const SYNC_SKEW_WINDOW_MS = 5000;

export async function POST(request: NextRequest) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  // Rate limiting
  const rateResult = enforceCacheRateLimit({
    key: `cache-sync:${session.user.id}`,
    limit: RATE_LIMIT_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (!rateResult.allowed) {
    const retryAfterSeconds = Math.max(
      Math.ceil((rateResult.resetAt - Date.now()) / 1_000),
      1
    );
    return NextResponse.json(
      { error: 'Too many sync requests. Please wait before retrying.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }

  let body: SyncRequest;
  try {
    body = await request.json();
  } catch {
    return new ChatSDKError(
      'bad_request:api',
      'Invalid JSON body'
    ).toResponse();
  }

  const { lastSyncedAt, cursor } = body;
  const pageSize = Math.min(
    Math.max(body.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );

  // Parse lastSyncedAt if provided
  let lastSyncDate: Date | null = null;
  if (lastSyncedAt) {
    const parsed = Date.parse(lastSyncedAt);
    if (!Number.isNaN(parsed)) {
      // Apply sliding window to catch updates that might have been missed due to skew/latency
      lastSyncDate = new Date(parsed - SYNC_SKEW_WINDOW_MS);
    }
  }

  // Get user tier and models info
  const tier = await getTierForUserType(session.user.type);

  // Get BYOK models with full info for proper display names
  const byokModels = await getUserByokModels(session.user.id);
  const byokModelIds = byokModels.map((m) => m.fullModelId);

  // Build BYOK model info for resolveChatModelOptions
  const byokModelInfo = byokModels.map((m) => ({
    id: m.fullModelId,
    displayName: m.displayName,
    providerSlug: m.sourceType === 'platform' && m.providerId
      ? m.providerId
      : m.sourceType === 'custom' && m.customProviderSlug
        ? m.customProviderSlug
        : 'custom',
    providerDisplayName: m.sourceType === 'platform' && m.providerId
      ? displayProviderName(m.providerId)
      : m.sourceType === 'custom' && m.customProviderName
        ? m.customProviderName
        : 'Custom',
    supportsTools: m.supportsTools,
  }));

  const combinedModelIds = Array.from(
    new Set([...tier.modelIds, ...byokModelIds])
  );
  const allowedModels = await resolveChatModelOptions(tier.modelIds, {
    extraModelIds: byokModelIds,
    highlightIds: byokModelIds,
    byokModels: byokModelInfo,
  });

  // Build the where clause for fetching chats
  const whereClause: any = {
    userId: session.user.id,
  };

  // If this is an incremental sync, only get chats updated since lastSyncedAt
  if (lastSyncDate) {
    whereClause.updatedAt = { gt: lastSyncDate };
  }

  // Handle cursor-based pagination
  const orderBy = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];

  const findManyArgs: any = {
    where: whereClause,
    orderBy,
    take: pageSize + 1, // Fetch one extra to check for more
    include: {
      agent: true,
      messages: { orderBy: { pathText: 'asc' } },
    },
  };

  if (cursor) {
    findManyArgs.cursor = { id: cursor };
    findManyArgs.skip = 1; // Skip the cursor item
  }

  const chats = await prisma.chat.findMany(findManyArgs);

  // Check if there are more results
  const hasMore = chats.length > pageSize;
  const pageChats = hasMore ? chats.slice(0, pageSize) : chats;
  const nextCursor = hasMore
    ? (pageChats[pageChats.length - 1]?.id ?? null)
    : null;

  // Build the sync response
  const serverTimestamp = new Date().toISOString();

  // Process chats into cache entries
  const upserts: CachedChatRecord[] = [];

  for (const rawChat of pageChats) {
    // Cast to include agent from the include relation
    const chat = rawChat as typeof rawChat & {
      agent: Chat['agent'];
      messages?: DBMessage[];
    };

    const { messages = [], ...chatWithoutMessages } = chat;

    const effectiveBranchState: BranchSelectionSnapshot = {
      rootMessageIndex: chatWithoutMessages.rootMessageIndex ?? null,
    };

    const chatForSerialization = {
      ...chatWithoutMessages,
      visibility: chatWithoutMessages.visibility as Chat['visibility'],
      lastContext: chatWithoutMessages.lastContext as Chat['lastContext'],
      settings: (chatWithoutMessages.settings as ChatSettings) ?? null,
      agent: chatWithoutMessages.agent ?? null,
    } as Chat;

    const chatSettings = chat.settings as ChatSettings | null;
    const agentSettings = chat.agent?.settings as ChatSettings | null;

    const chatSettingsModel = normalizeModelId(chatSettings?.modelId);
    const agentSettingsModel = normalizeModelId(agentSettings?.modelId);

    const initialModel = resolveInitialModel({
      allowedModelIds: combinedModelIds,
      chatSettingsModel,
      agentSettingsModel,
      cookieCandidate: null,
    });

    const chatSettingsReasoning = normalizeReasoningEffort(
      chatSettings?.reasoningEffort
    );
    const agentSettingsReasoning = normalizeReasoningEffort(
      agentSettings?.reasoningEffort
    );

    const initialReasoningEffort = resolveInitialReasoningEffort({
      chatSettingsReasoning,
      agentSettingsReasoning,
      cookieReasoning: undefined,
    });

    const initialSettings = buildInitialSettings(
      chatSettings,
      initialReasoningEffort ?? null
    );

    const bootstrap: ChatBootstrapResponse = {
      kind: 'existing',
      chatId: chat.id,
      autoResume: true,
      isReadonly: false,
      initialChatModel: initialModel ?? DEFAULT_CHAT_MODEL,
      initialVisibilityType: chatForSerialization.visibility,
      allowedModels,
      initialSettings,
      initialAgent: mapAgentToPreset(chatForSerialization.agent),
      agentId: chat.agent?.id ?? null,
      initialMessages: messages,
      initialBranchState: effectiveBranchState,
      initialLastContext: chatForSerialization.lastContext,
      prefetchedChat: serializeChat(chatForSerialization),
    };

    upserts.push({
      chatId: chat.id,
      lastUpdatedAt: chat.updatedAt.toISOString(),
      bootstrap,
      chat: serializeChat(chatForSerialization),
    });
  }

  // Detect deletions via tombstones for incremental sync
  let deletions: string[] = [];
  if (lastSyncDate) {
    const tombstones = await prisma.chatDeletion.findMany({
      where: {
        userId: session.user.id,
        deletedAt: { gt: lastSyncDate },
      },
      select: { id: true },
    });
    deletions = tombstones.map((t) => t.id);
  }

  // Get total chat count for the user
  const totalChats = await prisma.chat.count({
    where: { userId: session.user.id },
  });

  // Build response
  const response: SyncResponse = {
    upserts,
    deletions,
    serverTimestamp,
    hasMore,
    nextCursor,
    totalChats,
  };

  // Include metadata on initial sync (no lastSyncedAt) or first page (no cursor)
  if (!lastSyncDate || !cursor) {
    // Get oldest and newest chat dates for completion marker
    const [oldestChat, newestChat] = await Promise.all([
      prisma.chat.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.chat.findFirst({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    response.metadata = {
      version: 1,
      generatedAt: serverTimestamp,
      allowedModels,
      cacheCompletionMarker: {
        completeFromDate: oldestChat?.createdAt.toISOString() ?? null,
        completeToDate: newestChat?.createdAt.toISOString() ?? null,
        hasOlderChats: false, // With the new sync system, we aim for full sync
      },
      newChatDefaults: {
        defaultModelId: combinedModelIds[0] ?? DEFAULT_CHAT_MODEL,
        allowedModelIds: combinedModelIds,
      },
    };
  }

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
