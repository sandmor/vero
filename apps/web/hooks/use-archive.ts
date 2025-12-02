'use client';

import {
  useInfiniteQuery,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

export type ArchiveListEntry = {
  slug: string;
  entity: string;
  tags: string[];
  bodyPreview: string;
  createdAt: string;
  updatedAt: string;
  linkCount: number;
  cursor: string;
};

export type ArchiveListResponse = {
  entries: ArchiveListEntry[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function useArchiveSearch(params: { q?: string; tags?: string[] }) {
  const { q, tags } = params;
  return useInfiniteQuery<
    ArchiveListResponse,
    Error,
    ArchiveListResponse,
    any[],
    string | undefined
  >({
    queryKey: ['archive', 'search', { q, tags }],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (tags && tags.length) sp.set('tags', tags.join(','));
      if (pageParam) sp.set('cursor', pageParam as string);
      sp.set('limit', '20');
      const res = await fetch(`/api/archive/search?${sp.toString()}`);
      if (!res.ok) throw new Error('Failed to load archive entries');
      return res.json();
    },
    getNextPageParam: (last) =>
      last.hasMore ? last.nextCursor || undefined : undefined,
    staleTime: 30_000,
  });
}

export type ArchiveEntryDetail = {
  slug: string;
  entity: string;
  tags: string[];
  body: string;
  createdAt: string;
  updatedAt: string;
  links: { otherSlug: string; type: string; direction: string }[];
};

export function useArchiveEntry(slug: string | undefined) {
  return useQuery<ArchiveEntryDetail | null>({
    queryKey: ['archive', 'entry', slug],
    enabled: !!slug,
    queryFn: async () => {
      if (!slug) return null;
      const res = await fetch(
        `/api/archive/entry?slug=${encodeURIComponent(slug)}`
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load entry');
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useCreateArchiveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      entity: string;
      body?: string;
      tags?: string[];
    }) => {
      const res = await fetch('/api/archive/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to create entry');
      return res.json() as Promise<{ slug: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive', 'search'] });
    },
  });
}

export function useUpdateArchiveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      slug: string;
      entity?: string;
      body?: string;
      addTags?: string[];
      removeTags?: string[];
    }) => {
      const res = await fetch('/api/archive/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to update entry');
      return res.json() as Promise<{ slug: string }>;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['archive', 'entry', vars.slug] });
      qc.invalidateQueries({ queryKey: ['archive', 'search'] });
    },
  });
}

export function useDeleteArchiveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slug: string }) => {
      const res = await fetch('/api/archive/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to delete entry');
      return res.json() as Promise<{ deleted: boolean }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive', 'search'] });
    },
  });
}

export function useDeleteArchiveEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { slugs: string[] }) => {
      const res = await fetch('/api/archive/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to delete entries');
      return res.json() as Promise<{ deleted: string[]; removedLinks: number }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive', 'search'] });
    },
  });
}

export function useLinkArchiveEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceSlug: string;
      targetSlug: string;
      type: string;
      bidirectional?: boolean;
    }) => {
      const res = await fetch('/api/archive/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to link entries');
      return res.json();
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['archive', 'entry', v.sourceSlug] });
      qc.invalidateQueries({ queryKey: ['archive', 'entry', v.targetSlug] });
    },
  });
}

export function useUnlinkArchiveEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      sourceSlug: string;
      targetSlug: string;
      type: string;
    }) => {
      const res = await fetch('/api/archive/unlink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to unlink entries');
      return res.json();
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['archive', 'entry', v.sourceSlug] });
      qc.invalidateQueries({ queryKey: ['archive', 'entry', v.targetSlug] });
    },
  });
}

export function useArchiveSlugSuggestions(query: string | undefined) {
  return useQuery<{ slug: string; entity: string; tags: string[] }[]>({
    queryKey: ['archive', 'slug-suggest', query],
    enabled: !!query && query.length >= 2,
    queryFn: async () => {
      if (!query) return [];
      const params = new URLSearchParams({ q: query, limit: '8' });
      const res = await fetch(`/api/archive/search?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.entries || []).map((e: any) => ({
        slug: e.slug,
        entity: e.entity,
        tags: e.tags,
      }));
    },
    staleTime: 15_000,
  });
}

// ----- Pinned archive entries for a chat -----
export type PinnedArchiveEntry = {
  slug: string;
  entity: string;
  tags: string[];
  updatedAt: string;
  pinnedAt: string;
  bodyPreview?: string;
};

export function usePinnedArchiveEntries(chatId: string | undefined) {
  return useQuery<PinnedArchiveEntry[]>({
    queryKey: ['archive', 'pinned', chatId],
    enabled: !!chatId,
    queryFn: async () => {
      if (!chatId) return [];
      const res = await fetch(
        `/api/archive/pinned?chatId=${encodeURIComponent(chatId)}`
      );
      if (!res.ok) throw new Error('Failed to load pinned entries');
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function usePinArchiveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { chatId: string; slug: string }) => {
      const res = await fetch('/api/archive/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to pin entry');
      return res.json();
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['archive', 'pinned', v.chatId] });
    },
  });
}

export function useUnpinArchiveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { chatId: string; slug: string }) => {
      const res = await fetch('/api/archive/unpin-from-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('Failed to unpin entry');
      return res.json();
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['archive', 'pinned', v.chatId] });
    },
  });
}
