import { redirect } from 'next/navigation';
import { getAppSession } from '@/lib/auth/session';

export default async function NewAgentRedirectPage() {
  const session = await getAppSession();
  if (!session?.user) {
    redirect('/login');
  }

  // Redirect to settings with create agent view
  redirect('/settings?tab=agents&agentView=create');
}
