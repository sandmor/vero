import { CatalogRefreshButton } from '@/components/admin/catalog-refresh-button';
import {
  TierEditor,
  type TierActionState,
} from '@/components/admin/tier-editor';
import {
  ensureModelCapabilities,
  upsertModel,
  upsertModelProvider,
} from '@/lib/ai/model-capabilities';
import { getTierWithModels, invalidateTierCache } from '@/lib/ai/tiers';
import { prisma, PrismaClient } from '@virid/db';
import { revalidatePath } from 'next/cache';
import type {
  CatalogEntry,
  ModelFormat,
  ModelPricing,
} from '@/lib/ai/model-capabilities/types';
import { parseModelId } from '@/lib/ai/model-id';

// Transaction client type - using PrismaClient directly for proper type inference
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// Type for catalog entry passed from form
type CatalogEntryInput = {
  modelId: string;
  entry: CatalogEntry;
};

async function updateTierAction(
  _prevState: TierActionState,
  formData: FormData
): Promise<TierActionState> {
  'use server';

  const id = formData.get('id');
  if (id !== 'guest' && id !== 'regular') {
    return { status: 'error', message: 'Unknown tier selected.' };
  }

  const bucketCapacity = Number(formData.get('bucketCapacity'));
  const bucketRefillAmount = Number(formData.get('bucketRefillAmount'));
  const bucketRefillIntervalSeconds = Number(
    formData.get('bucketRefillIntervalSeconds')
  );

  const selected = (formData.getAll('modelIds') as string[]) || [];
  const modelIds = Array.from(
    new Set(selected.map((s) => s.trim()).filter(Boolean))
  );

  // Parse catalog entries for models being added from the catalog
  let catalogEntries: CatalogEntryInput[] = [];
  try {
    const catalogEntriesJson = formData.get('catalogEntries');
    if (catalogEntriesJson && typeof catalogEntriesJson === 'string') {
      catalogEntries = JSON.parse(catalogEntriesJson);
    }
  } catch {
    // Ignore parse errors - proceed without catalog entries
  }

  const numericValues = [
    bucketCapacity,
    bucketRefillAmount,
    bucketRefillIntervalSeconds,
  ];

  if (numericValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return {
      status: 'error',
      message: 'All rate limit values must be positive numbers.',
    };
  }

  if (modelIds.length === 0) {
    return { status: 'error', message: 'Select at least one model.' };
  }

  // Create Model and ModelProvider entries for any new models from catalog
  for (const { modelId, entry } of catalogEntries) {
    if (!modelIds.includes(modelId)) continue; // Skip if not in selected models

    const parsed = parseModelId(modelId);
    const creator = entry.suggestedCreator ?? parsed?.creator ?? 'unknown';

    // Create the Model entry
    await upsertModel({
      id: modelId,
      name: entry.suggestedName ?? parsed?.modelName ?? modelId,
      creator,
      supportsTools: entry.supportsTools,
      supportedFormats: entry.supportedFormats as ModelFormat[],
    });

    // Create the ModelProvider link
    await upsertModelProvider(modelId, {
      providerId: entry.providerId,
      providerModelId: entry.providerModelId,
      pricing: entry.pricing as ModelPricing | null,
      isDefault: true,
      enabled: true,
    });
  }

  // Validate that all selected models exist AND have at least one provider
  const modelsWithProviders = await prisma.model.findMany({
    where: {
      id: { in: modelIds },
      providers: { some: {} }, // Must have at least one provider
    },
    select: { id: true },
  });

  const validModelIds = new Set(modelsWithProviders.map((m) => m.id));
  const invalidModels = modelIds.filter((id) => !validModelIds.has(id));

  if (invalidModels.length > 0) {
    return {
      status: 'error',
      message: `Cannot add models without providers to tier: ${invalidModels.join(', ')}`,
    };
  }

  // Ensure all models have capabilities in the database
  await ensureModelCapabilities();

  // Use transaction to update tier and its model associations
  await prisma.$transaction(async (tx: TxClient) => {
    // Upsert the tier record
    await tx.tier.upsert({
      where: { id },
      create: {
        id,
        bucketCapacity,
        bucketRefillAmount,
        bucketRefillIntervalSeconds,
      },
      update: {
        bucketCapacity,
        bucketRefillAmount,
        bucketRefillIntervalSeconds,
      },
    });

    // Delete existing model associations for this tier
    await tx.tierModel.deleteMany({
      where: { tierId: id },
    });

    // Create new model associations
    if (modelIds.length > 0) {
      await tx.tierModel.createMany({
        data: modelIds.map((modelId) => ({
          tierId: id,
          modelId,
        })),
      });
    }
  });

  invalidateTierCache(id);
  revalidatePath('/settings');

  return { status: 'success', message: 'Tier updated.' };
}

export default async function TiersSection() {
  const [guestTier, regularTier] = await Promise.all([
    getTierWithModels('guest'),
    getTierWithModels('regular'),
  ]);

  return (
    <section className="space-y-4 rounded-2xl border border-border/60 bg-muted/10 p-5 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">User Tiers</h2>
          <p className="text-xs text-muted-foreground">
            Configure rate limits and available models for different user types.
            Only models with configured providers can be added to tiers.
          </p>
        </div>
        <CatalogRefreshButton />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TierEditor id="guest" tier={guestTier} action={updateTierAction} />
        <TierEditor id="regular" tier={regularTier} action={updateTierAction} />
      </div>
    </section>
  );
}
