import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { getTier } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { getUserByokModels } from '@/lib/queries/byok';
import { displayProviderName } from '@/lib/ai/registry';

export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { modelIds: tierModelIds } = await getTier(session.user.type);

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

  const allowedModels = await resolveChatModelOptions(tierModelIds, {
    extraModelIds: byokModelIds,
    highlightIds: byokModelIds,
    byokModels: byokModelInfo,
  });

  return NextResponse.json({ models: allowedModels });
}
