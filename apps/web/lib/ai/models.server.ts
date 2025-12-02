import 'server-only';

import { deriveChatModel, type ChatModelOption } from './models';
import { getModelCapabilities } from './model-capabilities';

type ResolveChatModelOptionsConfig = {
  /** Additional model ids to include even if they are not part of the base list. */
  extraModelIds?: string[];
  /** Model ids that should be flagged as BYOK in the resulting options. */
  highlightIds?: Iterable<string>;
};

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

  const allIds = [...baseIds, ...new Set(extras)];
  if (allIds.length === 0) {
    return [];
  }

  const resolvedEntries = await Promise.all(
    allIds.map(async (id) => {
      const baseModel = deriveChatModel(id);
      const capabilities = await getModelCapabilities(id);
      const summary = capabilities
        ? {
            supportsTools: capabilities.supportsTools,
            supportedFormats: capabilities.supportedFormats,
          }
        : null;
      const option: ChatModelOption = {
        ...baseModel,
        capabilities: summary,
      };
      if (highlightSet?.has(id)) {
        option.isBYOK = true;
      }
      return option;
    })
  );

  const lookup = new Map<string, ChatModelOption>(
    resolvedEntries.map((entry) => [entry.id, entry])
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
