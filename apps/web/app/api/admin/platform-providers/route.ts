import {
  countEnabledProviders,
  ensureDefaultProvider,
  removeModelFromTiers,
} from '@/lib/ai/model-capabilities';
import { isValidBaseUrl, isValidProviderSlug } from '@/lib/ai/shared-provider';
import { invalidateTierCache } from '@/lib/ai/tiers';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@vero/db';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET - List all platform custom providers
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providers = await prisma.platformCustomProvider.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { models: true },
      },
    },
  });

  // Map to safe response (omit apiKey)
  const safeProviders = providers.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    baseUrl: p.baseUrl,
    hasApiKey: !!p.apiKey,
    enabled: p.enabled,
    modelCount: p._count.models,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));

  return NextResponse.json({ providers: safeProviders });
}

/**
 * POST - Create a new platform custom provider
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { slug, name, baseUrl, apiKey } = body as {
    slug?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  };

  // Validate slug
  if (!slug || !isValidProviderSlug(slug)) {
    return NextResponse.json(
      {
        error:
          'Invalid slug. Must be lowercase alphanumeric with hyphens, 1-64 chars.',
      },
      { status: 400 }
    );
  }

  // Validate name
  if (!name || name.trim().length === 0 || name.length > 128) {
    return NextResponse.json(
      { error: 'Name is required (max 128 characters).' },
      { status: 400 }
    );
  }

  // Validate baseUrl
  if (!baseUrl || !isValidBaseUrl(baseUrl)) {
    return NextResponse.json(
      { error: 'Invalid base URL. Must be a valid HTTP(S) URL.' },
      { status: 400 }
    );
  }

  // Check for duplicate slug
  const existing = await prisma.platformCustomProvider.findUnique({
    where: { slug },
  });
  if (existing) {
    return NextResponse.json(
      { error: 'A provider with this slug already exists.' },
      { status: 409 }
    );
  }

  const provider = await prisma.platformCustomProvider.create({
    data: {
      slug,
      name: name.trim(),
      baseUrl,
      apiKey: apiKey || null,
      enabled: true,
    },
  });

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when providers change
  return NextResponse.json({
    id: provider.id,
    slug: provider.slug,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: !!provider.apiKey,
    enabled: provider.enabled,
  });
}

/**
 * PUT - Update an existing platform custom provider
 */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { id, name, baseUrl, apiKey, enabled } = body as {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
  };

  if (!id) {
    return NextResponse.json(
      { error: 'Provider ID is required.' },
      { status: 400 }
    );
  }

  const existing = await prisma.platformCustomProvider.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (name !== undefined) {
    if (name.trim().length === 0 || name.length > 128) {
      return NextResponse.json(
        { error: 'Name is required (max 128 characters).' },
        { status: 400 }
      );
    }
    updateData.name = name.trim();
  }

  if (baseUrl !== undefined) {
    if (!isValidBaseUrl(baseUrl)) {
      return NextResponse.json(
        { error: 'Invalid base URL. Must be a valid HTTP(S) URL.' },
        { status: 400 }
      );
    }
    updateData.baseUrl = baseUrl;
  }

  if (apiKey !== undefined) {
    updateData.apiKey = apiKey || null;
  }

  if (enabled !== undefined) {
    updateData.enabled = enabled;
  }

  const provider = await prisma.platformCustomProvider.update({
    where: { id },
    data: updateData,
  });

  // If provider was disabled, also disable linked model providers and prune tiers if needed
  if (enabled === false) {
    const customProviderModelLinks = await prisma.modelProvider.findMany({
      where: {
        OR: [
          { customPlatformProviderId: id },
          // Also cover legacy providerId format if present
          existing ? { providerId: `custom:${existing.slug}` } : undefined,
        ].filter(Boolean) as any,
      },
      select: { modelId: true, providerId: true },
    });

    if (customProviderModelLinks.length > 0) {
      await prisma.modelProvider.updateMany({
        where: {
          OR: [
            { customPlatformProviderId: id },
            existing ? { providerId: `custom:${existing.slug}` } : undefined,
          ].filter(Boolean) as any,
        },
        data: { enabled: false, isDefault: false },
      });

      const affectedModels = Array.from(
        new Set(customProviderModelLinks.map((m) => m.modelId))
      );

      for (const modelId of affectedModels) {
        const enabledCount = await countEnabledProviders(modelId);
        if (enabledCount === 0) {
          await removeModelFromTiers(modelId);
        } else {
          await ensureDefaultProvider(modelId);
        }
      }

      invalidateTierCache();
    }
  }

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when providers change
  return NextResponse.json({
    id: provider.id,
    slug: provider.slug,
    name: provider.name,
    baseUrl: provider.baseUrl,
    hasApiKey: !!provider.apiKey,
    enabled: provider.enabled,
  });
}

/**
 * DELETE - Delete a platform custom provider (cascade deletes models)
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { error: 'Provider ID is required.' },
      { status: 400 }
    );
  }

  const existing = await prisma.platformCustomProvider.findUnique({
    where: { id },
    select: { slug: true },
  });

  await prisma.platformCustomProvider.delete({ where: { id } }).catch(() => {});

  // Clean up model provider associations and tiers referencing this custom provider
  if (existing) {
    const providerSlug = existing.slug;
    const impacted = await prisma.modelProvider.findMany({
      where: {
        OR: [
          { customPlatformProviderId: id },
          { providerId: `custom:${providerSlug}` },
        ],
      },
      select: { modelId: true },
    });

    const affectedModels = Array.from(new Set(impacted.map((p) => p.modelId)));

    await prisma.modelProvider.deleteMany({
      where: {
        OR: [
          { customPlatformProviderId: id },
          { providerId: `custom:${providerSlug}` },
        ],
      },
    });

    for (const modelId of affectedModels) {
      const enabledCount = await countEnabledProviders(modelId);
      if (enabledCount === 0) {
        await removeModelFromTiers(modelId);
      } else {
        await ensureDefaultProvider(modelId);
      }
    }
  }

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when providers change
  return NextResponse.json({ ok: true });
}
