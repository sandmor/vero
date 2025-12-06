import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { prisma } from '@virid/db';
import { normalizeAgentSettingsPayload } from '@/lib/agent-settings';
import type { Prisma } from '@virid/db';

export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await prisma.agent.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description, settings } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (name.length > 128) {
      return NextResponse.json({ error: 'Name too long' }, { status: 400 });
    }

    if (
      description &&
      (typeof description !== 'string' || description.length > 1000)
    ) {
      return NextResponse.json(
        { error: 'Description too long' },
        { status: 400 }
      );
    }

    const normalizedSettings = normalizeAgentSettingsPayload(settings);

    const agent = await prisma.agent.create({
      data: {
        userId: session.user.id,
        name: name.trim(),
        description: description?.trim(),
        settings: normalizedSettings as unknown as Prisma.JsonObject,
      },
    });

    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    console.error('Failed to create agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
