import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { syncOpenRouterCatalog } from '@/lib/ai/model-capabilities';
import {
  syncModelsDevProvider,
  syncAllModelsDevProviders,
  isModelsDevProvider,
} from '@/lib/ai/model-capabilities/sync-models-dev';

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
      // OpenRouter uses its own API directly - has priority for its models
      const syncResult = await syncOpenRouterCatalog();
      result = {
        synced: syncResult.synced,
        removed: syncResult.removed,
        errors: syncResult.errors,
      };
    } else if (source === 'models.dev' || source === 'modelsdev') {
      // Models.dev sync - can sync a specific provider or all enabled providers
      if (provider) {
        if (!isModelsDevProvider(provider)) {
          return NextResponse.json(
            { error: `Provider '${provider}' is not supported by models.dev` },
            { status: 400 }
          );
        }
        result = await syncModelsDevProvider(provider, {
          forceRefresh: true,
          cleanupStale: true,
        });
      } else {
        // Sync all models.dev providers
        const allResults = await syncAllModelsDevProviders({
          forceRefresh: true,
          cleanupStale: true,
        });
        result = {
          synced: allResults.totalSynced,
          removed: allResults.totalRemoved,
          errors: Object.entries(allResults.results)
            .flatMap(([providerId, r]) =>
              r.errors.map((e) => `${providerId}: ${e}`)
            ),
          details: allResults.results,
        };
      }
    } else if (source === 'all') {
      // Sync both OpenRouter and all models.dev providers
      const [openRouterResult, modelsDevResults] = await Promise.all([
        syncOpenRouterCatalog(),
        syncAllModelsDevProviders({ forceRefresh: true, cleanupStale: true }),
      ]);

      result = {
        synced: openRouterResult.synced + modelsDevResults.totalSynced,
        removed: openRouterResult.removed + modelsDevResults.totalRemoved,
        errors: [
          ...openRouterResult.errors.map((e) => `openrouter: ${e}`),
          ...Object.entries(modelsDevResults.results).flatMap(
            ([providerId, r]) => r.errors.map((e) => `${providerId}: ${e}`)
          ),
        ],
        details: {
          openrouter: {
            synced: openRouterResult.synced,
            removed: openRouterResult.removed,
            errors: openRouterResult.errors,
          },
          ...modelsDevResults.results,
        },
      };
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
