'use server';

import { z } from 'zod';
import { clerkClient } from '@clerk/nextjs/server';
import { prisma } from '@/lib/db/prisma';
import { getUser } from '@/lib/db/queries';

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: 'idle' | 'in_progress' | 'success' | 'failed' | 'invalid_data';
};

async function ensureDbUser(clerkUserId: string, email: string) {
  // We store DB user id == clerkUserId for simplicity / referential integrity.
  await prisma.user.upsert({
    where: { id: clerkUserId },
    update: { email },
    create: { id: clerkUserId, email },
  });
}

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    // For server action based auth without Clerk's frontend SDK we would need to implement a token issuance flow.
    // Temporarily short-circuit to failed until client-side Clerk sign-in component is integrated.
    return { status: 'failed' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }
    return { status: 'failed' };
  }
};

export type RegisterActionState = {
  status:
    | 'idle'
    | 'in_progress'
    | 'success'
    | 'failed'
    | 'user_exists'
    | 'invalid_data';
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get('email'),
      password: formData.get('password'),
    });

    const [existing] = await getUser(validatedData.email);
    if (existing) {
      return { status: 'user_exists' };
    }

    // clerkClient is now async in newer Clerk versions (returns a function you invoke to get the client)
    const cc = await clerkClient();
    const user = await cc.users.createUser({
      emailAddress: [validatedData.email],
      password: validatedData.password,
    });

    await ensureDbUser(user.id, validatedData.email);
    return { status: 'success' };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 'invalid_data' };
    }
    return { status: 'failed' };
  }
};
