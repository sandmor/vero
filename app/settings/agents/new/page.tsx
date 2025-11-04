import { redirect } from 'next/navigation';
import AgentEditor from '@/components/agent-editor';
import { getAppSession } from '@/lib/auth/session';
import { getTierForUserType } from '@/lib/ai/tiers';
import { resolveChatModelOptions } from '@/lib/ai/models.server';
import { getUserByokConfig } from '@/lib/queries/user-keys';

export default async function NewAgentPage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect('/login');
  }

  const { modelIds: tierModelIds } = await getTierForUserType(
    session.user.type
  );
  const byokConfig = await getUserByokConfig(session.user.id);
  const allowedModels = await resolveChatModelOptions(tierModelIds, {
    extraModelIds: byokConfig.modelIds,
    highlightIds: byokConfig.modelIds,
  });

  return <AgentEditor mode="create" allowedModels={allowedModels} />;
}
