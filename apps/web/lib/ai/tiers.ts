import type { UserType } from '@/lib/auth/types';
import { prisma } from '@virid/db';
import { DEFAULT_CHAT_MODEL } from './models';

export type TierRecord = {
  id: string;
  modelIds: string[];
  bucketCapacity: number;
  bucketRefillAmount: number;
  bucketRefillIntervalSeconds: number;
};

/**
 * Extended tier record that includes full model capabilities
 */
export type TierRecordWithModels = TierRecord & {
  models: {
    id: string;
    name: string;
    creator: string;
    supportsTools: boolean;
    supportedFormats: string[];
  }[];
};

function parseModelList(
  envVar: string | undefined,
  defaultList: string[]
): string[] {
  if (!envVar) return defaultList;
  return envVar
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Fallback definitions used if the DB rows are missing (e.g. before migrations run or during first boot)
// Keep these in sync with the migration seed. They guarantee the app remains functional.
const FALLBACK_TIERS: Record<UserType, TierRecord> = {
  guest: {
    id: 'guest',
    modelIds: parseModelList(process.env.GUEST_MODELS, [DEFAULT_CHAT_MODEL]),
    bucketCapacity: 60, // allow bursts up to 60 messages
    bucketRefillAmount: 20, // refill 20 per hour
    bucketRefillIntervalSeconds: 3600,
  },
  regular: {
    id: 'regular',
    modelIds: parseModelList(process.env.REGULAR_MODELS, [DEFAULT_CHAT_MODEL]),
    bucketCapacity: 300,
    bucketRefillAmount: 100,
    bucketRefillIntervalSeconds: 3600,
  },
};

// 60s TTL simple cache; reuse provider TTL constant if desired later
const TTL_MS = 60_000;
let cacheStore: Record<string, { value: TierRecord; fetchedAt: number }> = {};
let cacheStoreWithModels: Record<string, { value: TierRecordWithModels; fetchedAt: number }> = {};

async function fetchTier(id: string): Promise<TierRecord> {
  const row = await prisma.tier
    .findUnique({
      where: { id },
      include: {
        models: {
          select: {
            modelId: true,
          },
        },
      },
    })
    .catch((err) => {
      // In rare cases (e.g., during migration) Prisma might throw before table exists.
      console.warn(
        'Tier lookup failed, attempting fallback:',
        err?.message || err
      );
      return null;
    });

  if (!row) {
    const fallback = FALLBACK_TIERS[id as UserType];
    if (fallback) {
      console.warn(
        `[tiers] Using fallback tier definition for '${id}' (DB row missing).`
      );
      return fallback;
    }
    throw new Error(`Tier '${id}' not found and no fallback available`);
  }

  // Extract model IDs from the relation
  const modelIds = row.models.map((m) => m.modelId);

  return {
    id: row.id,
    modelIds,
    bucketCapacity:
      row.bucketCapacity ?? FALLBACK_TIERS[id as UserType].bucketCapacity,
    bucketRefillAmount:
      row.bucketRefillAmount ?? FALLBACK_TIERS[id as UserType].bucketRefillAmount,
    bucketRefillIntervalSeconds:
      row.bucketRefillIntervalSeconds ??
      FALLBACK_TIERS[id as UserType].bucketRefillIntervalSeconds,
  };
}

/**
 * Fetch a tier with full model capabilities included
 */
async function fetchTierWithModels(id: string): Promise<TierRecordWithModels> {
  const row = await prisma.tier
    .findUnique({
      where: { id },
      include: {
        models: {
          include: {
            model: {
              select: {
                id: true,
                name: true,
                creator: true,
                supportsTools: true,
                supportedFormats: true,
              },
            },
          },
        },
      },
    })
    .catch((err) => {
      console.warn(
        'Tier lookup failed, attempting fallback:',
        err?.message || err
      );
      return null;
    });

  if (!row) {
    const fallback = FALLBACK_TIERS[id as UserType];
    if (fallback) {
      console.warn(
        `[tiers] Using fallback tier definition for '${id}' (DB row missing).`
      );
      return {
        ...fallback,
        models: [],
      };
    }
    throw new Error(`Tier '${id}' not found and no fallback available`);
  }

  const models = row.models.map((m) => ({
    id: m.model.id,
    name: m.model.name,
    creator: m.model.creator,
    supportsTools: m.model.supportsTools,
    supportedFormats: m.model.supportedFormats,
  }));

  return {
    id: row.id,
    modelIds: models.map((m) => m.id),
    bucketCapacity:
      row.bucketCapacity ?? FALLBACK_TIERS[id as UserType].bucketCapacity,
    bucketRefillAmount:
      row.bucketRefillAmount ?? FALLBACK_TIERS[id as UserType].bucketRefillAmount,
    bucketRefillIntervalSeconds:
      row.bucketRefillIntervalSeconds ??
      FALLBACK_TIERS[id as UserType].bucketRefillIntervalSeconds,
    models,
  };
}

export async function getTier(id: string): Promise<TierRecord> {
  const now = Date.now();
  const existing = cacheStore[id];
  if (existing && now - existing.fetchedAt < TTL_MS) return existing.value;
  const value = await fetchTier(id);
  cacheStore[id] = { value, fetchedAt: now };
  return value;
}

/**
 * Get a tier with full model capabilities included (cached)
 */
export async function getTierWithModels(id: string): Promise<TierRecordWithModels> {
  const now = Date.now();
  const existing = cacheStoreWithModels[id];
  if (existing && now - existing.fetchedAt < TTL_MS) return existing.value;
  const value = await fetchTierWithModels(id);
  cacheStoreWithModels[id] = { value, fetchedAt: now };
  return value;
}

export async function getTierForUserType(
  userType: UserType
): Promise<TierRecord> {
  // userType matches tier id currently (guest|regular)
  return getTier(userType);
}

/**
 * Get tier with full model capabilities for a user type
 */
export async function getTierWithModelsForUserType(
  userType: UserType
): Promise<TierRecordWithModels> {
  return getTierWithModels(userType);
}

export function invalidateTierCache(id?: string) {
  if (id) {
    delete cacheStore[id];
    delete cacheStoreWithModels[id];
  } else {
    cacheStore = {};
    cacheStoreWithModels = {};
  }
}
