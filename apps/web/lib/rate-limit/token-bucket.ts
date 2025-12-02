import { prisma } from '../db/prisma';
import { ChatSDKError } from '../errors';

export type TokenBucketConfig = {
  capacity: number; // Maximum tokens storable
  refillAmount: number; // Tokens added each interval
  refillIntervalSeconds: number; // Interval length
};

/**
 * Attempts to consume `cost` tokens for `userId` under the given config.
 * Performs atomic-ish update via a transaction. Uses optimistic logic:
 *  - Read row (or create with full capacity if absent)
 *  - Refill based on elapsed time windows (can apply multiple intervals)
 *  - If enough tokens, deduct and persist; else throw rate_limit error
 */
export async function consumeTokens({
  userId,
  cost,
  config,
}: {
  userId: string;
  cost: number;
  config: TokenBucketConfig;
}): Promise<{ remaining: number; capacity: number } | never> {
  if (cost <= 0)
    return { remaining: config.capacity, capacity: config.capacity };

  try {
    const result = await prisma.$transaction(async (tx) => {
      let state = await tx.userRateLimit.findUnique({ where: { userId } });
      const now = new Date();

      if (!state) {
        state = await tx.userRateLimit.create({
          data: { userId, tokens: config.capacity, lastRefill: now },
        });
      }

      let tokens = state.tokens;
      let lastRefill = state.lastRefill;

      if (tokens > config.capacity) tokens = config.capacity; // clamp any legacy anomalies

      // Calculate how many full intervals elapsed since last refill
      const elapsedMs = now.getTime() - lastRefill.getTime();
      const intervalMs = config.refillIntervalSeconds * 1000;
      if (elapsedMs >= intervalMs) {
        const intervals = Math.floor(elapsedMs / intervalMs);
        if (intervals > 0) {
          const refillTotal = intervals * config.refillAmount;
          tokens = Math.min(config.capacity, tokens + refillTotal);
          lastRefill = new Date(lastRefill.getTime() + intervals * intervalMs);
        }
      }

      if (tokens < cost) {
        // Not enough tokens; persist any refill and return error
        if (
          tokens !== state.tokens ||
          lastRefill.getTime() !== state.lastRefill.getTime()
        ) {
          await tx.userRateLimit.update({
            where: { userId },
            data: { tokens, lastRefill },
          });
        }
        throw new ChatSDKError('rate_limit:chat');
      }

      tokens -= cost;

      const updated = await tx.userRateLimit.update({
        where: { userId },
        data: { tokens, lastRefill },
      });

      return { remaining: updated.tokens, capacity: config.capacity };
    });

    return result;
  } catch (error) {
    if (error instanceof ChatSDKError) throw error;
    throw new ChatSDKError(
      'bad_request:database',
      'Failed token bucket transaction'
    );
  }
}
