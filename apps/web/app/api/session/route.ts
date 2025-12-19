import { NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getAppSession();
  const admin = await isAdmin();

  return NextResponse.json(
    { session, isAdmin: admin },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}
