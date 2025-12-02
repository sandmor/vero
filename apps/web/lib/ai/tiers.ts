import type { UserType } from '@/lib/auth/types';
import { prisma } from '../db/prisma';

export type TierRecord = {
  id: string;
  modelIds: string[];
  bucketCapacity: number;
  bucketRefillAmount: number;
  bucketRefillIntervalSeconds: number;
};

// Fallback definitions used if the DB rows are missing (e.g. before migrations run or during first boot)
// Keep these in sync with the migration seed. They guarantee the app remains functional.
const FALLBACK_TIERS: Record<UserType, TierRecord> = {
  guest: {
    id: 'guest',
    modelIds: [
      'openrouter:x-ai/grok-4-fast:free',
      'openrouter:moonshotai/kimi-k2:free',
    ],
    bucketCapacity: 60, // allow bursts up to 60 messages
    bucketRefillAmount: 20, // refill 20 per hour
    bucketRefillIntervalSeconds: 3600,
  },
  regular: {
    id: 'regular',
    modelIds: [
      'openai:gpt-5',
      'google:gemini-2.5-flash-image-preview',
      'google:gemini-2.5-flash',
      'google:gemini-2.5-pro',
      'openrouter:x-ai/grok-4',
      'openrouter:x-ai/grok-4-fast:free',
      'openrouter:moonshotai/kimi-k2:free',
    ],
    bucketCapacity: 300,
    bucketRefillAmount: 100,
    bucketRefillIntervalSeconds: 3600,
  },
};

// 60s TTL simple cache; reuse provider TTL constant if desired later
const TTL_MS = 60_000;
let cacheStore: Record<string, { value: TierRecord; fetchedAt: number }> = {};

async function fetchTier(id: string): Promise<TierRecord> {
  const row = await prisma.tier.findUnique({ where: { id } }).catch((err) => {
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

  const r: any = row as any;
  return {
    id: r.id,
    modelIds: r.modelIds,
    bucketCapacity:
      r.bucketCapacity ?? FALLBACK_TIERS[id as UserType].bucketCapacity,
    bucketRefillAmount:
      r.bucketRefillAmount ?? FALLBACK_TIERS[id as UserType].bucketRefillAmount,
    bucketRefillIntervalSeconds:
      r.bucketRefillIntervalSeconds ??
      FALLBACK_TIERS[id as UserType].bucketRefillIntervalSeconds,
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

export async function getTierForUserType(
  userType: UserType
): Promise<TierRecord> {
  // userType matches tier id currently (guest|regular)
  return getTier(userType);
}

export function invalidateTierCache(id?: string) {
  if (id) delete cacheStore[id];
  else cacheStore = {};
}
