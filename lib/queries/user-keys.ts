import { prisma } from '@/lib/db/prisma';
import { SUPPORTED_PROVIDERS } from '@/lib/ai/registry';

export type UserByokProviderSelection = {
  apiKey: string;
  modelIds: string[];
};

export type UserByokConfig = {
  providers: Record<string, UserByokProviderSelection>;
  modelIds: string[];
};

export type UserApiKeyRecord = {
  userId: string;
  providerId: string;
  apiKey: string;
  modelIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export async function getUserApiKeys(
  userId: string
): Promise<Record<string, string>> {
  const userApiKeys = await getUserApiKeysWithMetadata(userId);
  const keys: Record<string, string> = {};
  userApiKeys.forEach((key) => {
    keys[key.providerId] = key.apiKey;
  });
  return keys;
}

export async function upsertUserApiKey(
  userId: string,
  providerId: string,
  apiKey: string,
  modelIds: string[] = []
): Promise<void> {
  // Validate providerId
  if (!SUPPORTED_PROVIDERS.includes(providerId as any)) {
    throw new Error('Invalid or unsupported provider');
  }

  // Validate apiKey
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('API key required');
  }

  // Validate modelIds is an array
  if (!Array.isArray(modelIds)) {
    throw new Error('modelIds must be an array');
  }

  // Ensure the provider exists in the Provider table (required for foreign key constraint)
  await prisma.provider.upsert({
    where: { id: providerId },
    create: { id: providerId, apiKey: '' }, // Empty apiKey for global provider record
    update: {}, // No update needed, just ensure it exists
  });

  // Store the key (upsert to handle both create and update)
  await prisma.userApiKey.upsert({
    where: {
      userId_providerId: {
        userId,
        providerId,
      },
    },
    create: {
      userId,
      providerId,
      apiKey: apiKey.trim(),
      modelIds,
    },
    update: {
      apiKey: apiKey.trim(),
      modelIds,
    },
  });
}

export async function deleteUserApiKey(
  userId: string,
  providerId: string
): Promise<void> {
  // Validate providerId
  if (!SUPPORTED_PROVIDERS.includes(providerId as any)) {
    throw new Error('Invalid or unsupported provider');
  }

  // Delete the user's key for this provider
  await prisma.userApiKey
    .delete({
      where: {
        userId_providerId: {
          userId,
          providerId,
        },
      },
    })
    .catch(() => {
      // Ignore if key doesn't exist
    });
}

export async function getUserApiKeysWithMetadata(
  userId: string
): Promise<UserApiKeyRecord[]> {
  return prisma.userApiKey.findMany({
    where: { userId },
    orderBy: { providerId: 'asc' },
  });
}

export async function getUserByokConfig(
  userId: string
): Promise<UserByokConfig> {
  const records = await getUserApiKeysWithMetadata(userId);
  const providers: Record<string, UserByokProviderSelection> = {};
  const modelIds: string[] = [];

  for (const record of records) {
    const selectedModels = Array.isArray(record.modelIds)
      ? record.modelIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0
        )
      : [];

    if (!record.apiKey || selectedModels.length === 0) {
      continue;
    }

    providers[record.providerId] = {
      apiKey: record.apiKey,
      modelIds: selectedModels,
    };

    for (const id of selectedModels) {
      modelIds.push(id);
    }
  }

  const uniqueModelIds = Array.from(new Set(modelIds));

  return {
    providers,
    modelIds: uniqueModelIds,
  };
}
