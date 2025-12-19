import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getUsageStats, TimeRange } from '@/lib/admin/analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const range = (searchParams.get('range') as TimeRange) || '30d';

    const stats = await getUsageStats(range);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Unauthorized or Server Error' }, { status: 500 }); // simpler error handling
  }
}
