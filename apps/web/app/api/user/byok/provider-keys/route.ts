import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import {
  getUserProviderKeys,
  upsertUserProviderKey,
  deleteUserProviderKey,
} from '@/lib/queries/byok';

/**
 * GET /api/user/byok/provider-keys
 * Get all provider keys for the current user
 */
export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await getUserProviderKeys(session.user.id);

  // Return as a map for easy lookup
  const keysMap: Record<string, { hasKey: boolean; updatedAt: string }> = {};
  for (const key of keys) {
    keysMap[key.providerId] = {
      hasKey: true,
      updatedAt: key.updatedAt.toISOString(),
    };
  }

  return NextResponse.json({ keys: keysMap });
}

/**
 * POST /api/user/byok/provider-keys
 * Create or update a provider key
 */
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { providerId, apiKey } = body as {
    providerId?: string;
    apiKey?: string;
  };

  if (!providerId || !apiKey) {
    return NextResponse.json(
      { error: 'providerId and apiKey required' },
      { status: 400 }
    );
  }

  try {
    await upsertUserProviderKey(session.user.id, providerId, apiKey);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

/**
 * DELETE /api/user/byok/provider-keys?providerId=xxx
 * Delete a provider key
 */
export async function DELETE(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get('providerId');

  if (!providerId) {
    return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  }

  try {
    await deleteUserProviderKey(session.user.id, providerId);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
