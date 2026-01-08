import { prisma } from '@virid/db';

/**
 * Migrates all data owned by a guest user to a regular user.
 * Performed atomically within a transaction.
 *
 * Strategy:
 * 1. Move simple entities (Chats, Agents, TokenUsage, Tombstones)
 * 2. Merge unique-constrained entities (ArchiveEntry, Providers, BYOK):
 *    - Conflict: Delete guest version (target user's data takes precedence)
 *    - No conflict: Move guest version to target user
 * 3. Delete guest user record
 *
 * @param guestId Temporary guest user ID (UUID)
 * @param targetUserId Persistent regular user ID (Clerk ID)
 */
export async function migrateGuestData(
  guestId: string,
  targetUserId: string
): Promise<void> {
  if (guestId === targetUserId) return;

  await prisma.$transaction(async (tx) => {
    // 1. CHATS
    await tx.chat.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });

    // 2. AGENTS
    await tx.agent.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });

    // 3. ARCHIVE ENTRIES - @@unique([userId, slug])
    // Handle conflicts: target user's existing slugs take precedence
    const guestEntries = await tx.archiveEntry.findMany({
      where: { userId: guestId },
      select: { id: true, slug: true },
    });

    if (guestEntries.length > 0) {
      const existingUserSlugs = await tx.archiveEntry.findMany({
        where: {
          userId: targetUserId,
          slug: { in: guestEntries.map((e) => e.slug) },
        },
        select: { slug: true },
      });
      const existingSlugSet = new Set(existingUserSlugs.map((e) => e.slug));

      const conflictingIds: string[] = [];
      const safeToMoveIds: string[] = [];

      for (const e of guestEntries) {
        if (existingSlugSet.has(e.slug)) {
          conflictingIds.push(e.id);
        } else {
          safeToMoveIds.push(e.id);
        }
      }

      if (conflictingIds.length > 0) {
        await tx.archiveEntry.deleteMany({
          where: { id: { in: conflictingIds } },
        });
      }

      if (safeToMoveIds.length > 0) {
        await tx.archiveEntry.updateMany({
          where: { id: { in: safeToMoveIds } },
          data: { userId: targetUserId },
        });
      }
    }

    // 4. CHAT PINNED ARCHIVE ENTRIES - @@unique([chatId, archiveEntryId])
    // Orphaned pins cascade-deleted in step 3
    await tx.chatPinnedArchiveEntry.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });

    // 5. TOKEN USAGE
    await tx.tokenUsage.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });

    // 6. TOMBSTONES
    await tx.chatDeletion.updateMany({
      where: { userId: guestId },
      data: { userId: targetUserId },
    });

    // 7. USER PROVIDER KEYS - @@unique([userId, providerId])
    const guestKeys = await tx.userProviderKey.findMany({
      where: { userId: guestId },
      select: { id: true, providerId: true },
    });

    if (guestKeys.length > 0) {
      const existingKeys = await tx.userProviderKey.findMany({
        where: {
          userId: targetUserId,
          providerId: { in: guestKeys.map((k) => k.providerId) },
        },
        select: { providerId: true },
      });
      const existingKeySet = new Set(existingKeys.map((k) => k.providerId));

      const conflictingIds: string[] = [];
      const safeToMoveIds: string[] = [];

      for (const k of guestKeys) {
        if (existingKeySet.has(k.providerId)) {
          conflictingIds.push(k.id);
        } else {
          safeToMoveIds.push(k.id);
        }
      }

      if (conflictingIds.length > 0) {
        await tx.userProviderKey.deleteMany({
          where: { id: { in: conflictingIds } },
        });
      }

      if (safeToMoveIds.length > 0) {
        await tx.userProviderKey.updateMany({
          where: { id: { in: safeToMoveIds } },
          data: { userId: targetUserId },
        });
      }
    }

    // 8. CUSTOM PROVIDERS - @@unique([userId, slug])
    const guestCustomProviders = await tx.userCustomProvider.findMany({
      where: { userId: guestId },
      select: { id: true, slug: true },
    });

    if (guestCustomProviders.length > 0) {
      const existingCPs = await tx.userCustomProvider.findMany({
        where: {
          userId: targetUserId,
          slug: { in: guestCustomProviders.map((p) => p.slug) },
        },
        select: { slug: true },
      });
      const existingCPSet = new Set(existingCPs.map((p) => p.slug));

      const conflictingIds: string[] = [];
      const safeToMoveIds: string[] = [];

      for (const p of guestCustomProviders) {
        if (existingCPSet.has(p.slug)) {
          conflictingIds.push(p.id);
        } else {
          safeToMoveIds.push(p.id);
        }
      }

      if (conflictingIds.length > 0) {
        await tx.userCustomProvider.deleteMany({
          where: { id: { in: conflictingIds } },
        });
      }

      if (safeToMoveIds.length > 0) {
        await tx.userCustomProvider.updateMany({
          where: { id: { in: safeToMoveIds } },
          data: { userId: targetUserId },
        });
      }
    }

    // 9. BYOK MODELS - @@unique([userId, sourceType, providerId, customProviderId, providerModelId])
    const guestByok = await tx.userByokModel.findMany({
      where: { userId: guestId },
    });

    if (guestByok.length > 0) {
      for (const model of guestByok) {
        const existing = await tx.userByokModel.findFirst({
          where: {
            userId: targetUserId,
            sourceType: model.sourceType,
            providerId: model.providerId,
            customProviderId: model.customProviderId,
            providerModelId: model.providerModelId,
          },
          select: { id: true },
        });

        if (existing) {
          await tx.userByokModel.delete({ where: { id: model.id } });
        } else {
          await tx.userByokModel.update({
            where: { id: model.id },
            data: { userId: targetUserId },
          });
        }
      }
    }

    // 10. RATE LIMITS
    await tx.userRateLimit.deleteMany({
      where: { userId: guestId },
    });

    // 11. DELETE GUEST USER
    await tx.user.delete({
      where: { id: guestId },
    });
  });
}