import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import {
  getUserApiKeysWithMetadata,
  upsertUserApiKey,
  deleteUserApiKey,
} from '@/lib/queries/user-keys';

export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const records = await getUserApiKeysWithMetadata(session.user.id);
  const keys: Record<string, string> = {};
  const userSelections: Record<string, string[]> = {};

  for (const record of records) {
    keys[record.providerId] = record.apiKey;
    userSelections[record.providerId] = Array.isArray(record.modelIds)
      ? record.modelIds.filter((id): id is string => typeof id === 'string')
      : [];
  }

  return NextResponse.json({ keys, userSelections });
}

export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    providerId,
    apiKey,
    modelIds = [],
  } = body as {
    providerId?: string;
    apiKey?: string;
    modelIds?: string[];
  };

  if (!providerId || !apiKey) {
    return NextResponse.json(
      { error: 'providerId and apiKey required' },
      { status: 400 }
    );
  }

  try {
    console.log(
      'Upserting API key for user:',
      session.user.id,
      providerId,
      modelIds
    );
    await upsertUserApiKey(session.user.id, providerId, apiKey, modelIds);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

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
    await deleteUserApiKey(session.user.id, providerId);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
