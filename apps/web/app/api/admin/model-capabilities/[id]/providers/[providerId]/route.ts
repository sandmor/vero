import {
  countEnabledProviders,
  ensureDefaultProvider,
  getTierIdsForModel,
  removeModelFromTiers,
  removeModelProvider,
  upsertModelProvider,
  type ModelPricing,
} from '@/lib/ai/model-capabilities';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@vero/db';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// PUT /api/admin/model-capabilities/[id]/providers/[providerId] - Update Provider
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; providerId: string }> }
) {
  const { id, providerId } = await params;
  try {
    await requireAdmin();
    const body = await req.json();
    const { providerModelId, pricing, isDefault, enabled } = body;

    const forceParam = req.nextUrl.searchParams.get('force');
    const force = forceParam === 'true' || forceParam === '1';

    // Get existing to merge
    const existing = await prisma.modelProvider.findUnique({
      where: { modelId_providerId: { modelId: id, providerId } },
    });

    if (!existing) {
      return NextResponse.json(
        { error: 'Provider association not found' },
        { status: 404 }
      );
    }

    const nextEnabled = enabled ?? existing.enabled;
    const willDisable = existing.enabled && nextEnabled === false;
    if (willDisable) {
      const enabledCount = await countEnabledProviders(id, providerId);
      const tiers = await getTierIdsForModel(id);
      if (enabledCount === 0 && tiers.length > 0 && !force) {
        return NextResponse.json(
          {
            error:
              'Disabling the last enabled provider would orphan a tiered model. Retry with force=true to also remove it from tiers.',
            tierIds: tiers,
          },
          { status: 400 }
        );
      }

      if (enabledCount === 0 && tiers.length > 0) {
        await removeModelFromTiers(id);
      }
    }

    await upsertModelProvider(id, {
      providerId,
      providerModelId: providerModelId ?? existing.providerModelId,
      pricing:
        pricing !== undefined
          ? pricing
          : (existing.pricing as ModelPricing | null),
      isDefault: isDefault ?? existing.isDefault,
      enabled: enabled ?? existing.enabled,
    });

    await ensureDefaultProvider(id);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating provider:', error);
    return NextResponse.json(
      { error: 'Failed to update provider' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/model-capabilities/[id]/providers/[providerId] - Remove Provider
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; providerId: string }> }
) {
  const { id, providerId } = await params;
  try {
    await requireAdmin();
    const forceParam = req.nextUrl.searchParams.get('force');
    const force = forceParam === 'true' || forceParam === '1';

    const existing = await prisma.modelProvider.findUnique({
      where: { modelId_providerId: { modelId: id, providerId } },
    });

    if (!existing) {
      return NextResponse.json({ ok: true });
    }

    const enabledCount = await countEnabledProviders(id, providerId);
    const tiers = await getTierIdsForModel(id);

    if (enabledCount === 0 && tiers.length > 0 && !force) {
      return NextResponse.json(
        {
          error:
            'Removing the last enabled provider would orphan a tiered model. Retry with force=true to also remove it from tiers.',
          tierIds: tiers,
        },
        { status: 400 }
      );
    }

    if (enabledCount === 0 && tiers.length > 0) {
      await removeModelFromTiers(id);
    }

    await removeModelProvider(id, providerId);
    await ensureDefaultProvider(id);
    revalidatePath('/settings');

    return NextResponse.json({
      ok: true,
      removedFromTiers: enabledCount === 0 ? tiers : [],
    });
  } catch (error) {
    console.error('Error removing provider:', error);
    return NextResponse.json(
      { error: 'Failed to remove provider' },
      { status: 500 }
    );
  }
}
