import { prisma } from '@/lib/db/prisma';
import { SettingsEditor } from '@/components/admin/settings-editor';

export const dynamic = 'force-dynamic';

export default async function SettingsSection() {
  const rows = await prisma.setting.findMany({ orderBy: { id: 'asc' } });
  const initialSettings: Record<string, string> = {};
  for (const row of rows) {
    initialSettings[row.id] = row.value;
  }
  return (
    <section className="space-y-5 rounded-3xl border border-border/60 bg-muted/10 p-6 shadow-sm backdrop-blur-sm">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Application Settings</h2>
        <p className="text-xs text-muted-foreground">
          Configure global application settings and limits.
        </p>
      </div>
      <SettingsEditor initialSettings={initialSettings} />
    </section>
  );
}
