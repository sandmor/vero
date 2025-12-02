import { CatalogRefreshButton } from '@/components/admin/catalog-refresh-button';
import { TierCard, type TierActionState } from '@/components/admin/tier-card';
import { ensureModelCapabilities } from '@/lib/ai/model-capabilities';
import { getTier, invalidateTierCache } from '@/lib/ai/tiers';
import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';

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

  const ensureResult = await ensureModelCapabilities(modelIds);
  if (ensureResult.errors.length > 0) {
    return {
      status: 'error',
      message: `Failed to register models: ${ensureResult.errors.join('; ')}`,
    };
  }

  await prisma.tier.upsert({
    where: { id },
    create: {
      id,
      modelIds,
      bucketCapacity,
      bucketRefillAmount,
      bucketRefillIntervalSeconds,
    },
    update: {
      modelIds,
      bucketCapacity,
      bucketRefillAmount,
      bucketRefillIntervalSeconds,
    },
  });

  invalidateTierCache(id);
  revalidatePath('/settings');

  const messageParts = ['Tier updated.'];
  if (ensureResult.created > 0) {
    messageParts.push(
      `Added ${ensureResult.created} new model${ensureResult.created === 1 ? '' : 's'} to the catalog.`
    );
  }

  return { status: 'success', message: messageParts.join(' ') };
}

export default async function TiersSection() {
  const [guestTier, regularTier] = await Promise.all([
    getTier('guest'),
    getTier('regular'),
  ]);

  return (
    <section className="space-y-4 rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm backdrop-blur-sm animate-in fade-in-0 slide-in-from-bottom-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tiers</h2>
          <p className="text-xs text-muted-foreground">
            Guest = not signed in users. Regular = signed in users.
          </p>
        </div>
        <CatalogRefreshButton />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <TierCard id="guest" tier={guestTier} action={updateTierAction} />
        <TierCard id="regular" tier={regularTier} action={updateTierAction} />
      </div>
    </section>
  );
}
