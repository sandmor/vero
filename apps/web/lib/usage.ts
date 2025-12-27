import type { LanguageModelUsage } from 'ai';
import type { CostBreakdown } from './ai/pricing';

/**
 * Extended usage data returned from chat API
 * Combines base AI SDK usage with our model ID and cost information
 */
export type AppUsage = LanguageModelUsage & {
  modelId?: string;
  costUSD?: CostBreakdown;
};
