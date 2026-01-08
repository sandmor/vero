import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { getUserByokModels } from '@/lib/queries/byok';
import { ChatSDKError } from '@/lib/errors';
import { displayProviderName } from '@/lib/ai/registry';

export type SettingsResponse = {
  allowedModels: Awaited<ReturnType<typeof resolveChatModelOptions>>;
  newChatDefaults: {
    defaultModelId: string;
    allowedModelIds: string[];
  };
  serverTimestamp: string;
};

/**
 * GET /api/cache/settings
 *
 * Lightweight endpoint to fetch user settings data (available models, defaults).
 * This is used for settings sync which needs to run more frequently than full
 * chat sync to pick up changes in user tier or BYOK configuration.
 */
export async function GET(request: NextRequest) {
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  try {
    // Get user tier and models info
    const tier = await getTierForUserType(session.user.type);

    // Get BYOK models with full info for proper display names
    const byokModels = await getUserByokModels(session.user.id);
    const byokModelIds = byokModels.map((m) => m.fullModelId);

    // Build BYOK model info for resolveChatModelOptions
    const byokModelInfo = byokModels.map((m) => ({
      id: m.fullModelId,
      displayName: m.displayName,
      providerSlug:
        m.sourceType === 'platform' && m.providerId
          ? m.providerId
          : m.sourceType === 'custom' && m.customProviderSlug
            ? m.customProviderSlug
            : 'custom',
      providerDisplayName:
        m.sourceType === 'platform' && m.providerId
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

    const serverTimestamp = new Date().toISOString();

    const response: SettingsResponse = {
      allowedModels,
      newChatDefaults: {
        defaultModelId: combinedModelIds[0] ?? DEFAULT_CHAT_MODEL,
        allowedModelIds: combinedModelIds,
      },
      serverTimestamp,
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return new ChatSDKError(
      'bad_request:api',
      'Failed to fetch settings'
    ).toResponse();
  }
}
