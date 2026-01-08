import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@virid/db';
import {
  upsertModel,
  deleteModel,
  type ModelFormat,
} from '@/lib/ai/model-capabilities';

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
    await deleteModel(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error deleting model:', error);
    return NextResponse.json(
      { error: 'Failed to delete model' },
      { status: 500 }
    );
  }
}
