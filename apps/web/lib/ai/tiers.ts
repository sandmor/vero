import type { UserType } from '@/lib/auth/types';
import { prisma, Prisma } from '@vero/db';
import { DEFAULT_CHAT_MODEL } from './models';

export type TierRecord = {
  id: string;
  modelIds: string[];
  bucketCapacity: number;
  bucketRefillAmount: number;
  bucketRefillIntervalSeconds: number;
};

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

const FALLBACK_TIERS: Record<UserType, TierRecord> = {
  guest: {
    id: 'guest',
    modelIds: parseModelList(process.env.GUEST_MODELS, [DEFAULT_CHAT_MODEL]),
    bucketCapacity: 60,
    bucketRefillAmount: 20,
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

type TierInclude = Prisma.TierInclude;
type TierResult<T extends TierInclude> = Prisma.TierGetPayload<{ include: T }>;

async function fetchTierRow<T extends TierInclude>(
  id: string,
  include: T
): Promise<
  | { row: TierResult<T>; fallback: undefined }
  | { row: null; fallback: TierRecord }
> {
  const row = await prisma.tier
    .findUnique({ where: { id }, include })
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
      return { row: null, fallback };
    }
    throw new Error(`Tier '${id}' not found and no fallback available`);
  }

  return { row, fallback: undefined };
}

export async function getTier(id: string): Promise<TierRecord> {
  const { row, fallback } = await fetchTierRow(id, {
    models: { select: { modelId: true } },
  });

  if (fallback) return fallback;

  const modelIds = row.models.map((m) => m.modelId);

  return {
    id: row.id,
    modelIds,
    bucketCapacity:
      row.bucketCapacity ?? FALLBACK_TIERS[id as UserType].bucketCapacity,
    bucketRefillAmount:
      row.bucketRefillAmount ??
      FALLBACK_TIERS[id as UserType].bucketRefillAmount,
    bucketRefillIntervalSeconds:
      row.bucketRefillIntervalSeconds ??
      FALLBACK_TIERS[id as UserType].bucketRefillIntervalSeconds,
  };
}

export async function getTierWithModels(
  id: string
): Promise<TierRecordWithModels> {
  const { row, fallback } = await fetchTierRow(id, {
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
  });

  if (fallback) return { ...fallback, models: [] };

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
      row.bucketRefillAmount ??
      FALLBACK_TIERS[id as UserType].bucketRefillAmount,
    bucketRefillIntervalSeconds:
      row.bucketRefillIntervalSeconds ??
      FALLBACK_TIERS[id as UserType].bucketRefillIntervalSeconds,
    models,
  };
}
