import type { LanguageModelUsage } from 'ai';
import type { ModelPricing } from './model-capabilities';
import { getModelCapabilities } from './model-capabilities';

export type CostBreakdown = {
  inputUSD?: number;
  outputUSD?: number;
  reasoningUSD?: number;
  cacheReadUSD?: number;
  cacheWriteUSD?: number;
  totalUSD?: number;
};

const TOKENS_PER_MILLION = 1_000_000;

/**
 * Calculate cost breakdown from usage and pricing
 */
export function calculateCost(
  usage: LanguageModelUsage & Record<string, unknown>,
  pricing: ModelPricing
): CostBreakdown {
  const inputTokens = (usage.inputTokens as number | undefined) ?? 0;
  const outputTokens = (usage.outputTokens as number | undefined) ?? 0;
  const reasoningTokens =
    'reasoningTokens' in usage ? ((usage.reasoningTokens as number) ?? 0) : 0;
  const cachedInputTokens =
    'cachedInputTokens' in usage
      ? ((usage.cachedInputTokens as number) ?? 0)
      : 0;

  const inputUSD =
    pricing.prompt !== undefined && inputTokens > 0
      ? (inputTokens / TOKENS_PER_MILLION) * pricing.prompt
      : undefined;

  const outputUSD =
    pricing.completion !== undefined && outputTokens > 0
      ? (outputTokens / TOKENS_PER_MILLION) * pricing.completion
      : undefined;

  const reasoningUSD =
    pricing.reasoning !== undefined && reasoningTokens > 0
      ? (reasoningTokens / TOKENS_PER_MILLION) * pricing.reasoning
      : undefined;

  const cacheReadUSD =
    pricing.cacheRead !== undefined && cachedInputTokens > 0
      ? (cachedInputTokens / TOKENS_PER_MILLION) * pricing.cacheRead
      : undefined;

  const totalParts = [inputUSD, outputUSD, reasoningUSD, cacheReadUSD].filter(
    (v): v is number => typeof v === 'number'
  );

  const totalUSD =
    totalParts.length > 0 ? totalParts.reduce((a, b) => a + b, 0) : undefined;

  return {
    inputUSD,
    outputUSD,
    reasoningUSD,
    cacheReadUSD,
    totalUSD,
  };
}

/**
 * Get cost breakdown for a model from the database
 */
export async function getModelCost(
  modelId: string,
  usage: LanguageModelUsage & Record<string, unknown>
): Promise<CostBreakdown | null> {
  const capabilities = await getModelCapabilities(modelId);

  if (!capabilities?.pricing) {
    return null;
  }

  return calculateCost(usage, capabilities.pricing);
}
