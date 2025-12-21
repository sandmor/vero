import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getManagedModels, deleteModel } from '@/lib/ai/model-capabilities';

// POST /api/admin/model-capabilities/prune - Remove Unused
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();

    const models = await getManagedModels();
    const toDelete = models.filter((m) => !m.inUse).map((m) => m.id);

    for (const id of toDelete) {
      await deleteModel(id);
    }

    return NextResponse.json({ removed: toDelete.length });
  } catch (error) {
    console.error('Error pruning models:', error);
    return NextResponse.json(
      { error: 'Failed to prune models' },
      { status: 500 }
    );
  }
}
