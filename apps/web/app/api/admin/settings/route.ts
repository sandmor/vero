import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/admin';
import { revalidatePath } from 'next/cache';

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await prisma.setting.findMany({ orderBy: { id: 'asc' } });
  const settingsMap = Object.fromEntries(settings.map((s) => [s.id, s.value]));
  return NextResponse.json({ settings: settingsMap });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const { id, value } = body as { id?: string; value?: string };
  if (!id || typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  if (value === undefined || typeof value !== 'string') {
    return NextResponse.json({ error: 'value required' }, { status: 400 });
  }
  await prisma.setting.upsert({
    where: { id },
    create: { id, value },
    update: { value },
  });
  revalidatePath('/settings');
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  await prisma.setting.delete({ where: { id } }).catch(() => {});
  revalidatePath('/settings');
  return NextResponse.json({ ok: true });
}
