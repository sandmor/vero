import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  upsertModelProvider,
  type ModelPricing,
} from '@/lib/ai/model-capabilities';

// POST /api/admin/model-capabilities/[id]/providers - Add Provider
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAdmin();
    const body = await req.json();
    const {
      providerId,
      providerModelId,
      pricing,
      isDefault,
      customPlatformProviderId,
    } = body;

    if (!providerId || !providerModelId) {
      return NextResponse.json(
        { error: 'providerId and providerModelId are required' },
        { status: 400 }
      );
    }

    await upsertModelProvider(id, {
      providerId,
      providerModelId,
      pricing: pricing as ModelPricing | undefined,
      isDefault: isDefault ?? false,
      enabled: true,
      customPlatformProviderId: customPlatformProviderId || null,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error adding provider:', error);
    return NextResponse.json(
      { error: 'Failed to add provider' },
      { status: 500 }
    );
  }
}
