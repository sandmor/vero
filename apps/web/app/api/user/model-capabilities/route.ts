import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getManagedModels } from '@/lib/ai/model-capabilities';
import { BYOK_PROVIDERS } from '@/lib/ai/registry';

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

    // Filter to only include models that have at least one BYOK-capable provider
    const byokModels = models.filter((model) =>
      model.providers.some((p) => BYOK_PROVIDER_SET.has(p.providerId))
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
