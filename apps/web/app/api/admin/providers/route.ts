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
  const providers = await prisma.provider.findMany({ orderBy: { id: 'asc' } });
  return NextResponse.json({ providers });
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const { id, apiKey } = body as { id?: string; apiKey?: string };
  if (!id || !/^[a-z][a-z0-9_-]{1,63}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey required' }, { status: 400 });
  }
  await prisma.provider.upsert({
    where: { id },
    create: { id, apiKey },
    update: { apiKey },
  });
  revalidatePath('/admin');
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
  await prisma.provider.delete({ where: { id } }).catch(() => {});
  revalidatePath('/admin');
  return NextResponse.json({ ok: true });
}
