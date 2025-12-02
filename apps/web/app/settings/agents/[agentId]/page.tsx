import { notFound, redirect } from 'next/navigation';
import AgentEditor, { type AgentEditorAgent } from '@/components/agent-editor';
import { prisma } from '@/lib/db/prisma';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import type { ChatSettings } from '@/lib/db/schema';
import { getUserByokConfig } from '@/lib/queries/user-keys';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await getAppSession();
  if (!session?.user) {
    redirect('/login');
  }

  const { agentId } = await params;
  if (!agentId) {
    notFound();
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId: session.user.id },
  });

  if (!agent) {
    notFound();
  }

  const { modelIds: tierModelIds } = await getTierForUserType(
    session.user.type
  );
  const byokConfig = await getUserByokConfig(session.user.id);
  const allowedModels = await resolveChatModelOptions(tierModelIds, {
    extraModelIds: byokConfig.modelIds,
    highlightIds: byokConfig.modelIds,
  });

  const serializedAgent: AgentEditorAgent = {
    id: agent.id,
    name: agent.name,
    description: agent.description ?? null,
    settings: (agent.settings as ChatSettings | null | undefined) ?? null,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };

  return (
    <AgentEditor
      mode="edit"
      agent={serializedAgent}
      allowedModels={allowedModels}
    />
  );
}
