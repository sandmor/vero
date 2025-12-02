import { getAppSession } from './session';
import { adminEmail, adminUserId } from '@/lib/constants';

export async function requireAdmin(): Promise<
  ReturnType<typeof getAppSession>
> {
  const session = await getAppSession();
  const isIdMatch = !!adminUserId && session?.user.id === adminUserId;
  const isEmailMatch =
    !!adminEmail &&
    !!session?.user.email &&
    session.user.email.toLowerCase() === adminEmail.toLowerCase();
  if (!session || !(isIdMatch || isEmailMatch)) {
    throw new Error('Not authorized');
  }
  return session;
}

export async function isAdmin(): Promise<boolean> {
  const session = await getAppSession();
  if (!session) return false;
  if (adminUserId && session.user.id === adminUserId) return true;
  const email = session.user.email?.toLowerCase();
  return !!email && !!adminEmail && email === adminEmail.toLowerCase();
}
