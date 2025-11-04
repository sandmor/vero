import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import {
  getManagedModels,
  syncPricingFromTokenLens,
  syncProviderCatalog,
} from '@/lib/ai/model-capabilities';

const BYOK_PROVIDERS = [
  'openrouter',
  'openai',
  'google',
  'anthropic',
  'groq',
  'together',
  'fireworks',
  'deepseek',
  'mistral',
] as const;

const BYOK_PROVIDER_SET = new Set<string>(BYOK_PROVIDERS);

// GET /api/user/model-capabilities - Get models with capabilities for BYOK providers
export async function GET(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all managed models (this includes pricing and capabilities)
    const models = await getManagedModels();

    // Filter to only include models from providers that support BYOK
    // These are typically external providers like OpenRouter, TokenLens, etc.
    const byokModels = models.filter((model) =>
      BYOK_PROVIDER_SET.has(model.provider)
    );

    return NextResponse.json({ models: byokModels });
  } catch (error) {
    console.error('Error fetching model capabilities:', error);
    return NextResponse.json(
      { error: 'Failed to fetch model capabilities' },
      { status: 500 }
    );
  }
}

// POST /api/user/model-capabilities - Sync pricing or sync models for a provider
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, modelId, provider } = body;

    if (action === 'sync-pricing-tokenlens' && typeof modelId === 'string') {
      const pricing = await syncPricingFromTokenLens(modelId);

      if (!pricing) {
        return NextResponse.json(
          { error: 'Pricing not found in TokenLens catalog' },
          { status: 404 }
        );
      }

      return NextResponse.json({ pricing });
    }

    if (
      action === 'sync-provider-catalog' ||
      action === 'sync-openrouter' ||
      action === 'sync-tokenlens'
    ) {
      const targetProvider =
        action === 'sync-openrouter'
          ? 'openrouter'
          : typeof provider === 'string'
            ? provider
            : undefined;

      if (!targetProvider || !BYOK_PROVIDER_SET.has(targetProvider)) {
        return NextResponse.json(
          { error: 'Invalid provider' },
          { status: 400 }
        );
      }

      const result = await syncProviderCatalog(targetProvider);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error syncing:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}
