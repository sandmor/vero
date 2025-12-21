import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  syncOpenRouterCatalog,
  syncTokenLensCatalog,
} from '@/lib/ai/model-capabilities';

// POST /api/admin/model-capabilities/sync - Sync Catalog
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const { source, provider } = body;

    if (!source) {
      return NextResponse.json(
        { error: 'Source is required' },
        { status: 400 }
      );
    }

    let result;
    if (source === 'openrouter') {
      result = await syncOpenRouterCatalog();
    } else if (source === 'tokenlens') {
      if (!provider) {
        return NextResponse.json(
          { error: 'provider required for tokenlens' },
          { status: 400 }
        );
      }
      result = await syncTokenLensCatalog(provider);
    } else {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error syncing catalog:', error);
    return NextResponse.json(
      { error: 'Failed to sync catalog' },
      { status: 500 }
    );
  }
}
