import { NextRequest, NextResponse } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import {
  getUserByokModels,
  createUserByokPlatformModel,
  createUserByokCustomModel,
  updateUserByokModel,
  deleteUserByokModel,
} from '@/lib/queries/byok';

/**
 * GET /api/user/byok/models
 * Get all BYOK models for the current user
 */
export async function GET() {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const models = await getUserByokModels(session.user.id);

  return NextResponse.json({
    models: models.map((m) => ({
      id: m.id,
      fullModelId: m.fullModelId,
      sourceType: m.sourceType,
      providerId: m.providerId,
      customProviderId: m.customProviderId,
      providerModelId: m.providerModelId,
      displayName: m.displayName,
      supportsTools: m.supportsTools,
      maxOutputTokens: m.maxOutputTokens,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
  });
}

/**
 * POST /api/user/byok/models
 * Create a new BYOK model
 */
export async function POST(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    sourceType,
    providerId,
    customProviderId,
    providerModelId,
    displayName,
    supportsTools,
    maxOutputTokens,
  } = body as {
    sourceType?: 'platform' | 'custom';
    providerId?: string;
    customProviderId?: string;
    providerModelId?: string;
    displayName?: string;
    supportsTools?: boolean;
    maxOutputTokens?: number | null;
  };

  if (!sourceType || !providerModelId || !displayName) {
    return NextResponse.json(
      { error: 'sourceType, providerModelId, and displayName required' },
      { status: 400 }
    );
  }

  try {
    let model;

    if (sourceType === 'platform') {
      if (!providerId) {
        return NextResponse.json(
          { error: 'providerId required for platform models' },
          { status: 400 }
        );
      }
      model = await createUserByokPlatformModel(session.user.id, {
        providerId,
        providerModelId,
        displayName,
        supportsTools,
        maxOutputTokens,
      });
    } else if (sourceType === 'custom') {
      if (!customProviderId) {
        return NextResponse.json(
          { error: 'customProviderId required for custom models' },
          { status: 400 }
        );
      }
      model = await createUserByokCustomModel(session.user.id, {
        customProviderId,
        providerModelId,
        displayName,
        supportsTools,
        maxOutputTokens,
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid sourceType' },
        { status: 400 }
      );
    }

    revalidatePath('/settings');
    return NextResponse.json({
      model: {
        id: model.id,
        fullModelId: model.fullModelId,
        sourceType: model.sourceType,
        providerId: model.providerId,
        customProviderId: model.customProviderId,
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        supportsTools: model.supportsTools,
        maxOutputTokens: model.maxOutputTokens,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

/**
 * PUT /api/user/byok/models
 * Update a BYOK model
 */
export async function PUT(req: NextRequest) {
  const session = await getAppSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { id, displayName, supportsTools, maxOutputTokens } = body as {
    id?: string;
    displayName?: string;
    supportsTools?: boolean;
    maxOutputTokens?: number | null;
  };

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const model = await updateUserByokModel(session.user.id, id, {
      displayName,
      supportsTools,
      maxOutputTokens,
    });
    revalidatePath('/settings');
    return NextResponse.json({
      model: {
        id: model.id,
        fullModelId: model.fullModelId,
        sourceType: model.sourceType,
        providerId: model.providerId,
        customProviderId: model.customProviderId,
        providerModelId: model.providerModelId,
        displayName: model.displayName,
        supportsTools: model.supportsTools,
        maxOutputTokens: model.maxOutputTokens,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

/**
 * DELETE /api/user/byok/models?id=xxx
 * Delete a BYOK model
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
    await deleteUserByokModel(session.user.id, id);
    revalidatePath('/settings');
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
