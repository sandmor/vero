import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/auth/session';

export default async function AgentDetailRedirectPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const session = await getAppSession();
  if (!session?.user) {
    redirect('/login');
  }

  const { agentId } = await params;

  // Redirect to settings with edit agent view
  redirect(`/settings?tab=agents&agentView=edit&agentId=${agentId}`);
}
