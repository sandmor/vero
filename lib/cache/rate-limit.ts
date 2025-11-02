import 'server-only';

const globalCacheRateLimiter = globalThis as unknown as {
  __viridCacheRateLimiter?: Map<string, RateLimitEntry>;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export type CacheRateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type CacheRateLimitConfig = {
  key: string;
  limit: number;
  windowMs: number;
};

function getStore(): Map<string, RateLimitEntry> {
  if (!globalCacheRateLimiter.__viridCacheRateLimiter) {
    globalCacheRateLimiter.__viridCacheRateLimiter = new Map();
  }
  return globalCacheRateLimiter.__viridCacheRateLimiter;
}

export function enforceCacheRateLimit(
  config: CacheRateLimitConfig
): CacheRateLimitResult {
  const store = getStore();
  const now = Date.now();
  const entry = store.get(config.key);
  const windowMs = Math.max(config.windowMs, 1_000);
  const limit = Math.max(config.limit, 1);

  if (entry && now < entry.resetAt) {
    if (entry.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.resetAt,
      };
    }

    entry.count += 1;
    store.set(config.key, entry);

    return {
      allowed: true,
      remaining: Math.max(limit - entry.count, 0),
      resetAt: entry.resetAt,
    };
  }

  const resetAt = now + windowMs;
  store.set(config.key, { count: 1, resetAt });

  return {
    allowed: true,
    remaining: Math.max(limit - 1, 0),
    resetAt,
  };
}
