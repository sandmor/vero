/**
 * User BYOK (Bring Your Own Key) Query Utilities
 *
 * Handles database operations for:
 * - User provider keys (platform provider API keys)
 * - User custom providers (OpenAI-compatible endpoints)
 * - User BYOK models
 */

import { prisma } from '@virid/db';
import { isKnownProvider, providerSupportsByok } from '@/lib/ai/registry';
import {
  formatByokPlatformModelId,
  formatByokCustomModelId,
  type ParsedByokModelId,
} from '@/lib/ai/byok';

// ============================================================================
// Types
// ============================================================================

export type UserProviderKeyRecord = {
  id: string;
  userId: string;
  providerId: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
};

export type UserCustomProviderRecord = {
  id: string;
  userId: string;
  slug: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UserByokModelRecord = {
  id: string;
  userId: string;
  sourceType: 'platform' | 'custom';
  providerId: string | null;
  customProviderId: string | null;
  customProviderSlug: string | null;
  customProviderName: string | null;
  providerModelId: string;
  displayName: string;
  supportsTools: boolean;
  maxOutputTokens: number | null;
  createdAt: Date;
  updatedAt: Date;
  // Computed full model ID
  fullModelId: string;
};

export type UserByokConfig = {
  providerKeys: Record<string, string>; // providerId -> apiKey
  customProviders: UserCustomProviderRecord[];
  models: UserByokModelRecord[];
};

// ============================================================================
// Provider Keys
// ============================================================================

/**
 * Get all provider keys for a user
 */
export async function getUserProviderKeys(
  userId: string
): Promise<UserProviderKeyRecord[]> {
  const records = await prisma.userProviderKey.findMany({
    where: { userId },
    orderBy: { providerId: 'asc' },
  });
  return records.map((r) => ({
    id: r.id,
    userId: r.userId,
    providerId: r.providerId,
    apiKey: r.apiKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Get a specific provider key for a user
 */
export async function getUserProviderKey(
  userId: string,
  providerId: string
): Promise<string | null> {
  const record = await prisma.userProviderKey.findUnique({
    where: {
      userId_providerId: { userId, providerId },
    },
    select: { apiKey: true },
  });
  return record?.apiKey ?? null;
}

/**
 * Upsert a user provider key
 */
export async function upsertUserProviderKey(
  userId: string,
  providerId: string,
  apiKey: string
): Promise<void> {
  // Validate providerId
  if (!isKnownProvider(providerId)) {
    throw new Error('Unknown provider');
  }
  if (!providerSupportsByok(providerId)) {
    throw new Error('Provider does not support BYOK');
  }

  // Validate apiKey
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('API key required');
  }

  await prisma.userProviderKey.upsert({
    where: {
      userId_providerId: { userId, providerId },
    },
    create: {
      userId,
      providerId,
      apiKey: apiKey.trim(),
    },
    update: {
      apiKey: apiKey.trim(),
    },
  });
}

/**
 * Delete a user provider key and all associated models
 */
export async function deleteUserProviderKey(
  userId: string,
  providerId: string
): Promise<void> {
  if (!isKnownProvider(providerId)) {
    throw new Error('Unknown provider');
  }

  // Delete the key (cascade will remove associated models)
  await prisma.userProviderKey
    .delete({
      where: {
        userId_providerId: { userId, providerId },
      },
    })
    .catch(() => {
      // Ignore if doesn't exist
    });
}

// ============================================================================
// Custom Providers
// ============================================================================

/**
 * Get all custom providers for a user
 */
export async function getUserCustomProviders(
  userId: string
): Promise<UserCustomProviderRecord[]> {
  const records = await prisma.userCustomProvider.findMany({
    where: { userId },
    orderBy: { slug: 'asc' },
  });
  return records.map((r) => ({
    id: r.id,
    userId: r.userId,
    slug: r.slug,
    name: r.name,
    baseUrl: r.baseUrl,
    apiKey: r.apiKey,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Get a specific custom provider by slug
 */
export async function getUserCustomProviderBySlug(
  userId: string,
  slug: string
): Promise<UserCustomProviderRecord | null> {
  const record = await prisma.userCustomProvider.findUnique({
    where: {
      userId_slug: { userId, slug },
    },
  });
  if (!record) return null;
  return {
    id: record.id,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Get a custom provider by ID
 */
export async function getUserCustomProviderById(
  userId: string,
  id: string
): Promise<UserCustomProviderRecord | null> {
  const record = await prisma.userCustomProvider.findFirst({
    where: { id, userId },
  });
  if (!record) return null;
  return {
    id: record.id,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Create a custom provider
 */
export async function createUserCustomProvider(
  userId: string,
  data: {
    slug: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
  }
): Promise<UserCustomProviderRecord> {
  // Validate slug
  if (
    !/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(data.slug) ||
    data.slug.includes('--')
  ) {
    throw new Error(
      'Invalid provider slug. Use lowercase letters, numbers, and hyphens.'
    );
  }

  // Validate URL
  try {
    new URL(data.baseUrl);
  } catch {
    throw new Error('Invalid base URL');
  }

  const record = await prisma.userCustomProvider.create({
    data: {
      userId,
      slug: data.slug.toLowerCase(),
      name: data.name.trim(),
      baseUrl: data.baseUrl.trim(),
      apiKey: data.apiKey?.trim() || null,
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Update a custom provider
 */
export async function updateUserCustomProvider(
  userId: string,
  id: string,
  data: {
    name?: string;
    baseUrl?: string;
    apiKey?: string | null;
  }
): Promise<UserCustomProviderRecord> {
  // Validate URL if provided
  if (data.baseUrl) {
    try {
      new URL(data.baseUrl);
    } catch {
      throw new Error('Invalid base URL');
    }
  }

  const record = await prisma.userCustomProvider.update({
    where: { id, userId },
    data: {
      ...(data.name && { name: data.name.trim() }),
      ...(data.baseUrl && { baseUrl: data.baseUrl.trim() }),
      ...(data.apiKey !== undefined && { apiKey: data.apiKey?.trim() || null }),
    },
  });

  return {
    id: record.id,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: record.apiKey,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Delete a custom provider and all associated models
 */
export async function deleteUserCustomProvider(
  userId: string,
  id: string
): Promise<void> {
  await prisma.userCustomProvider.delete({
    where: { id, userId },
  });
}

// ============================================================================
// BYOK Models
// ============================================================================

function toUserByokModelRecord(r: {
  id: string;
  userId: string;
  sourceType: string;
  providerId: string | null;
  customProviderId: string | null;
  providerModelId: string;
  displayName: string;
  supportsTools: boolean;
  maxOutputTokens: number | null;
  createdAt: Date;
  updatedAt: Date;
  customProvider?: { slug: string; name: string } | null;
}): UserByokModelRecord {
  const sourceType = r.sourceType as 'platform' | 'custom';
  let fullModelId: string;

  if (sourceType === 'platform' && r.providerId) {
    fullModelId = formatByokPlatformModelId(
      r.providerId as any,
      r.providerModelId
    );
  } else if (sourceType === 'custom' && r.customProvider?.slug) {
    fullModelId = formatByokCustomModelId(
      r.customProvider.slug,
      r.providerModelId
    );
  } else {
    // Fallback - should not happen with valid data
    fullModelId = `byok:unknown:${r.providerModelId}`;
  }

  return {
    id: r.id,
    userId: r.userId,
    sourceType,
    providerId: r.providerId,
    customProviderId: r.customProviderId,
    customProviderSlug: r.customProvider?.slug ?? null,
    customProviderName: r.customProvider?.name ?? null,
    providerModelId: r.providerModelId,
    displayName: r.displayName,
    supportsTools: r.supportsTools,
    maxOutputTokens: r.maxOutputTokens,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    fullModelId,
  };
}

/**
 * Get all BYOK models for a user
 */
export async function getUserByokModels(
  userId: string
): Promise<UserByokModelRecord[]> {
  const records = await prisma.userByokModel.findMany({
    where: { userId },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
    orderBy: [{ sourceType: 'asc' }, { displayName: 'asc' }],
  });

  return records.map(toUserByokModelRecord);
}

/**
 * Get BYOK models for a specific platform provider
 */
export async function getUserByokModelsForProvider(
  userId: string,
  providerId: string
): Promise<UserByokModelRecord[]> {
  const records = await prisma.userByokModel.findMany({
    where: {
      userId,
      sourceType: 'platform',
      providerId,
    },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
    orderBy: { displayName: 'asc' },
  });

  return records.map(toUserByokModelRecord);
}

/**
 * Get BYOK models for a specific custom provider
 */
export async function getUserByokModelsForCustomProvider(
  userId: string,
  customProviderId: string
): Promise<UserByokModelRecord[]> {
  const records = await prisma.userByokModel.findMany({
    where: {
      userId,
      sourceType: 'custom',
      customProviderId,
    },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
    orderBy: { displayName: 'asc' },
  });

  return records.map(toUserByokModelRecord);
}

/**
 * Create a BYOK model for a platform provider
 */
export async function createUserByokPlatformModel(
  userId: string,
  data: {
    providerId: string;
    providerModelId: string;
    displayName: string;
    supportsTools?: boolean;
    maxOutputTokens?: number | null;
  }
): Promise<UserByokModelRecord> {
  // Validate provider has a key
  const providerKey = await prisma.userProviderKey.findUnique({
    where: {
      userId_providerId: { userId, providerId: data.providerId },
    },
  });

  if (!providerKey) {
    throw new Error(`No API key configured for provider ${data.providerId}`);
  }

  const record = await prisma.userByokModel.create({
    data: {
      userId,
      sourceType: 'platform',
      providerId: data.providerId,
      providerModelId: data.providerModelId.trim(),
      displayName: data.displayName.trim(),
      supportsTools: data.supportsTools ?? true,
      maxOutputTokens: data.maxOutputTokens ?? null,
    },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
  });

  return toUserByokModelRecord(record);
}

/**
 * Create a BYOK model for a custom provider
 */
export async function createUserByokCustomModel(
  userId: string,
  data: {
    customProviderId: string;
    providerModelId: string;
    displayName: string;
    supportsTools?: boolean;
    maxOutputTokens?: number | null;
  }
): Promise<UserByokModelRecord> {
  // Validate custom provider exists
  const customProvider = await prisma.userCustomProvider.findFirst({
    where: { id: data.customProviderId, userId },
  });

  if (!customProvider) {
    throw new Error('Custom provider not found');
  }

  const record = await prisma.userByokModel.create({
    data: {
      userId,
      sourceType: 'custom',
      customProviderId: data.customProviderId,
      providerModelId: data.providerModelId.trim(),
      displayName: data.displayName.trim(),
      supportsTools: data.supportsTools ?? true,
      maxOutputTokens: data.maxOutputTokens ?? null,
    },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
  });

  return toUserByokModelRecord(record);
}

/**
 * Update a BYOK model
 */
export async function updateUserByokModel(
  userId: string,
  modelId: string,
  data: {
    displayName?: string;
    supportsTools?: boolean;
    maxOutputTokens?: number | null;
  }
): Promise<UserByokModelRecord> {
  const record = await prisma.userByokModel.update({
    where: { id: modelId, userId },
    data: {
      ...(data.displayName && { displayName: data.displayName.trim() }),
      ...(data.supportsTools !== undefined && {
        supportsTools: data.supportsTools,
      }),
      ...(data.maxOutputTokens !== undefined && {
        maxOutputTokens: data.maxOutputTokens,
      }),
    },
    include: {
      customProvider: {
        select: { slug: true, name: true },
      },
    },
  });

  return toUserByokModelRecord(record);
}

/**
 * Delete a BYOK model
 */
export async function deleteUserByokModel(
  userId: string,
  modelId: string
): Promise<void> {
  await prisma.userByokModel.delete({
    where: { id: modelId, userId },
  });
}

// ============================================================================
// Combined Config
// ============================================================================

/**
 * Get full BYOK configuration for a user
 */
export async function getUserByokConfig(
  userId: string
): Promise<UserByokConfig> {
  const [providerKeys, customProviders, models] = await Promise.all([
    getUserProviderKeys(userId),
    getUserCustomProviders(userId),
    getUserByokModels(userId),
  ]);

  const providerKeysMap: Record<string, string> = {};
  for (const key of providerKeys) {
    providerKeysMap[key.providerId] = key.apiKey;
  }

  return {
    providerKeys: providerKeysMap,
    customProviders,
    models,
  };
}

/**
 * Get all BYOK model IDs for a user (for model selection UI)
 */
export async function getUserByokModelIds(userId: string): Promise<string[]> {
  const models = await getUserByokModels(userId);
  return models.map((m) => m.fullModelId);
}

/**
 * Get BYOK resolution info for a specific model ID
 * Returns the API key and endpoint info needed to make API calls
 */
export async function resolveByokModel(
  userId: string,
  parsed: ParsedByokModelId
): Promise<{
  apiKey: string;
  baseUrl?: string;
  providerModelId: string;
  supportsTools: boolean;
  maxOutputTokens: number | null;
} | null> {
  if (parsed.sourceType === 'platform') {
    // Get provider key
    const providerKey = await prisma.userProviderKey.findUnique({
      where: {
        userId_providerId: { userId, providerId: parsed.providerId },
      },
      select: { apiKey: true },
    });

    if (!providerKey?.apiKey) {
      return null;
    }

    // Check if model exists (for capabilities)
    const model = await prisma.userByokModel.findFirst({
      where: {
        userId,
        sourceType: 'platform',
        providerId: parsed.providerId,
        providerModelId: parsed.providerModelId,
      },
      select: { supportsTools: true, maxOutputTokens: true },
    });

    return {
      apiKey: providerKey.apiKey,
      providerModelId: parsed.providerModelId,
      supportsTools: model?.supportsTools ?? true,
      maxOutputTokens: model?.maxOutputTokens ?? null,
    };
  }

  // Custom provider
  const customProvider = await prisma.userCustomProvider.findFirst({
    where: {
      userId,
      slug: parsed.customProviderSlug,
    },
    select: {
      baseUrl: true,
      apiKey: true,
      models: {
        where: { providerModelId: parsed.providerModelId },
        select: { supportsTools: true, maxOutputTokens: true },
        take: 1,
      },
    },
  });

  if (!customProvider) {
    return null;
  }

  return {
    apiKey: customProvider.apiKey || '',
    baseUrl: customProvider.baseUrl,
    providerModelId: parsed.providerModelId,
    supportsTools: customProvider.models[0]?.supportsTools ?? true,
    maxOutputTokens: customProvider.models[0]?.maxOutputTokens ?? null,
  };
}
