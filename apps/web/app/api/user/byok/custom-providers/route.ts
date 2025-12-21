import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import {
    getUserCustomProviders,
    createUserCustomProvider,
    updateUserCustomProvider,
    deleteUserCustomProvider,
} from '@/lib/queries/byok';

/**
 * GET /api/user/byok/custom-providers
 * Get all custom providers for the current user
 */
export async function GET() {
    const session = await getAppSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const providers = await getUserCustomProviders(session.user.id);

    // Hide API keys, only indicate if present
    const sanitized = providers.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        baseUrl: p.baseUrl,
        hasApiKey: !!p.apiKey,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
    }));

    return NextResponse.json({ providers: sanitized });
}

/**
 * POST /api/user/byok/custom-providers
 * Create a new custom provider
 */
export async function POST(req: NextRequest) {
    const session = await getAppSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { slug, name, baseUrl, apiKey } = body as {
        slug?: string;
        name?: string;
        baseUrl?: string;
        apiKey?: string;
    };

    if (!slug || !name || !baseUrl) {
        return NextResponse.json(
            { error: 'slug, name, and baseUrl required' },
            { status: 400 }
        );
    }

    try {
        const provider = await createUserCustomProvider(session.user.id, {
            slug,
            name,
            baseUrl,
            apiKey,
        });
        revalidatePath('/settings');
        return NextResponse.json({
            provider: {
                id: provider.id,
                slug: provider.slug,
                name: provider.name,
                baseUrl: provider.baseUrl,
                hasApiKey: !!provider.apiKey,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

/**
 * PUT /api/user/byok/custom-providers
 * Update an existing custom provider
 */
export async function PUT(req: NextRequest) {
    const session = await getAppSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { id, name, baseUrl, apiKey } = body as {
        id?: string;
        name?: string;
        baseUrl?: string;
        apiKey?: string | null;
    };

    if (!id) {
        return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    try {
        const provider = await updateUserCustomProvider(session.user.id, id, {
            name,
            baseUrl,
            apiKey,
        });
        revalidatePath('/settings');
        return NextResponse.json({
            provider: {
                id: provider.id,
                slug: provider.slug,
                name: provider.name,
                baseUrl: provider.baseUrl,
                hasApiKey: !!provider.apiKey,
            },
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}

/**
 * DELETE /api/user/byok/custom-providers?id=xxx
 * Delete a custom provider
 */
export async function DELETE(req: NextRequest) {
    const session = await getAppSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
        return NextResponse.json({ error: 'id required' }, { status: 400 });
    }

    try {
        await deleteUserCustomProvider(session.user.id, id);
        revalidatePath('/settings');
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
}
