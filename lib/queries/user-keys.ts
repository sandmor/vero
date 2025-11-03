import { prisma } from '@/lib/db/prisma';
import { SUPPORTED_PROVIDERS } from '@/lib/ai/registry';

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
  const userApiKeys = await prisma.userApiKey.findMany({
    where: { userId },
    orderBy: { providerId: 'asc' },
  });

  // Return in format: { providerId: apiKey }
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
