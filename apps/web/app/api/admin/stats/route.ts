import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getUsageStats, getUsageStatsForDateRange, TimeRange } from '@/lib/admin/analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);

    // Support both legacy range param and new from/to params
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const rangeParam = searchParams.get('range') as TimeRange | null;

    let stats;

    if (fromParam && toParam) {
      // Custom date range
      const from = new Date(fromParam);
      const to = new Date(toParam);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
      }

      stats = await getUsageStatsForDateRange(from, to);
    } else {
      // Legacy preset range
      const range = rangeParam || '30d';
      stats = await getUsageStats(range);
    }

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Admin stats error:', error);
    return NextResponse.json({ error: 'Unauthorized or Server Error' }, { status: 500 });
  }
}
