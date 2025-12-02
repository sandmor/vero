import { Suspense } from 'react';
import ProvidersSection from './_providers-section';
import TiersSection from './_tiers-section';
import ModelCapabilitiesSection from './_model-capabilities-section';
import SettingsSection from './_settings-section';

export default function AdminSections() {
  return (
    <div className="space-y-10 px-2 py-6 max-w-5xl mx-auto w-full animate-in fade-in-0 slide-in-from-bottom-4">
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm animate-pulse">
            <p className="text-sm text-muted-foreground">Loading providers…</p>
          </div>
        }
      >
        <ProvidersSection />
      </Suspense>
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm animate-pulse">
            <p className="text-sm text-muted-foreground">
              Loading model capabilities…
            </p>
          </div>
        }
      >
        <ModelCapabilitiesSection />
      </Suspense>
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm animate-pulse">
            <p className="text-sm text-muted-foreground">Loading tiers…</p>
          </div>
        }
      >
        <TiersSection />
      </Suspense>
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm animate-pulse">
            <p className="text-sm text-muted-foreground">Loading settings…</p>
          </div>
        }
      >
        <SettingsSection />
      </Suspense>
    </div>
  );
}
