import { cache } from 'react';
import { prisma } from '../db/prisma';

// Fallback environment variable names per provider
const ENV_MAP: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
};

/** Resolve an API key for a provider with precedence: DB Provider row -> first present env var -> undefined. */
export const getProviderApiKey = cache(
  async (providerId: string): Promise<string | undefined> => {
    // DB override
    try {
      const record = await prisma.provider.findUnique({
        where: { id: providerId },
      });
      if (record?.apiKey) return record.apiKey;
    } catch {
      // Swallow to avoid cascading failure if migration not yet applied; callers can handle missing keys.
    }
    const envCandidates = ENV_MAP[providerId] || [];
    for (const name of envCandidates) {
      const val = process.env[name];
      if (val) return val;
    }
    return undefined;
  }
);
