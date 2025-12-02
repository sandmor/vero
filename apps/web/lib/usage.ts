import type { LanguageModelUsage } from 'ai';
import type { UsageData } from 'tokenlens/helpers';
import type { CostBreakdown } from './ai/pricing';

// Server-merged usage: base usage + TokenLens summary + optional modelId + database cost
export type AppUsage = LanguageModelUsage &
  UsageData & {
    modelId?: string;
    costUSD?: CostBreakdown;
  };
