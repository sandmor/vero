import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { normalizeAgentSettingsPayload } from '@/lib/agent-settings';
import type { Prisma } from '@/generated/prisma-client/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Agent ID required' }, { status: 400 });
  }

  try {
    const agent = await prisma.agent.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Agent ID required' }, { status: 400 });
  }

  try {
    // Check ownership
    const existing = await prisma.agent.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, settings } = body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          { error: 'Name is required' },
          { status: 400 }
        );
      }
      if (name.length > 128) {
        return NextResponse.json({ error: 'Name too long' }, { status: 400 });
      }
    }

    if (description !== undefined) {
      if (
        description &&
        (typeof description !== 'string' || description.length > 1000)
      ) {
        return NextResponse.json(
          { error: 'Description too long' },
          { status: 400 }
        );
      }
    }

    const normalizedSettings =
      settings !== undefined
        ? normalizeAgentSettingsPayload(settings)
        : undefined;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim();
    if (normalizedSettings !== undefined) {
      updateData.settings = normalizedSettings as unknown as Prisma.JsonObject;
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Failed to update agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Agent ID required' }, { status: 400 });
  }

  try {
    // Check ownership
    const existing = await prisma.agent.findFirst({
      where: { id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    await prisma.agent.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete agent:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
