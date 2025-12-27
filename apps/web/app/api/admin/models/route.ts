import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  fetchModelsDevCatalog,
  clearModelsDevCache,
} from '@/lib/ai/model-capabilities/sync-models-dev';

/**
 * GET /api/admin/models
 *
 * Returns the raw models.dev catalog for admin reference.
 * Use ?refresh=1 to force a fresh fetch from models.dev.
 *
 * Note: This is primarily for debugging/inspection. For actual model sync,
 * use the /api/admin/model-capabilities/sync endpoint.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get('refresh') === '1';

  try {
    if (refresh) {
      clearModelsDevCache();
    }

    const catalog = await fetchModelsDevCatalog(refresh);
    return NextResponse.json(catalog);
  } catch (err) {
    console.warn('Models.dev catalog fetch failed', err);
    return NextResponse.json(
      { error: 'Failed to fetch models catalog' },
      { status: 502 }
    );
  }
}
