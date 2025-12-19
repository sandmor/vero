import { prisma } from '@virid/db';
import {
  subHours,
  subDays,
  format,
  startOfHour,
  startOfDay,
  eachHourOfInterval,
  eachDayOfInterval,
} from 'date-fns';

export type TimeRange = '24h' | '7d' | '30d' | '90d';

// Token breakdown types for detailed analysis
interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  reasoningCost: number;
  cachedInputCost: number;
  extrasCost: number;
  totalCost: number;
}

interface ModelStats {
  name: string;
  requests: number;
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  byokRequests: number;
  avgTokensPerRequest: number;
}

interface UserStats {
  userId: string;
  email: string | null;
  requests: number;
  tokens: TokenBreakdown;
  cost: CostBreakdown;
  byokRequests: number;
  models: string[];
  lastActive: Date;
}

interface TimeSeriesBucket {
  name: string;
  timestamp: Date;
  requests: number;
  users: Set<string>;
  tokens: TokenBreakdown;
  cost: number;
}

export async function getUsageStats(range: TimeRange) {
  const now = new Date();
  let startDate = new Date();
  let dateFormat = 'MMM d';
  let bucketUnit: 'hour' | 'day' = 'day';

  switch (range) {
    case '24h':
      startDate = subHours(now, 24);
      dateFormat = 'HH:mm';
      bucketUnit = 'hour';
      break;
    case '7d':
      startDate = subDays(now, 7);
      break;
    case '30d':
      startDate = subDays(now, 30);
      break;
    case '90d':
      startDate = subDays(now, 90);
      break;
  }

  const where = {
    createdAt: {
      gte: startDate,
    },
  };

  // Fetch comprehensive data in parallel
  const [
    allUsageRecords,
    totalRecordsCount,
    tokenAggregates,
    recentActivity,
    previousPeriodCost,
  ] = await Promise.all([
    // Full usage data for detailed analysis
    prisma.tokenUsage.findMany({
      where,
      select: {
        id: true,
        userId: true,
        model: true,
        byok: true,
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedInputTokens: true,
        inputMTokenPriceMicros: true,
        outputMTokenPriceMicros: true,
        reasoningMTokenPriceMicros: true,
        cachedInputMTokenPriceMicros: true,
        extrasCostMicros: true,
        totalCostMicros: true,
        createdAt: true,
        user: {
          select: {
            email: true,
            id: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    }),

    // Total count
    prisma.tokenUsage.count({ where }),

    // Aggregate token sums
    prisma.tokenUsage.aggregate({
      where,
      _sum: {
        inputTokens: true,
        outputTokens: true,
        reasoningTokens: true,
        cachedInputTokens: true,
        totalCostMicros: true,
        extrasCostMicros: true,
      },
    }),

    // Recent activity (last 50 for more context)
    prisma.tokenUsage.findMany({
      where,
      take: 50,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            email: true,
            id: true,
          },
        },
      },
    }),

    // Previous period cost for comparison
    prisma.tokenUsage.aggregate({
      where: {
        createdAt: {
          gte:
            range === '24h'
              ? subHours(startDate, 24)
              : range === '7d'
                ? subDays(startDate, 7)
                : range === '30d'
                  ? subDays(startDate, 30)
                  : subDays(startDate, 90),
          lt: startDate,
        },
      },
      _sum: {
        totalCostMicros: true,
      },
    }),
  ]);

  // === Process Data ===

  // Initialize time buckets with all intervals
  const buckets = new Map<string, TimeSeriesBucket>();
  const intervals =
    bucketUnit === 'hour'
      ? eachHourOfInterval({ start: startDate, end: now })
      : eachDayOfInterval({ start: startDate, end: now });

  intervals.forEach((date) => {
    const key = format(
      bucketUnit === 'hour' ? startOfHour(date) : startOfDay(date),
      dateFormat
    );
    buckets.set(key, {
      name: key,
      timestamp: date,
      requests: 0,
      users: new Set(),
      tokens: {
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
      },
      cost: 0,
    });
  });

  // Model statistics
  const modelStatsMap = new Map<string, ModelStats>();
  // User statistics
  const userStatsMap = new Map<string, UserStats>();
  // Provider statistics
  const providerStatsMap = new Map<
    string,
    { requests: number; tokens: number; cost: number; byokRequests: number }
  >();
  // BYOK vs Platform usage
  let byokRequests = 0;
  let platformRequests = 0;
  let byokCost = 0;
  let platformCost = 0;

  // Process each record
  allUsageRecords.forEach((record) => {
    const bucketKey = format(
      bucketUnit === 'hour'
        ? startOfHour(record.createdAt)
        : startOfDay(record.createdAt),
      dateFormat
    );

    // Time series bucket
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.requests++;
      if (record.userId) bucket.users.add(record.userId);
      bucket.tokens.inputTokens += record.inputTokens;
      bucket.tokens.outputTokens += record.outputTokens;
      bucket.tokens.reasoningTokens += record.reasoningTokens;
      bucket.tokens.cachedInputTokens += record.cachedInputTokens;
      bucket.tokens.totalTokens +=
        record.inputTokens +
        record.outputTokens +
        record.reasoningTokens +
        record.cachedInputTokens;
      bucket.cost += (record.totalCostMicros || 0) / 1_000_000;
    }

    // Model statistics
    if (!modelStatsMap.has(record.model)) {
      modelStatsMap.set(record.model, {
        name: record.model,
        requests: 0,
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
        },
        cost: {
          inputCost: 0,
          outputCost: 0,
          reasoningCost: 0,
          cachedInputCost: 0,
          extrasCost: 0,
          totalCost: 0,
        },
        byokRequests: 0,
        avgTokensPerRequest: 0,
      });
    }
    const modelStat = modelStatsMap.get(record.model)!;
    modelStat.requests++;
    modelStat.tokens.inputTokens += record.inputTokens;
    modelStat.tokens.outputTokens += record.outputTokens;
    modelStat.tokens.reasoningTokens += record.reasoningTokens;
    modelStat.tokens.cachedInputTokens += record.cachedInputTokens;
    modelStat.tokens.totalTokens +=
      record.inputTokens +
      record.outputTokens +
      record.reasoningTokens +
      record.cachedInputTokens;
    if (record.byok) modelStat.byokRequests++;

    // Calculate costs from token prices
    const inputCost =
      record.inputMTokenPriceMicros && record.inputTokens
        ? (record.inputMTokenPriceMicros * record.inputTokens) /
        1_000_000 /
        1_000_000
        : 0;
    const outputCost =
      record.outputMTokenPriceMicros && record.outputTokens
        ? (record.outputMTokenPriceMicros * record.outputTokens) /
        1_000_000 /
        1_000_000
        : 0;
    const reasoningCost =
      record.reasoningMTokenPriceMicros && record.reasoningTokens
        ? (record.reasoningMTokenPriceMicros * record.reasoningTokens) /
        1_000_000 /
        1_000_000
        : 0;
    const cachedInputCost =
      record.cachedInputMTokenPriceMicros && record.cachedInputTokens
        ? (record.cachedInputMTokenPriceMicros * record.cachedInputTokens) /
        1_000_000 /
        1_000_000
        : 0;
    const extrasCost = (record.extrasCostMicros || 0) / 1_000_000;

    modelStat.cost.inputCost += inputCost;
    modelStat.cost.outputCost += outputCost;
    modelStat.cost.reasoningCost += reasoningCost;
    modelStat.cost.cachedInputCost += cachedInputCost;
    modelStat.cost.extrasCost += extrasCost;
    modelStat.cost.totalCost += (record.totalCostMicros || 0) / 1_000_000;

    // User statistics
    const userKey = record.userId || 'anonymous';
    if (!userStatsMap.has(userKey)) {
      userStatsMap.set(userKey, {
        userId: record.userId || 'anonymous',
        email: record.user?.email || null,
        requests: 0,
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
        },
        cost: {
          inputCost: 0,
          outputCost: 0,
          reasoningCost: 0,
          cachedInputCost: 0,
          extrasCost: 0,
          totalCost: 0,
        },
        byokRequests: 0,
        models: [],
        lastActive: record.createdAt,
      });
    }
    const userStat = userStatsMap.get(userKey)!;
    userStat.requests++;
    userStat.tokens.inputTokens += record.inputTokens;
    userStat.tokens.outputTokens += record.outputTokens;
    userStat.tokens.reasoningTokens += record.reasoningTokens;
    userStat.tokens.cachedInputTokens += record.cachedInputTokens;
    userStat.tokens.totalTokens +=
      record.inputTokens +
      record.outputTokens +
      record.reasoningTokens +
      record.cachedInputTokens;
    userStat.cost.inputCost += inputCost;
    userStat.cost.outputCost += outputCost;
    userStat.cost.reasoningCost += reasoningCost;
    userStat.cost.cachedInputCost += cachedInputCost;
    userStat.cost.extrasCost += extrasCost;
    userStat.cost.totalCost += (record.totalCostMicros || 0) / 1_000_000;
    if (record.byok) userStat.byokRequests++;
    if (!userStat.models.includes(record.model)) {
      userStat.models.push(record.model);
    }
    if (record.createdAt > userStat.lastActive) {
      userStat.lastActive = record.createdAt;
    }

    // Provider statistics
    const parts = record.model.split(':');
    const provider = parts.length > 1 ? parts[0] : 'other';
    if (!providerStatsMap.has(provider)) {
      providerStatsMap.set(provider, {
        requests: 0,
        tokens: 0,
        cost: 0,
        byokRequests: 0,
      });
    }
    const providerStat = providerStatsMap.get(provider)!;
    providerStat.requests++;
    providerStat.tokens +=
      record.inputTokens +
      record.outputTokens +
      record.reasoningTokens +
      record.cachedInputTokens;
    providerStat.cost += (record.totalCostMicros || 0) / 1_000_000;
    if (record.byok) providerStat.byokRequests++;

    // BYOK tracking
    if (record.byok) {
      byokRequests++;
      byokCost += (record.totalCostMicros || 0) / 1_000_000;
    } else {
      platformRequests++;
      platformCost += (record.totalCostMicros || 0) / 1_000_000;
    }
  });

  // Calculate averages for model stats
  modelStatsMap.forEach((stat) => {
    stat.avgTokensPerRequest =
      stat.requests > 0 ? Math.round(stat.tokens.totalTokens / stat.requests) : 0;
  });

  // === Build Response ===

  // KPIs
  const totalTokens: TokenBreakdown = {
    inputTokens: tokenAggregates._sum.inputTokens || 0,
    outputTokens: tokenAggregates._sum.outputTokens || 0,
    reasoningTokens: tokenAggregates._sum.reasoningTokens || 0,
    cachedInputTokens: tokenAggregates._sum.cachedInputTokens || 0,
    totalTokens:
      (tokenAggregates._sum.inputTokens || 0) +
      (tokenAggregates._sum.outputTokens || 0) +
      (tokenAggregates._sum.reasoningTokens || 0) +
      (tokenAggregates._sum.cachedInputTokens || 0),
  };

  const totalCostMicros = tokenAggregates._sum.totalCostMicros || 0;
  const totalCost = totalCostMicros / 1_000_000;
  const previousCost =
    (previousPeriodCost._sum.totalCostMicros || 0) / 1_000_000;
  const costChange =
    previousCost > 0 ? ((totalCost - previousCost) / previousCost) * 100 : 0;

  const uniqueUsers = new Set(
    allUsageRecords.filter((r) => r.userId).map((r) => r.userId)
  );
  const uniqueModels = new Set(allUsageRecords.map((r) => r.model));

  // Time series data
  const dataOverTime = Array.from(buckets.values()).map((bucket) => ({
    name: bucket.name,
    requests: bucket.requests,
    users: bucket.users.size,
    tokens: bucket.tokens.totalTokens,
    inputTokens: bucket.tokens.inputTokens,
    outputTokens: bucket.tokens.outputTokens,
    cost: Number(bucket.cost.toFixed(4)),
  }));

  // Model distribution (sorted by cost)
  const modelStats = Array.from(modelStatsMap.values())
    .sort((a, b) => b.cost.totalCost - a.cost.totalCost)
    .map((stat) => ({
      ...stat,
      cost: {
        ...stat.cost,
        inputCost: Number(stat.cost.inputCost.toFixed(6)),
        outputCost: Number(stat.cost.outputCost.toFixed(6)),
        reasoningCost: Number(stat.cost.reasoningCost.toFixed(6)),
        cachedInputCost: Number(stat.cost.cachedInputCost.toFixed(6)),
        extrasCost: Number(stat.cost.extrasCost.toFixed(6)),
        totalCost: Number(stat.cost.totalCost.toFixed(6)),
      },
    }));

  // Model distribution for pie chart (by requests)
  const modelDistribution = modelStats.map((stat) => ({
    name: stat.name,
    value: stat.requests,
    cost: stat.cost.totalCost,
    tokens: stat.tokens.totalTokens,
  }));

  // User statistics (top users by cost)
  const userStats = Array.from(userStatsMap.values())
    .filter((u) => u.userId !== 'anonymous')
    .sort((a, b) => b.cost.totalCost - a.cost.totalCost)
    .slice(0, 20)
    .map((stat) => ({
      ...stat,
      cost: {
        ...stat.cost,
        inputCost: Number(stat.cost.inputCost.toFixed(6)),
        outputCost: Number(stat.cost.outputCost.toFixed(6)),
        reasoningCost: Number(stat.cost.reasoningCost.toFixed(6)),
        cachedInputCost: Number(stat.cost.cachedInputCost.toFixed(6)),
        extrasCost: Number(stat.cost.extrasCost.toFixed(6)),
        totalCost: Number(stat.cost.totalCost.toFixed(6)),
      },
      lastActive: stat.lastActive.toISOString(),
    }));

  // Provider usage
  const providerUsage = Array.from(providerStatsMap.entries())
    .map(([name, stat]) => ({
      name,
      requests: stat.requests,
      tokens: stat.tokens,
      cost: Number(stat.cost.toFixed(4)),
      byokRequests: stat.byokRequests,
    }))
    .sort((a, b) => b.cost - a.cost);

  // Token type distribution for pie chart
  const tokenTypeDistribution = [
    { name: 'Input', value: totalTokens.inputTokens, color: '#8884d8' },
    { name: 'Output', value: totalTokens.outputTokens, color: '#82ca9d' },
    { name: 'Reasoning', value: totalTokens.reasoningTokens, color: '#ffc658' },
    { name: 'Cached', value: totalTokens.cachedInputTokens, color: '#ff8042' },
  ].filter((t) => t.value > 0);

  // BYOK breakdown
  const byokBreakdown = {
    platform: {
      requests: platformRequests,
      cost: Number(platformCost.toFixed(4)),
      percentage:
        totalRecordsCount > 0
          ? Number(((platformRequests / totalRecordsCount) * 100).toFixed(1))
          : 0,
    },
    byok: {
      requests: byokRequests,
      cost: Number(byokCost.toFixed(4)),
      percentage:
        totalRecordsCount > 0
          ? Number(((byokRequests / totalRecordsCount) * 100).toFixed(1))
          : 0,
    },
  };

  // Recent Activity Formatted with more detail
  const recentActivityFormatted = recentActivity.map((record) => ({
    id: record.id,
    user: record.user?.email || record.userId || 'Anonymous',
    userId: record.userId,
    model: record.model,
    byok: record.byok,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cachedInputTokens: record.cachedInputTokens,
    totalTokens:
      record.inputTokens +
      record.outputTokens +
      record.reasoningTokens +
      record.cachedInputTokens,
    cost: record.totalCostMicros
      ? Number((record.totalCostMicros / 1_000_000).toFixed(6))
      : 0,
    timestamp: record.createdAt.toISOString(),
  }));

  // Cost efficiency metrics
  const avgCostPerRequest =
    totalRecordsCount > 0 ? totalCost / totalRecordsCount : 0;
  const avgTokensPerRequest =
    totalRecordsCount > 0 ? totalTokens.totalTokens / totalRecordsCount : 0;
  const cacheHitRate =
    totalTokens.inputTokens + totalTokens.cachedInputTokens > 0
      ? (totalTokens.cachedInputTokens /
        (totalTokens.inputTokens + totalTokens.cachedInputTokens)) *
      100
      : 0;

  return {
    kpi: {
      totalRequests: totalRecordsCount,
      activeUsers: uniqueUsers.size,
      activeModels: uniqueModels.size,
      totalCost: Number(totalCost.toFixed(4)),
      costChange: Number(costChange.toFixed(1)),
      totalTokens,
      avgCostPerRequest: Number(avgCostPerRequest.toFixed(6)),
      avgTokensPerRequest: Math.round(avgTokensPerRequest),
      cacheHitRate: Number(cacheHitRate.toFixed(1)),
    },
    dataOverTime,
    modelDistribution,
    modelStats,
    providerUsage,
    userStats,
    tokenTypeDistribution,
    byokBreakdown,
    recentActivity: recentActivityFormatted,
    timeRange: range,
  };
}
