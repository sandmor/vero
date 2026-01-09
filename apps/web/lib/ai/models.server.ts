import 'server-only';

import { prisma } from '@vero/db';
import { type ChatModelOption } from './models';
import { getModelCapabilities } from './model-capabilities';
import { parseModelId, getModelName } from './model-id';
import { isByokModelId, parseByokModelId } from './byok';

type ByokModelInfo = {
  id: string;
  displayName: string;
  /** Slug-based provider identifier for logo lookup (e.g., "openai") */
  providerSlug: string;
  /** Human-readable provider name for display (e.g., "OpenAI" or custom name) */
  providerDisplayName: string;
  supportsTools: boolean;
};

type ResolveChatModelOptionsConfig = {
  /** Additional model ids to include even if they are not part of the base list. */
  extraModelIds?: string[];
  /** Model ids that should be flagged as BYOK in the resulting options. */
  highlightIds?: Iterable<string>;
  /** Pre-resolved BYOK model info for proper display names */
  byokModels?: ByokModelInfo[];
};

/**
 * Build a ChatModelOption from database model or fallback to parsing the ID
 */
function buildChatModelOption(
  id: string,
  dbModel: { name: string; creator: string } | null,
  capabilities: { supportsTools: boolean; supportedFormats: string[] } | null,
  isBYOK: boolean
): ChatModelOption {
  const parsed = parseModelId(id);
  const creator = dbModel?.creator ?? parsed?.creator ?? 'unknown';
  const modelSlug = parsed?.modelName ?? id;

  return {
    id,
    creator,
    model: modelSlug,
    name: dbModel?.name ?? getModelName(id) ?? id,
    capabilities: capabilities
      ? {
          supportsTools: capabilities.supportsTools,
          supportedFormats: capabilities.supportedFormats as any[],
        }
      : null,
    isBYOK,
  };
}

/**
 * Build a ChatModelOption from BYOK model info
 */
function buildByokChatModelOption(byokInfo: ByokModelInfo): ChatModelOption {
  return {
    id: byokInfo.id,
    creator: byokInfo.providerSlug,
    model: byokInfo.displayName,
    name: byokInfo.displayName,
    capabilities: {
      supportsTools: byokInfo.supportsTools,
      supportedFormats: ['text'], // Default for BYOK models
    },
    isBYOK: true,
  };
}

/**
 * Resolve the chat model metadata along with a lightweight capability summary for UI consumption.
 * Preserves the order of the provided ids and drops duplicates that cannot be resolved.
 */
export async function resolveChatModelOptions(
  modelIds: string[],
  config: ResolveChatModelOptionsConfig = {}
): Promise<ChatModelOption[]> {
  const baseIds = Array.from(new Set(modelIds.filter(Boolean)));
  const extras = (config.extraModelIds ?? [])
    .filter(Boolean)
    .filter((id) => !baseIds.includes(id));
  const highlightSet = config.highlightIds
    ? new Set(Array.from(config.highlightIds).filter(Boolean))
    : null;

  // Build a map of BYOK model info for quick lookup
  const byokModelMap = new Map((config.byokModels ?? []).map((m) => [m.id, m]));

  const allIds = [...baseIds, ...new Set(extras)];
  if (allIds.length === 0) {
    return [];
  }

  // Separate BYOK model IDs from platform model IDs
  const platformIds = allIds.filter((id) => !isByokModelId(id));
  const byokIds = allIds.filter((id) => isByokModelId(id));

  // Fetch model metadata from database in bulk (only for platform models)
  const dbModels =
    platformIds.length > 0
      ? await prisma.model.findMany({
          where: { id: { in: platformIds } },
          select: {
            id: true,
            name: true,
            creator: true,
            supportsTools: true,
            supportedFormats: true,
          },
        })
      : [];
  const dbModelMap = new Map(dbModels.map((m) => [m.id, m]));

  // Also fetch platform custom models (admin-defined)
  const platformCustomModels =
    platformIds.length > 0
      ? await prisma.platformCustomModel.findMany({
          where: { modelSlug: { in: platformIds }, enabled: true },
          include: { provider: { select: { enabled: true } } },
        })
      : [];
  // Filter to only include enabled providers
  const enabledCustomModels = platformCustomModels.filter(
    (m) => m.provider.enabled
  );
  const customModelMap = new Map(
    enabledCustomModels.map((m) => [m.modelSlug, m])
  );

  // Build options for platform models
  const platformEntries = await Promise.all(
    platformIds.map(async (id) => {
      // Check platform custom models first (admin-defined)
      const customModel = customModelMap.get(id);
      if (customModel) {
        // Parse the model slug to extract creator
        const parsed = parseModelId(id);
        return buildChatModelOption(
          id,
          {
            name: customModel.displayName,
            creator: parsed?.creator ?? 'custom',
          },
          {
            supportsTools: customModel.supportsTools,
            supportedFormats: customModel.supportedFormats,
          },
          false // Platform custom models are not BYOK
        );
      }

      // Fall back to regular Model table
      const dbModel = dbModelMap.get(id);
      const capabilities = dbModel
        ? {
            supportsTools: dbModel.supportsTools,
            supportedFormats: dbModel.supportedFormats,
          }
        : await getModelCapabilities(id);

      const isBYOK = highlightSet?.has(id) ?? false;

      return buildChatModelOption(
        id,
        dbModel ? { name: dbModel.name, creator: dbModel.creator } : null,
        capabilities,
        isBYOK
      );
    })
  );

  // Build options for BYOK models
  const byokEntries = byokIds.map((id) => {
    const byokInfo = byokModelMap.get(id);
    if (byokInfo) {
      return buildByokChatModelOption(byokInfo);
    }
    // Fallback: parse the BYOK ID to extract what info we can
    const parsed = parseByokModelId(id);
    if (parsed) {
      const providerSlug =
        parsed.sourceType === 'custom'
          ? parsed.customProviderSlug
          : parsed.providerId;
      return buildByokChatModelOption({
        id,
        displayName: parsed.providerModelId,
        providerSlug: providerSlug ?? 'custom',
        providerDisplayName: providerSlug ?? 'Custom',
        supportsTools: true,
      });
    }
    // Last resort fallback
    return buildChatModelOption(id, null, null, true);
  });

  const lookup = new Map<string, ChatModelOption>(
    [...platformEntries, ...byokEntries].map((entry) => [entry.id, entry])
  );

  const ordered: ChatModelOption[] = [];
  for (const id of baseIds) {
    const resolved = lookup.get(id);
    if (resolved) {
      ordered.push(resolved);
    }
  }

  if (extras.length > 0) {
    const extrasSorted = extras
      .map((id) => lookup.get(id))
      .filter((option): option is ChatModelOption => Boolean(option))
      .sort((a, b) => a.name.localeCompare(b.name));
    ordered.push(...extrasSorted);
  }

  return ordered;
}
