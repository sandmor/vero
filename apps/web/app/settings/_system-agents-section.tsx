import { getSystemAgents } from '@/lib/db/queries';
import { SystemAgentsEditor } from '@/components/admin/system-agents-editor';

export const dynamic = 'force-dynamic';

export default async function SystemAgentsSection() {
  const agents = await getSystemAgents();

  return (
    <section className="space-y-5 rounded-3xl border border-border/40 bg-card/50 p-6 shadow-sm backdrop-blur-sm">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">System Agents</h2>
        <p className="text-[11px] text-muted-foreground/80">
          Platform-level AI agents that perform special tasks like title
          generation. Customize their prompts and models, or reset to defaults.
        </p>
      </div>
      <SystemAgentsEditor initialAgents={agents} />
    </section>
  );
}
