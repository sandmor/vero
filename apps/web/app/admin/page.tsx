import { Metadata } from 'next';
import { requireAdmin } from '@/lib/auth/admin';
import SettingsHeader from '@/components/settings-header';
import { UsageDashboard } from '@/components/admin/usage-dashboard';
import { AdminBackButton } from '@/components/admin/admin-back-button';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Settings, BarChart3 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Admin Dashboard | Usage Analytics',
  description:
    'Monitor token usage, costs, and system performance across all users and models.',
};

export default async function AdminPage() {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-background">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="px-4 md:px-6 lg:px-8 py-4 max-w-[1800px] mx-auto">
          <div className="flex flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Usage Analytics
                </h1>
                <p className="text-sm text-muted-foreground">
                  Monitor token usage, costs, and performance
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ButtonWithFeedback asChild variant="outline" size="sm">
                <Link href="/settings?tab=admin">
                  <Settings className="mr-2 h-4 w-4" />
                  Configuration
                </Link>
              </ButtonWithFeedback>
              <AdminBackButton />
            </div>
          </div>
        </div>
      </header>

      {/* Spacer for fixed header */}
      <div className="h-[85px] w-full" aria-hidden="true" />

      {/* Main Content */}
      <main className="w-full px-4 pb-8 md:px-6 lg:px-8 max-w-[1800px] mx-auto">
        <UsageDashboard />
      </main>
    </div>
  );
}
