import { tool } from 'ai';
import { z } from 'zod';
import type { AppSession } from '@/lib/auth/session';
import {
  createArchiveEntry,
  updateArchiveEntry,
  deleteArchiveEntry,
  linkArchiveEntries,
  unlinkArchiveEntries,
  getArchiveEntryBySlug,
} from '@/lib/db/queries';
import { normalizeTags } from '@/lib/archive/utils';

type Edit = {
  mode: 'replace' | 'insertAfter' | 'insertBefore' | 'remove';
  target: string;
  text?: string;
  occurrences?: 'first' | 'all';
};

function applyEdits(body: string, edits: Edit[]) {
  let current = body;
  edits.forEach((e) => {
    const replacement = e.mode === 'replace' ? (e.text ?? '') : '';
    if (e.mode === 'remove' || e.mode === 'replace') {
      current = current.split(e.target).join(replacement);
    } else if (e.mode === 'insertAfter') {
      current = current.split(e.target).join(e.target + (e.text ?? ''));
    } else if (e.mode === 'insertBefore') {
      current = current.split(e.target).join((e.text ?? '') + e.target);
    }
  });
  return current;
}

export const writeArchive = ({ session }: { session: AppSession }) =>
  tool({
    description: 'Create, update, delete, or link archive entries.',
    inputSchema: z.object({
      slug: z.string().optional(),
      entity: z.string().optional(),
      body: z.string().optional(),
      append_body: z.string().optional(),
      add_tags: z.array(z.string()).optional(),
      remove_tags: z.array(z.string()).optional(),
      deleted: z.boolean().optional(),
      link: z
        .object({
          source_slug: z.string(),
          target_slug: z.string(),
          type: z.string().optional(),
          bidirectional: z.boolean().optional(),
        })
        .optional(),
      unlink: z
        .object({
          source_slug: z.string(),
          target_slug: z.string(),
          type: z.string().optional(),
        })
        .optional(),
      edits: z
        .array(
          z.object({
            mode: z.enum(['replace', 'insertAfter', 'insertBefore', 'remove']),
            target: z.string(),
            text: z.string().optional(),
            occurrences: z.enum(['first', 'all']).optional(),
          })
        )
        .optional(),
    }),
    execute: async (args) => {
      if (!session.user?.id) {
        return { error: 'No active user session' };
      }
      const userId = session.user.id;
      const {
        slug,
        entity,
        body,
        append_body,
        add_tags,
        remove_tags,
        deleted,
        link,
        unlink,
        edits,
      } = args;

      if (deleted) {
        if (!slug) return { error: 'Slug is required to delete an entry.' };
        const res = await deleteArchiveEntry({ userId, slug });
        if (!res.deleted) return { error: 'Entry not found' };
        return { slug, deleted: true, removedLinks: res.removedLinks };
      }

      if (link) {
        const { source_slug, target_slug, type, bidirectional } = link;
        try {
          const res = await linkArchiveEntries({
            userId,
            sourceSlug: source_slug,
            targetSlug: target_slug,
            type: type ?? 'related',
            bidirectional: bidirectional ?? true,
          });
          return { source_slug, target_slug, ...res };
        } catch (e: any) {
          return { error: e?.message || 'Failed to link entries' };
        }
      }

      if (unlink) {
        const { source_slug, target_slug, type } = unlink;
        try {
          const res = await unlinkArchiveEntries({
            userId,
            sourceSlug: source_slug,
            targetSlug: target_slug,
            type: type ?? 'related',
          });
          return { source_slug, target_slug, ...res };
        } catch (e: any) {
          return { error: e?.message || 'Failed to unlink entries' };
        }
      }

      if (slug) {
        // Update
        let finalBody = body;
        if (edits) {
          const entry = await getArchiveEntryBySlug({ userId, slug });
          if (!entry) return { error: 'Entry not found' };
          finalBody = applyEdits(entry.body, edits);
        }

        const result = await updateArchiveEntry({
          userId,
          slug,
          newEntity: entity,
          addTags: add_tags,
          removeTags: remove_tags,
          body: finalBody,
          appendBody: append_body,
        });
        if (!result) return { error: 'Entry not found' };
        const updated = await getArchiveEntryBySlug({ userId, slug });
        return updated;
      }

      if (entity) {
        // Create
        const { entry, adjusted, base } = await createArchiveEntry({
          userId,
          entity,
          slug,
          body,
          tags: add_tags,
        });
        return {
          slug: entry.slug,
          entity: entry.entity,
          tags: normalizeTags(entry.tags),
          body: entry.body || undefined,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          note: adjusted
            ? `Slug '${base}' was taken. Used '${entry.slug}'.`
            : undefined,
        };
      }

      return {
        error:
          'Invalid set of arguments. Please provide enough information to perform an action.',
      };
    },
  });
