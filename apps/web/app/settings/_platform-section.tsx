'use client';

import { PlatformProvidersManager } from '@/components/admin/platform-providers-manager';
import { PlatformModelsManager } from '@/components/admin/platform-models-manager';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function PlatformSection() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <section className="space-y-6 rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm backdrop-blur-sm">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">
            Custom Platform Providers & Models
          </h2>
          <p className="text-muted-foreground">
            Define custom OpenAI-compatible providers and models that appear as
            standard platform models to all users.
          </p>
        </div>
        <div className="space-y-6">
          <PlatformProvidersManager />
          <PlatformModelsManager />
        </div>
      </section>
    </QueryClientProvider>
  );
}
