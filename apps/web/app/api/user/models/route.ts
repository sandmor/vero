import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTierWithModels } from '@/lib/ai/tiers';
import { getAllModels } from '@/lib/ai/model-capabilities';
import { type ChatModelOption } from '@/lib/ai/models';
import { parseModelId, getModelName } from '@/lib/ai/model-id';

/**
 * Returns available models for the user based on their tier.
 */
export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get user's current tier to determine available models
    const tier = await getTierWithModels('regular'); // Default tier for now
    const tierModelIds = new Set(tier.models.map((m) => m.id));

    // Get all available models from database
    const allModels = await getAllModels();

    // Filter models to only include those available in tiers
    const availableModels = allModels
      .filter((model) => tierModelIds.has(model.id))
      .map((model) => {
        const parsed = parseModelId(model.id);
        return {
          id: model.id,
          creator: model.creator,
          model: parsed?.modelName ?? getModelName(model.id) ?? model.id,
          name: model.name,
          capabilities: {
            supportsTools: model.supportsTools,
            supportedFormats: model.supportedFormats,
          },
        } as ChatModelOption;
      });

    return NextResponse.json({
      models: availableModels,
    });
  } catch (error) {
    console.error('Failed to fetch user models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}
