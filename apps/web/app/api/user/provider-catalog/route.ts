import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getProviderCatalog, getAllCatalogEntries } from '@/lib/ai/model-capabilities';

/**
 * GET /api/user/provider-catalog
 * Returns catalog entries for a specific provider (or all if no provider specified).
 * Used by BYOK model selection UI to show available models.
 */
export async function GET(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const provider = req.nextUrl.searchParams.get('provider');

        let catalog;
        if (provider) {
            catalog = await getProviderCatalog(provider);
        } else {
            catalog = await getAllCatalogEntries();
        }

        return NextResponse.json({ catalog });
    } catch (error) {
        console.error('Error fetching provider catalog:', error);
        return NextResponse.json(
            { error: 'Failed to fetch catalog' },
            { status: 500 }
        );
    }
}
