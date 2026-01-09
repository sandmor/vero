import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  getSystemAgentBySlug,
  updateSystemAgentSettings,
  resetSystemAgent,
} from '@/lib/db/queries';
import {
  SYSTEM_AGENTS,
  type SystemAgentSettings,
} from '@/lib/ai/system-agents';
import { normalizeAgentPromptConfig } from '@/lib/agent-prompt';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/admin/system-agents/[slug]
 * Returns a single system agent by slug.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  if (!SYSTEM_AGENTS[slug]) {
    return NextResponse.json(
      { error: 'Unknown system agent' },
      { status: 404 }
    );
  }

  try {
    const agent = await getSystemAgentBySlug(slug);
    if (!agent) {
      return NextResponse.json(
        { error: 'System agent not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Failed to fetch system agent:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system agent' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/system-agents/[slug]
 * Updates a system agent's settings.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  if (!SYSTEM_AGENTS[slug]) {
    return NextResponse.json(
      { error: 'Unknown system agent' },
      { status: 404 }
    );
  }

  try {
    const body = await request.json();
    const { settings } = body as {
      settings?: Partial<SystemAgentSettings>;
    };

    if (!settings) {
      return NextResponse.json(
        { error: 'No settings provided' },
        { status: 400 }
      );
    }

    const normalizedSettings: SystemAgentSettings = {
      modelId:
        typeof settings.modelId === 'string'
          ? settings.modelId.trim() || undefined
          : undefined,
      prompt: normalizeAgentPromptConfig(settings.prompt),
    };

    const agent = await updateSystemAgentSettings(slug, normalizedSettings);
    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Failed to update system agent:', error);
    return NextResponse.json(
      { error: 'Failed to update system agent' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/system-agents/[slug]?action=reset
 * Resets a system agent to its default settings.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { slug } = await params;

  // Check if this is a reset action
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action !== 'reset') {
    return NextResponse.json(
      { error: 'Invalid action. Use ?action=reset' },
      { status: 400 }
    );
  }

  if (!SYSTEM_AGENTS[slug]) {
    return NextResponse.json(
      { error: 'Unknown system agent' },
      { status: 404 }
    );
  }

  try {
    const agent = await resetSystemAgent(slug);
    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Failed to reset system agent:', error);
    return NextResponse.json(
      { error: 'Failed to reset system agent' },
      { status: 500 }
    );
  }
}
