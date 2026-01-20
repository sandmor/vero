import {
  deleteModel,
  getTierIdsForModel,
  removeModelFromTiers,
  upsertModel,
  type ModelFormat,
} from '@/lib/ai/model-capabilities';
import { invalidateTierCache } from '@/lib/ai/tiers';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@vero/db';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

// PUT /api/admin/model-capabilities/[id] - Update Model
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAdmin();
    const body = await req.json();
    const { name, creator, supportsTools, supportedFormats, maxOutputTokens } =
      body;

    const existing = await prisma.model.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Model not found' }, { status: 404 });
    }

    await upsertModel({
      id,
      name: name ?? existing.name,
      creator: creator ?? existing.creator,
      supportsTools: supportsTools ?? existing.supportsTools,
      supportedFormats:
        supportedFormats ?? (existing.supportedFormats as ModelFormat[]),
      maxOutputTokens:
        maxOutputTokens !== undefined
          ? maxOutputTokens
          : existing.maxOutputTokens,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error updating model:', error);
    return NextResponse.json(
      { error: 'Failed to update model' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/model-capabilities/[id] - Delete Model
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAdmin();
    const forceParam = req.nextUrl.searchParams.get('force');
    const force = forceParam === 'true' || forceParam === '1';

    const tierIds = await getTierIdsForModel(id);
    if (tierIds.length > 0 && !force) {
      return NextResponse.json(
        {
          error:
            'Model is included in user tiers. Remove it from tiers first or retry with force=true.',
          tierIds,
        },
        { status: 400 }
      );
    }

    if (tierIds.length > 0) {
      await removeModelFromTiers(id);
    }

    await deleteModel(id);
    invalidateTierCache();
    revalidatePath('/settings');
    return NextResponse.json({ ok: true, removedFromTiers: tierIds });
  } catch (error) {
    console.error('Error deleting model:', error);
    return NextResponse.json(
      { error: 'Failed to delete model' },
      { status: 500 }
    );
  }
}
