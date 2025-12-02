import { prisma } from '@/lib/db/prisma';
import { SUPPORTED_PROVIDERS } from '@/lib/ai/registry';
import { ProvidersEditor } from '@/components/admin/providers-editor';

export const dynamic = 'force-dynamic';

export default async function ProvidersSection() {
  const rows = await prisma.provider.findMany({ orderBy: { id: 'asc' } });
  const initialKeys: Record<string, string | undefined> = {};
  for (const p of SUPPORTED_PROVIDERS) {
    initialKeys[p] = rows.find((r) => r.id === p)?.apiKey;
  }
  return (
    <section className="space-y-5 rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm backdrop-blur-sm">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Providers</h2>
        <p className="text-xs text-muted-foreground">
          Override or rotate credentials for any downstream model provider.
        </p>
      </div>
      <ProvidersEditor initialKeys={initialKeys} />
    </section>
  );
}
