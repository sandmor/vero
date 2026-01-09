import { prisma } from '@vero/db';
import { ChatSDKError } from '../../errors';
import type { User } from '../schema';

export async function getUser(email: string): Promise<User[]> {
  try {
    return await prisma.user.findMany({ where: { email } });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get user by email'
    );
  }
}
