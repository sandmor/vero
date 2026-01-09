import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { prisma } from '@vero/db';
import { Prisma as PrismaRuntime } from '@vero/db';
import { ChatSDKError } from '@/lib/errors';
import type { UserPreferences } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

// Export all user data
export async function GET() {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return new ChatSDKError(
        'unauthorized:api',
        'Not authenticated'
      ).toResponse();
    }

    const userId = session.user.id;

    // Fetch all user data in parallel
    const [user, chats, archiveEntries, archiveLinks, agents, pinnedEntries] =
      await Promise.all([
        // User preferences
        prisma.user.findUnique({
          where: { id: userId },
          select: { preferences: true },
        }),

        // All chats with messages
        prisma.chat.findMany({
          where: { userId },
          include: {
            messages: {
              orderBy: { pathText: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),

        // All archive entries
        prisma.archiveEntry.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),

        // Archive links (need to filter by user's entries)
        prisma.archiveEntry
          .findMany({
            where: { userId },
            select: { id: true },
          })
          .then(async (entries) => {
            const entryIds = entries.map((e) => e.id);
            if (!entryIds.length) return [];
            return prisma.archiveLink.findMany({
              where: {
                OR: [
                  { sourceId: { in: entryIds } },
                  { targetId: { in: entryIds } },
                ],
              },
            });
          }),

        // User's agents
        prisma.agent.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),

        // Pinned archive entries per chat
        prisma.chatPinnedArchiveEntry.findMany({
          where: { userId },
          include: {
            archiveEntry: {
              select: { slug: true },
            },
          },
        }),
      ]);

    // Build a mapping from archive entry ID to slug for links
    const entryIdToSlug = new Map<string, string>();
    for (const entry of archiveEntries) {
      entryIdToSlug.set(entry.id, entry.slug);
    }

    // Transform archive links to use slugs instead of IDs
    const transformedLinks = archiveLinks
      .map((link) => ({
        sourceSlug: entryIdToSlug.get(link.sourceId),
        targetSlug: entryIdToSlug.get(link.targetId),
        type: link.type,
        bidirectional: link.bidirectional,
      }))
      .filter((link) => link.sourceSlug && link.targetSlug);

    // Transform pinned entries to use chat IDs and slugs
    const pinnedByChat = new Map<string, string[]>();
    for (const pinned of pinnedEntries) {
      const chatId = pinned.chatId;
      const slug = pinned.archiveEntry.slug;
      if (!pinnedByChat.has(chatId)) {
        pinnedByChat.set(chatId, []);
      }
      pinnedByChat.get(chatId)!.push(slug);
    }

    // Transform chats to include pinned entries
    const transformedChats = chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      visibility: chat.visibility,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      settings: chat.settings,
      agentId: chat.agentId,
      rootMessageIndex: chat.rootMessageIndex,
      pinnedArchiveEntrySlugs: pinnedByChat.get(chat.id) || [],
      messages: chat.messages.map((msg) => ({
        id: msg.id,
        role: msg.role,
        parts: msg.parts,
        attachments: msg.attachments,
        createdAt:
          msg.createdAt instanceof Date
            ? msg.createdAt.toISOString()
            : msg.createdAt,
        model: msg.model,
        pathText: msg.pathText,
        selectedChildIndex: msg.selectedChildIndex,
      })),
    }));

    // Transform archive entries
    const transformedArchiveEntries = archiveEntries.map((entry) => ({
      slug: entry.slug,
      entity: entry.entity,
      body: entry.body,
      tags: entry.tags,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    }));

    // Transform agents
    const transformedAgents = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      settings: agent.settings,
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    }));

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      preferences: user?.preferences as UserPreferences | null,
      chats: transformedChats,
      archive: {
        entries: transformedArchiveEntries,
        links: transformedLinks,
      },
      agents: transformedAgents,
    };

    return NextResponse.json(exportData);
  } catch (error) {
    console.error('[USER_DATA_EXPORT]', error);
    return NextResponse.json(
      { error: 'Failed to export user data' },
      { status: 500 }
    );
  }
}

// Import user data
export async function POST(req: NextRequest) {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return new ChatSDKError(
        'unauthorized:api',
        'Not authenticated'
      ).toResponse();
    }

    const userId = session.user.id;
    const body = await req.json();

    // Validate import data structure
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid import data format' },
        { status: 400 }
      );
    }

    const { version, preferences, chats, archive, agents, mode } = body;

    if (version !== 1) {
      return NextResponse.json(
        { error: 'Unsupported export version' },
        { status: 400 }
      );
    }

    // mode can be 'merge' (default) or 'replace'
    const importMode = mode === 'replace' ? 'replace' : 'merge';

    const results = {
      preferences: false,
      chats: { imported: 0, skipped: 0 },
      archive: { entries: 0, links: 0 },
      agents: { imported: 0, skipped: 0 },
    };

    // Import in a transaction for consistency
    await prisma.$transaction(
      async (tx) => {
        // 1. Import preferences
        if (preferences && typeof preferences === 'object') {
          await tx.user.update({
            where: { id: userId },
            data: { preferences },
          });
          results.preferences = true;
        }

        // 2. Import agents first (chats may reference them)
        const agentIdMap = new Map<string, string>(); // old ID -> new ID
        if (Array.isArray(agents)) {
          for (const agent of agents) {
            if (!agent.name) continue;

            // Check if agent with same name exists
            const existing = await tx.agent.findFirst({
              where: { userId, name: agent.name },
            });

            if (existing) {
              agentIdMap.set(agent.id, existing.id);
              if (importMode === 'replace') {
                await tx.agent.update({
                  where: { id: existing.id },
                  data: {
                    description: agent.description || null,
                    settings: agent.settings || {},
                    updatedAt: new Date(),
                  },
                });
                results.agents.imported++;
              } else {
                results.agents.skipped++;
              }
            } else {
              const created = await tx.agent.create({
                data: {
                  userId,
                  name: agent.name,
                  description: agent.description || null,
                  settings: agent.settings || {},
                  createdAt: agent.createdAt
                    ? new Date(agent.createdAt)
                    : new Date(),
                  updatedAt: agent.updatedAt
                    ? new Date(agent.updatedAt)
                    : new Date(),
                },
              });
              agentIdMap.set(agent.id, created.id);
              results.agents.imported++;
            }
          }
        }

        // 3. Import archive entries
        const archiveSlugToId = new Map<string, string>();
        if (archive?.entries && Array.isArray(archive.entries)) {
          for (const entry of archive.entries) {
            if (!entry.slug || !entry.entity) continue;

            const existing = await tx.archiveEntry.findUnique({
              where: { userId_slug: { userId, slug: entry.slug } },
            });

            if (existing) {
              archiveSlugToId.set(entry.slug, existing.id);
              if (importMode === 'replace') {
                await tx.archiveEntry.update({
                  where: { id: existing.id },
                  data: {
                    entity: entry.entity,
                    body: entry.body || '',
                    tags: Array.isArray(entry.tags) ? entry.tags : [],
                    updatedAt: new Date(),
                  },
                });
                results.archive.entries++;
              }
            } else {
              const created = await tx.archiveEntry.create({
                data: {
                  userId,
                  slug: entry.slug,
                  entity: entry.entity,
                  body: entry.body || '',
                  tags: Array.isArray(entry.tags) ? entry.tags : [],
                  createdAt: entry.createdAt
                    ? new Date(entry.createdAt)
                    : new Date(),
                  updatedAt: entry.updatedAt
                    ? new Date(entry.updatedAt)
                    : new Date(),
                },
              });
              archiveSlugToId.set(entry.slug, created.id);
              results.archive.entries++;
            }
          }

          // 4. Import archive links
          if (archive.links && Array.isArray(archive.links)) {
            for (const link of archive.links) {
              if (!link.sourceSlug || !link.targetSlug || !link.type) continue;

              const sourceId = archiveSlugToId.get(link.sourceSlug);
              const targetId = archiveSlugToId.get(link.targetSlug);

              if (!sourceId || !targetId) continue;

              // Check if link already exists
              const existing = await tx.archiveLink.findFirst({
                where: {
                  OR: [
                    { sourceId, targetId, type: link.type },
                    link.bidirectional
                      ? {
                          sourceId: targetId,
                          targetId: sourceId,
                          type: link.type,
                        }
                      : { id: '__skip__' },
                  ],
                },
              });

              if (!existing) {
                await tx.archiveLink.create({
                  data: {
                    sourceId,
                    targetId,
                    type: link.type,
                    bidirectional: link.bidirectional ?? true,
                  },
                });
                results.archive.links++;
              }
            }
          }
        }

        // 5. Import chats with messages
        if (Array.isArray(chats)) {
          for (const chat of chats) {
            if (!chat.id || !chat.title) continue;

            // Check if chat already exists
            const existing = await tx.chat.findUnique({
              where: { id: chat.id },
            });

            if (existing) {
              if (importMode === 'replace' && existing.userId === userId) {
                // Delete existing messages and re-import
                await tx.message.deleteMany({ where: { chatId: chat.id } });

                // Update chat
                await tx.chat.update({
                  where: { id: chat.id },
                  data: {
                    title: chat.title,
                    visibility: chat.visibility || 'private',
                    settings: chat.settings || {},
                    agentId: chat.agentId
                      ? (agentIdMap.get(chat.agentId) ?? chat.agentId)
                      : null,
                    rootMessageIndex: chat.rootMessageIndex ?? 0,
                    updatedAt: new Date(),
                  },
                });

                // Re-import messages
                if (Array.isArray(chat.messages)) {
                  for (const msg of chat.messages) {
                    const pathText = msg.pathText || null;
                    await tx.$executeRaw(
                      PrismaRuntime.sql`
                        INSERT INTO "Message"
                          ("id", "chatId", "role", "parts", "attachments", "createdAt", "model", "path", "path_text", "selectedChildIndex")
                        VALUES (
                          ${msg.id}::uuid,
                          ${chat.id}::uuid,
                          ${msg.role},
                          ${JSON.stringify(msg.parts || [])}::jsonb,
                          ${JSON.stringify(msg.attachments || [])}::jsonb,
                          ${msg.createdAt ? new Date(msg.createdAt) : new Date()},
                          ${msg.model || null},
                          ${pathText ? PrismaRuntime.sql`${pathText}::ltree` : PrismaRuntime.sql`NULL`},
                          ${pathText},
                          ${msg.selectedChildIndex ?? 0}
                        )
                        ON CONFLICT ("id") DO NOTHING
                      `
                    );
                  }
                }

                results.chats.imported++;
              } else {
                results.chats.skipped++;
              }
            } else {
              // Create new chat
              await tx.chat.create({
                data: {
                  id: chat.id,
                  userId,
                  title: chat.title,
                  visibility: chat.visibility || 'private',
                  settings: chat.settings || {},
                  agentId: chat.agentId
                    ? (agentIdMap.get(chat.agentId) ?? null)
                    : null,
                  rootMessageIndex: chat.rootMessageIndex ?? 0,
                  createdAt: chat.createdAt
                    ? new Date(chat.createdAt)
                    : new Date(),
                  updatedAt: chat.updatedAt
                    ? new Date(chat.updatedAt)
                    : new Date(),
                },
              });

              // Import messages
              if (Array.isArray(chat.messages)) {
                for (const msg of chat.messages) {
                  const pathText = msg.pathText || null;
                  await tx.$executeRaw(
                    PrismaRuntime.sql`
                      INSERT INTO "Message"
                        ("id", "chatId", "role", "parts", "attachments", "createdAt", "model", "path", "path_text", "selectedChildIndex")
                      VALUES (
                        ${msg.id}::uuid,
                        ${chat.id}::uuid,
                        ${msg.role},
                        ${JSON.stringify(msg.parts || [])}::jsonb,
                        ${JSON.stringify(msg.attachments || [])}::jsonb,
                        ${msg.createdAt ? new Date(msg.createdAt) : new Date()},
                        ${msg.model || null},
                        ${pathText ? PrismaRuntime.sql`${pathText}::ltree` : PrismaRuntime.sql`NULL`},
                        ${pathText},
                        ${msg.selectedChildIndex ?? 0}
                      )
                      ON CONFLICT ("id") DO NOTHING
                    `
                  );
                }
              }

              // Import pinned archive entries for this chat
              if (Array.isArray(chat.pinnedArchiveEntrySlugs)) {
                for (const slug of chat.pinnedArchiveEntrySlugs) {
                  const archiveId = archiveSlugToId.get(slug);
                  if (archiveId) {
                    const existingPin =
                      await tx.chatPinnedArchiveEntry.findFirst({
                        where: { chatId: chat.id, archiveEntryId: archiveId },
                      });
                    if (!existingPin) {
                      await tx.chatPinnedArchiveEntry.create({
                        data: {
                          chatId: chat.id,
                          archiveEntryId: archiveId,
                          userId,
                        },
                      });
                    }
                  }
                }
              }

              results.chats.imported++;
            }
          }
        }
      },
      {
        timeout: 120000, // 2 minute timeout for large imports
      }
    );

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('[USER_DATA_IMPORT]', error);
    return NextResponse.json(
      { error: 'Failed to import user data' },
      { status: 500 }
    );
  }
}
