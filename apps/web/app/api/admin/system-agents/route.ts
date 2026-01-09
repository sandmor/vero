import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getSystemAgents } from '@/lib/db/queries';

/**
 * GET /api/admin/system-agents
 * Returns all system agents with their current settings.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const agents = await getSystemAgents();
    return NextResponse.json({ agents });
  } catch (error) {
    console.error('Failed to fetch system agents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system agents' },
      { status: 500 }
    );
  }
}
