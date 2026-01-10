import 'server-only';

import {
    SYSTEM_AGENTS,
    SYSTEM_AGENT_SLUGS,
    type SystemAgentSettings,
} from '@/lib/ai/system-agents';
import type { SystemAgent } from '@/lib/db/schema';
import type { Prisma } from '@vero/db';
import { prisma } from '@vero/db';

/**
 * Ensure all system agents exist in the database.
 * Creates any missing system agents with their default settings.
 * Called on admin access or app startup.
 */
export async function ensureSystemAgents(): Promise<void> {
  const existing = await prisma.systemAgent.findMany({
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((a) => a.slug));

  const missing = SYSTEM_AGENT_SLUGS.filter((slug) => !existingSlugs.has(slug));

  if (missing.length === 0) return;

  await prisma.systemAgent.createMany({
    data: missing.map((slug) => {
      const def = SYSTEM_AGENTS[slug];
      return {
        slug: def.slug,
        name: def.name,
        description: def.description,
        settings: def.defaultSettings as unknown as Prisma.JsonObject,
      };
    }),
    skipDuplicates: true,
  });
}

/**
 * Get all system agents.
 */
export async function getSystemAgents(): Promise<SystemAgent[]> {
  await ensureSystemAgents();
  return prisma.systemAgent.findMany({
    orderBy: { slug: 'asc' },
  });
}

/**
 * Get a single system agent by slug.
 */
export async function getSystemAgentBySlug(
  slug: string
): Promise<SystemAgent | null> {
  await ensureSystemAgents();
  return prisma.systemAgent.findUnique({
    where: { slug },
  });
}

/**
 * Update a system agent's settings.
 * Only settings can be updated - slug, name, description are immutable.
 */
export async function updateSystemAgentSettings(
  slug: string,
  settings: SystemAgentSettings
): Promise<SystemAgent> {
  const definition = SYSTEM_AGENTS[slug];
  if (!definition) {
    throw new Error(`Unknown system agent: ${slug}`);
  }

  await ensureSystemAgents();

  return prisma.systemAgent.update({
    where: { slug },
    data: {
      settings: settings as unknown as Prisma.JsonObject,
      updatedAt: new Date(),
    },
  });
}

/**
 * Reset a system agent to its default settings.
 */
export async function resetSystemAgent(slug: string): Promise<SystemAgent> {
  const definition = SYSTEM_AGENTS[slug];
  if (!definition) {
    throw new Error(`Unknown system agent: ${slug}`);
  }

  await ensureSystemAgents();

  return prisma.systemAgent.update({
    where: { slug },
    data: {
      settings: definition.defaultSettings as unknown as Prisma.JsonObject,
      updatedAt: new Date(),
    },
  });
}
