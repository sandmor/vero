import {
  countEnabledProviders,
  ensureDefaultProvider,
  removeModelFromTiers,
} from '@/lib/ai/model-capabilities';
import type {
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities/types';
import {
  isValidModelSlug,
  isValidProviderModelId,
} from '@/lib/ai/shared-provider';
import { invalidateTierCache } from '@/lib/ai/tiers';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@vero/db';
import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET - List all platform custom models
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const models = await prisma.platformCustomModel.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      provider: {
        select: {
          id: true,
          slug: true,
          name: true,
          enabled: true,
        },
      },
    },
  });

  const safeModels = models.map((m) => ({
    id: m.id,
    modelSlug: m.modelSlug,
    displayName: m.displayName,
    providerId: m.providerId,
    providerSlug: m.provider.slug,
    providerName: m.provider.name,
    providerEnabled: m.provider.enabled,
    providerModelId: m.providerModelId,
    supportsTools: m.supportsTools,
    supportedFormats: m.supportedFormats as ModelFormat[],
    maxOutputTokens: m.maxOutputTokens,
    pricing: m.pricing as ModelPricing | null,
    enabled: m.enabled,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));

  return NextResponse.json({ models: safeModels });
}

/**
 * POST - Create a new platform custom model
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    modelSlug,
    displayName,
    providerId,
    providerModelId,
    supportsTools = true,
    supportedFormats = ['text'],
    maxOutputTokens,
    pricing,
  } = body as {
    modelSlug?: string;
    displayName?: string;
    providerId?: string;
    providerModelId?: string;
    supportsTools?: boolean;
    supportedFormats?: ModelFormat[];
    maxOutputTokens?: number | null;
    pricing?: ModelPricing | null;
  };

  // Validate modelSlug
  if (!modelSlug || !isValidModelSlug(modelSlug)) {
    return NextResponse.json(
      {
        error:
          'Model slug is required (max 256 characters, no leading/trailing spaces).',
      },
      { status: 400 }
    );
  }

  // Validate displayName
  if (
    !displayName ||
    displayName.trim().length === 0 ||
    displayName.length > 256
  ) {
    return NextResponse.json(
      { error: 'Display name is required (max 256 characters).' },
      { status: 400 }
    );
  }

  // Validate providerId
  if (!providerId) {
    return NextResponse.json(
      { error: 'Provider ID is required.' },
      { status: 400 }
    );
  }

  const provider = await prisma.platformCustomProvider.findUnique({
    where: { id: providerId },
  });
  if (!provider) {
    return NextResponse.json({ error: 'Provider not found.' }, { status: 404 });
  }

  // Validate providerModelId
  if (!providerModelId || !isValidProviderModelId(providerModelId)) {
    return NextResponse.json(
      { error: 'Provider model ID is required (max 256 characters).' },
      { status: 400 }
    );
  }

  // Check for duplicate modelSlug
  const existingModel = await prisma.platformCustomModel.findUnique({
    where: { modelSlug },
  });
  if (existingModel) {
    return NextResponse.json(
      { error: 'A model with this slug already exists.' },
      { status: 409 }
    );
  }

  // Also check against existing Model table to prevent conflicts
  const existingRegistryModel = await prisma.model.findUnique({
    where: { id: modelSlug },
  });
  if (existingRegistryModel) {
    return NextResponse.json(
      { error: 'This slug conflicts with an existing platform model.' },
      { status: 409 }
    );
  }

  const model = await prisma.platformCustomModel.create({
    data: {
      modelSlug,
      displayName: displayName.trim(),
      providerId,
      providerModelId,
      supportsTools,
      supportedFormats,
      maxOutputTokens: maxOutputTokens ?? null,
      pricing: pricing ?? undefined,
      enabled: true,
    },
    include: {
      provider: {
        select: { slug: true, name: true },
      },
    },
  });

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when platform models change
  return NextResponse.json({
    id: model.id,
    modelSlug: model.modelSlug,
    displayName: model.displayName,
    providerId: model.providerId,
    providerSlug: model.provider.slug,
    providerName: model.provider.name,
    providerModelId: model.providerModelId,
    supportsTools: model.supportsTools,
    supportedFormats: model.supportedFormats,
    maxOutputTokens: model.maxOutputTokens,
    pricing: model.pricing,
    enabled: model.enabled,
  });
}

/**
 * PUT - Update an existing platform custom model
 */
export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    id,
    displayName,
    providerModelId,
    supportsTools,
    supportedFormats,
    maxOutputTokens,
    pricing,
    enabled,
  } = body as {
    id?: string;
    displayName?: string;
    providerModelId?: string;
    supportsTools?: boolean;
    supportedFormats?: ModelFormat[];
    maxOutputTokens?: number | null;
    pricing?: ModelPricing | null;
    enabled?: boolean;
  };

  if (!id) {
    return NextResponse.json(
      { error: 'Model ID is required.' },
      { status: 400 }
    );
  }

  const existing = await prisma.platformCustomModel.findUnique({
    where: { id },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Model not found.' }, { status: 404 });
  }

  // Build update data
  const updateData: Record<string, unknown> = {};

  if (displayName !== undefined) {
    if (displayName.trim().length === 0 || displayName.length > 256) {
      return NextResponse.json(
        { error: 'Display name is required (max 256 characters).' },
        { status: 400 }
      );
    }
    updateData.displayName = displayName.trim();
  }

  if (providerModelId !== undefined) {
    if (!isValidProviderModelId(providerModelId)) {
      return NextResponse.json(
        { error: 'Provider model ID is required (max 256 characters).' },
        { status: 400 }
      );
    }
    updateData.providerModelId = providerModelId;
  }

  if (supportsTools !== undefined) {
    updateData.supportsTools = supportsTools;
  }

  if (supportedFormats !== undefined) {
    updateData.supportedFormats = supportedFormats;
  }

  if (maxOutputTokens !== undefined) {
    updateData.maxOutputTokens = maxOutputTokens;
  }

  if (pricing !== undefined) {
    updateData.pricing = pricing;
  }

  if (enabled !== undefined) {
    updateData.enabled = enabled;
  }

  const model = await prisma.platformCustomModel.update({
    where: { id },
    data: updateData,
    include: {
      provider: {
        select: { slug: true, name: true },
      },
    },
  });

  // If disabling, also disable linked model provider rows and clean tiers
  if (enabled === false) {
    await prisma.modelProvider.updateMany({
      where: { modelId: model.modelSlug },
      data: { enabled: false, isDefault: false },
    });

    const enabledCount = await countEnabledProviders(model.modelSlug);
    if (enabledCount === 0) {
      await removeModelFromTiers(model.modelSlug);
    } else {
      await ensureDefaultProvider(model.modelSlug);
    }
  }

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when platform models change
  return NextResponse.json({
    id: model.id,
    modelSlug: model.modelSlug,
    displayName: model.displayName,
    providerId: model.providerId,
    providerSlug: model.provider.slug,
    providerName: model.provider.name,
    providerModelId: model.providerModelId,
    supportsTools: model.supportsTools,
    supportedFormats: model.supportedFormats,
    maxOutputTokens: model.maxOutputTokens,
    pricing: model.pricing,
    enabled: model.enabled,
  });
}

/**
 * DELETE - Delete a platform custom model
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
      { error: 'Model ID is required.' },
      { status: 400 }
    );
  }

  const existing = await prisma.platformCustomModel.findUnique({
    where: { id },
    select: { modelSlug: true },
  });

  await prisma.platformCustomModel.delete({ where: { id } }).catch(() => {});

  if (existing) {
    await prisma.modelProvider.deleteMany({
      where: { modelId: existing.modelSlug },
    });

    const enabledCount = await countEnabledProviders(existing.modelSlug);
    if (enabledCount === 0) {
      await removeModelFromTiers(existing.modelSlug);
    } else {
      await ensureDefaultProvider(existing.modelSlug);
    }
  }

  revalidatePath('/settings');
  invalidateTierCache(); // Invalidate tier cache when platform models change
  return NextResponse.json({ ok: true });
}
