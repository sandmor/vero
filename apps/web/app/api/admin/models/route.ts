import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { unstable_cache as cache } from 'next/cache';
import { fetchModels } from 'tokenlens/fetch';
import type { ModelCatalog } from 'tokenlens/core';

const getTokenlensCatalog = cache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn('TokenLens: catalog fetch failed', err);
      return;
    }
  },
  ['tokenlens-catalog'],
  { revalidate: 60 * 60 }
);

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const refresh = searchParams.get('refresh') === '1';
  const catalog = refresh
    ? await fetchModels().catch((err) => {
        console.warn('TokenLens: forced catalog fetch failed', err);
        return undefined;
      })
    : await getTokenlensCatalog();
  if (!catalog) return NextResponse.json({}, { status: 502 });
  return NextResponse.json(catalog);
}
