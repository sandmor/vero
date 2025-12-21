import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@virid/db';
import { requireAdmin } from '@/lib/auth/admin';
import {
  getAllCatalogEntries,
  getManagedModels,
  upsertModel,
} from '@/lib/ai/model-capabilities';
import type {
  CatalogEntry,
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities/types';

/**
 * Fetch platform custom models and convert them to CatalogEntry format.
 * This allows custom models to appear in the tier model picker alongside
 * regular catalog entries.
 */
async function getPlatformCustomModelsAsCatalog(): Promise<CatalogEntry[]> {
  const customModels = await prisma.platformCustomModel.findMany({
    where: { enabled: true },
    include: {
      provider: {
        select: { slug: true, name: true, enabled: true },
      },
    },
  });

  return customModels
    .filter((m) => m.provider.enabled)
    .map((m) => {
      // Parse model slug to extract creator (format: creator:model)
      const colonIndex = m.modelSlug.indexOf(':');
      const creator =
        colonIndex > 0 ? m.modelSlug.substring(0, colonIndex) : 'custom';

      return {
        // Use the custom provider slug as providerId
        providerId: `custom:${m.provider.slug}`,
        providerModelId: m.providerModelId,
        suggestedModelId: m.modelSlug,
        suggestedName: m.displayName,
        suggestedCreator: creator,
        supportsTools: m.supportsTools,
        supportedFormats: m.supportedFormats as ModelFormat[],
        pricing: m.pricing as ModelPricing | null,
        // Mark as custom platform model for UI differentiation
        isCustomPlatformModel: true,
        customProviderName: m.provider.name,
      } as CatalogEntry & {
        isCustomPlatformModel: boolean;
        customProviderName: string;
      };
    });
}

// GET /api/admin/model-capabilities
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const include = req.nextUrl.searchParams
      .get('include')
      ?.split(',')
      .map((v) => v.trim())
      .filter(Boolean);

    const includeCatalog = include?.includes('catalog');

    const [models, catalog, customModels] = await Promise.all([
      getManagedModels(),
      includeCatalog ? getAllCatalogEntries() : Promise.resolve(undefined),
      includeCatalog ? getPlatformCustomModelsAsCatalog() : Promise.resolve([]),
    ]);

    if (includeCatalog) {
      // Merge catalog entries with platform custom models
      const mergedCatalog = [...(catalog ?? []), ...customModels];
      return NextResponse.json({ models, catalog: mergedCatalog });
    }

    return NextResponse.json(models);
  } catch (error) {
    console.error('Error fetching models:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
  }
}

// POST /api/admin/model-capabilities
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const {
      id,
      name,
      creator,
      supportsTools,
      supportedFormats,
      maxOutputTokens,
    } = body;

    // Validate request
    if (!id || !name || !creator) {
      return NextResponse.json(
        { error: 'id, name, and creator are required' },
        { status: 400 }
      );
    }

    await upsertModel({
      id,
      name,
      creator,
      supportsTools: supportsTools ?? true,
      supportedFormats: supportedFormats ?? ['text'],
      maxOutputTokens: maxOutputTokens ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error creating model:', error);
    return NextResponse.json(
      { error: 'Failed to create model' },
      { status: 500 }
    );
  }
}
