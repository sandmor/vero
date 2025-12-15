import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { DEFAULT_CHAT_MODEL } from '@/lib/ai/models';
import { getUserByokConfig } from '@/lib/queries/user-keys';
import { ChatSDKError } from '@/lib/errors';

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
        const byokConfig = await getUserByokConfig(session.user.id);
        const combinedModelIds = Array.from(
            new Set([...tier.modelIds, ...byokConfig.modelIds])
        );
        const allowedModels = await resolveChatModelOptions(tier.modelIds, {
            extraModelIds: byokConfig.modelIds,
            highlightIds: byokConfig.modelIds,
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
