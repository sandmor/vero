import { prisma } from '@vero/db';
import { getAllProviders } from '@/lib/ai/registry';
import { ProvidersEditor } from '@/components/admin/providers-editor';

export const dynamic = 'force-dynamic';

// Get all providers for key lookup
const providers = getAllProviders();

export default async function ProvidersSection() {
  const rows = await prisma.provider.findMany({ orderBy: { id: 'asc' } });
  const initialKeys: Record<string, string | undefined> = {};
  for (const p of providers) {
    initialKeys[p.id] = rows.find((r) => r.id === p.id)?.apiKey;
  }
  return (
    <section className="space-y-5 rounded-3xl border border-border/40 bg-card/50 p-6 shadow-sm backdrop-blur-sm">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Providers</h2>
        <p className="text-[11px] text-muted-foreground/80">
          Override or rotate credentials for any downstream model provider.
        </p>
      </div>
      <ProvidersEditor initialKeys={initialKeys} />
    </section>
  );
}
