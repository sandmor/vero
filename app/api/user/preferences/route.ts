import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '../../../../generated/prisma-client';

export async function GET() {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { preferences: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ preferences: user.preferences });
  } catch (error) {
    console.error('[USER_PREFERENCES_GET]', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, occupation, customInstructions } = body as {
      name?: string;
      occupation?: string;
      customInstructions?: string;
    };

    // Validate input
    if (name && typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name must be a string' },
        { status: 400 }
      );
    }
    if (occupation && typeof occupation !== 'string') {
      return NextResponse.json(
        { error: 'Occupation must be a string' },
        { status: 400 }
      );
    }
    if (customInstructions && typeof customInstructions !== 'string') {
      return NextResponse.json(
        { error: 'Custom instructions must be a string' },
        { status: 400 }
      );
    }

    const preferences = {
      ...(name && { name }),
      ...(occupation && { occupation }),
      ...(customInstructions && { customInstructions }),
    };

    await prisma.user.update({
      where: { id: session.user.id },
      data: { preferences },
    });

    revalidatePath('/settings');
    revalidatePath('/chat/*');

    return NextResponse.json({ ok: true, preferences });
  } catch (error) {
    console.error('[USER_PREFERENCES_POST]', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await getAppSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { preferences: Prisma.DbNull },
    });

    revalidatePath('/settings');
    revalidatePath('/chat/*');

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[USER_PREFERENCES_DELETE]', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
