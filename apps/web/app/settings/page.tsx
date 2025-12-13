import { Metadata } from 'next';
import { getAppSession } from '@/lib/auth/session';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { HydrationBoundary } from '@tanstack/react-query';
import { isAdmin } from '@/lib/auth/admin';
import SettingsView from './view';
import AdminSections from './AdminSections';
import { SettingsMobileNav } from './_mobile-nav';
import { SettingsStoreInitializer } from './_store-initializer';
import SettingsHeader from '@/components/settings-header';

export const metadata: Metadata = {
  title: 'Account Settings',
};

async function prefetchArchive() {
  const qc = new QueryClient();
  await qc.prefetchInfiniteQuery({
    queryKey: ['archive', 'search', { q: undefined, tags: undefined }],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/archive/search?limit=20`,
        { cache: 'no-store' }
      );
      if (!res.ok) return { entries: [], hasMore: false, nextCursor: null };
      return res.json();
    },
    initialPageParam: undefined,
  });
  return dehydrate(qc);
}

// Server helper to prefetch agents list when agents tab is active.
async function prefetchAgents() {
  const qc = new QueryClient();
  await qc.prefetchQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/agents`,
        { cache: 'no-store' }
      );
      if (!res.ok) return { agents: [] };
      return res.json();
    },
  });
  return dehydrate(qc);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getAppSession();
  if (!session?.user) redirect('/login');
  const params = await searchParams;
  const tabParam = typeof params?.tab === 'string' ? params.tab : undefined;
  const adminAllowed = await isAdmin();
  const defaultTab =
    tabParam === 'admin' && adminAllowed
      ? 'admin'
      : tabParam === 'agents'
        ? 'agents'
        : tabParam === 'archive'
          ? 'archive'
          : 'preferences';

  const dehydrated =
    defaultTab === 'archive'
      ? await prefetchArchive()
      : defaultTab === 'agents'
        ? await prefetchAgents()
        : undefined;
  const adminContent = adminAllowed ? <AdminSections /> : null;

  return (
    <div className="min-h-screen bg-muted/5">
      <SettingsStoreInitializer defaultTab={defaultTab as any} />

      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40">
        <div className="px-6 pt-6 pb-4">
          <SettingsHeader
            title="Account Settings"
            subtitle="Manage your knowledge archive, AI agents, API keys, and personal preferences."
          />
        </div>
        <SettingsMobileNav isAdmin={adminAllowed} />
      </header>

      {/* Spacer for fixed header */}
      <div className="h-[200px] md:h-[130px] w-full" aria-hidden="true" />

      <div className="w-full px-4 pb-8 md:px-6 lg:px-8">
        <HydrationBoundary state={dehydrated}>
          <Suspense fallback={<div className="flex-1 rounded-md border" />}>
            <SettingsView isAdmin={adminAllowed} adminContent={adminContent} />
          </Suspense>
        </HydrationBoundary>
      </div>
    </div>
  );
}
