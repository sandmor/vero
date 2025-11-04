import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTier } from '@/lib/ai/tiers';
import { getAllModels } from '@/lib/ai/model-capabilities';
import { deriveChatModel, type ChatModelOption } from '@/lib/ai/models';
import { getUserApiKeysWithMetadata } from '@/lib/queries/user-keys';

export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get user's current tier to determine available models
    const tier = await getTier('regular'); // Default tier for now
    const tierModelIds = tier.modelIds;

    // Get all available models from database
    const allModels = await getAllModels();

    // Filter models to only include those available in tiers
    const availableModels = allModels
      .filter((model) => tierModelIds.includes(model.id))
      .map((model) => {
        const chatModel = deriveChatModel(model.id);
        return {
          ...chatModel,
          capabilities: {
            supportsTools: model.supportsTools,
            supportedFormats: model.supportedFormats,
          },
        } as ChatModelOption;
      });

    // Get user's current API key selections
    const userApiKeys = await getUserApiKeysWithMetadata(session.user.id);
    const userModelSelections = userApiKeys.reduce(
      (acc, key) => {
        acc[key.providerId] = key.modelIds;
        return acc;
      },
      {} as Record<string, string[]>
    );

    return NextResponse.json({
      models: availableModels,
      userSelections: userModelSelections,
    });
  } catch (error) {
    console.error('Failed to fetch user models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
