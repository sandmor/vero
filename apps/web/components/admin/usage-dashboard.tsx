'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  RefreshCcw,
  Activity,
  Users,
  Cpu,
  DollarSign,
  Key,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { unparse } from 'papaparse';

import { Button } from '@/components/ui/button';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  DateRangePicker,
  DateRangeValue,
  getDefaultDateRange,
  dateRangeToParams,
} from './analytics/date-range-picker';
import { DashboardConfigurator } from './analytics/dashboard-configurator';
import {
  useDashboardConfig,
  getWidgetSizeClass,
  type WidgetConfig,
  type MetricType,
  type ChartType,
} from './analytics/dashboard-config';
import { KPICard, KPIGrid } from './analytics/kpi-cards';
import {
  TimeSeriesWidget,
  TokenBreakdownWidget,
  ModelDistributionWidget,
  ProviderUsageWidget,
  BYOKWidget,
} from './analytics/widgets';
import {
  ModelStatsTable,
  UserStatsTable,
  RecentActivityTable,
} from './analytics/data-tables';
import { formatCost, formatTokens, formatNumber } from './analytics/charts';
import { cn } from '@/lib/utils';

// API response types
interface StatsResponse {
  kpi: {
    totalRequests: number;
    activeUsers: number;
    activeModels: number;
    totalCost: number;
    costChange: number;
    totalTokens: {
      inputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      cachedInputTokens: number;
      totalTokens: number;
    };
    avgCostPerRequest: number;
    avgTokensPerRequest: number;
    cacheHitRate: number;
  };
  dataOverTime: any[];
  modelDistribution: any[];
  modelStats: any[];
  providerUsage: any[];
  userStats: any[];
  tokenTypeDistribution: any[];
  byokBreakdown: {
    platform: { requests: number; cost: number; percentage: number };
    byok: { requests: number; cost: number; percentage: number };
  };
  recentActivity: any[];
  timeRange: string;
}

export function UsageDashboard() {
  const [dateRange, setDateRange] =
    useState<DateRangeValue>(getDefaultDateRange);
  const [activeTab, setActiveTab] = useState('overview');
  const { config, updateWidget } = useDashboardConfig();

  // Fetch data with date range
  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<StatsResponse>({
      queryKey: [
        'admin-stats',
        dateRange.from.toISOString(),
        dateRange.to.toISOString(),
      ],
      queryFn: async () => {
        const params = dateRangeToParams(dateRange);
        const res = await fetch(
          `/api/admin/stats?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
        );
        if (!res.ok) throw new Error('Failed to fetch stats');
        return res.json();
      },
      staleTime: 60000,
      refetchOnWindowFocus: false,
    });

  // Auto refresh
  useEffect(() => {
    if (!config.autoRefresh) return;

    const interval = setInterval(() => {
      refetch();
    }, config.refreshInterval * 1000);

    return () => clearInterval(interval);
  }, [config.autoRefresh, config.refreshInterval, refetch]);

  // Export handler
  const handleExport = useCallback(() => {
    if (!data) return;

    const timeSeriesCsv = unparse(
      data.dataOverTime.map((item: any) => ({
        Date: item.name,
        Requests: item.requests,
        ActiveUsers: item.users,
        TotalTokens: item.tokens,
        InputTokens: item.inputTokens,
        OutputTokens: item.outputTokens,
        Cost: item.cost,
      }))
    );

    const modelStatsCsv = unparse(
      data.modelStats.map((item: any) => ({
        Model: item.name,
        Requests: item.requests,
        TotalTokens: item.tokens.totalTokens,
        InputTokens: item.tokens.inputTokens,
        OutputTokens: item.tokens.outputTokens,
        ReasoningTokens: item.tokens.reasoningTokens,
        CachedTokens: item.tokens.cachedInputTokens,
        TotalCost: item.cost.totalCost,
        AvgTokensPerRequest: item.avgTokensPerRequest,
        BYOKRequests: item.byokRequests,
      }))
    );

    const userStatsCsv = unparse(
      data.userStats.map((item: any) => ({
        User: item.email || item.userId,
        Requests: item.requests,
        TotalTokens: item.tokens.totalTokens,
        TotalCost: item.cost.totalCost,
        ModelsUsed: item.models.length,
        BYOKRequests: item.byokRequests,
        LastActive: item.lastActive,
      }))
    );

    const fullCsv = `=== USAGE SUMMARY ===
Period: ${dateRange.from.toLocaleDateString()} - ${dateRange.to.toLocaleDateString()}
Total Requests: ${data.kpi.totalRequests}
Active Users: ${data.kpi.activeUsers}
Active Models: ${data.kpi.activeModels}
Total Cost: $${data.kpi.totalCost}
Avg Cost Per Request: $${data.kpi.avgCostPerRequest}
Avg Tokens Per Request: ${data.kpi.avgTokensPerRequest}
Cache Hit Rate: ${data.kpi.cacheHitRate}%

=== TIME SERIES DATA ===
${timeSeriesCsv}

=== MODEL STATISTICS ===
${modelStatsCsv}

=== USER STATISTICS ===
${userStatsCsv}`;

    const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `virid_usage_report_${dateRange.from.toISOString().split('T')[0]}_${dateRange.to.toISOString().split('T')[0]}.csv`
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [data, dateRange]);

  // Widget update handlers
  const handleMetricChange = useCallback(
    (widgetId: string) => (metric: MetricType) => {
      updateWidget(widgetId, {
        settings: {
          ...config.widgets.find((w) => w.id === widgetId)?.settings,
          metric,
        },
      });
    },
    [config.widgets, updateWidget]
  );

  const handleChartTypeChange = useCallback(
    (widgetId: string) => (chartType: ChartType) => {
      updateWidget(widgetId, {
        settings: {
          ...config.widgets.find((w) => w.id === widgetId)?.settings,
          chartType,
        },
      });
    },
    [config.widgets, updateWidget]
  );

  // Get visible widgets
  const visibleWidgets = useMemo(
    () =>
      config.widgets.filter((w) => w.visible).sort((a, b) => a.order - b.order),
    [config.widgets]
  );

  // Get sparkline data from time series
  const sparklineData = useMemo(() => {
    if (!data?.dataOverTime)
      return { requests: [], tokens: [], cost: [], users: [] };
    return {
      requests: data.dataOverTime.map((d) => d.requests),
      tokens: data.dataOverTime.map((d) => d.tokens),
      cost: data.dataOverTime.map((d) => d.cost),
      users: data.dataOverTime.map((d) => d.users),
    };
  }, [data?.dataOverTime]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError) {
    return (
      <div className="flex h-[400px] w-full flex-col items-center justify-center gap-4">
        <div className="text-center">
          <p className="text-lg font-medium text-red-500">
            Failed to load usage statistics
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Please try again or check the server logs
          </p>
        </div>
        <ButtonWithFeedback
          onClick={() => refetch()}
          variant="outline"
          size="sm"
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Retry
        </ButtonWithFeedback>
      </div>
    );
  }

  const {
    kpi,
    dataOverTime,
    modelDistribution,
    modelStats,
    providerUsage,
    userStats,
    byokBreakdown,
    recentActivity,
  } = data!;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCcw
              className={cn('h-4 w-4', isFetching && 'animate-spin')}
            />
          </Button>
          <DashboardConfigurator
            onRefresh={() => refetch()}
            isRefreshing={isFetching}
          />
          <ButtonWithFeedback
            variant="outline"
            size="sm"
            className="h-9"
            onClick={handleExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </ButtonWithFeedback>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <AnimatePresence mode="wait">
        {config.showKPIs && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <KPIGrid columns={4}>
              <KPICard
                title="Total Requests"
                value={formatNumber(kpi.totalRequests)}
                subValue={`${formatNumber(kpi.avgTokensPerRequest)} avg tokens/request`}
                icon={Activity}
                sparklineData={sparklineData.requests}
                delay={0}
              />
              <KPICard
                title="Active Users"
                value={kpi.activeUsers}
                subValue={`${kpi.activeModels} models used`}
                icon={Users}
                sparklineData={sparklineData.users}
                delay={0.05}
              />
              <KPICard
                title="Total Tokens"
                value={formatTokens(kpi.totalTokens.totalTokens)}
                subValue={`${kpi.cacheHitRate}% cache hit rate`}
                icon={Cpu}
                sparklineData={sparklineData.tokens}
                delay={0.1}
              />
              <KPICard
                title="Total Cost"
                value={formatCost(kpi.totalCost)}
                subValue={`${formatCost(kpi.avgCostPerRequest)} avg per request`}
                icon={DollarSign}
                trend={kpi.costChange}
                sparklineData={sparklineData.cost}
                delay={0.15}
              />
            </KPIGrid>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabbed Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
          <TabsTrigger value="overview" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-2">
            <Cpu className="h-4 w-4" />
            <span className="hidden sm:inline">Models</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Users</span>
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">Activity</span>
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-4">
            {/* Main time series chart */}
            {visibleWidgets.find((w) => w.id === 'overview-chart') && (
              <div className={getWidgetSizeClass('full')}>
                <TimeSeriesWidget
                  widget={
                    visibleWidgets.find((w) => w.id === 'overview-chart')!
                  }
                  data={dataOverTime}
                  onMetricChange={handleMetricChange('overview-chart')}
                  onChartTypeChange={handleChartTypeChange('overview-chart')}
                />
              </div>
            )}

            {/* Token breakdown */}
            {visibleWidgets.find((w) => w.id === 'token-breakdown') && (
              <div className={getWidgetSizeClass('medium')}>
                <TokenBreakdownWidget
                  widget={
                    visibleWidgets.find((w) => w.id === 'token-breakdown')!
                  }
                  totalTokens={kpi.totalTokens}
                />
              </div>
            )}

            {/* BYOK breakdown */}
            {visibleWidgets.find((w) => w.type === 'token-breakdown') && (
              <div className={getWidgetSizeClass('medium')}>
                <BYOKWidget
                  widget={{
                    ...visibleWidgets.find((w) => w.id === 'token-breakdown')!,
                    id: 'byok-breakdown',
                    title: 'API Key Usage',
                  }}
                  data={byokBreakdown}
                />
              </div>
            )}

            {/* Model distribution */}
            {visibleWidgets.find((w) => w.id === 'model-distribution') && (
              <div className={getWidgetSizeClass('medium')}>
                <ModelDistributionWidget
                  widget={
                    visibleWidgets.find((w) => w.id === 'model-distribution')!
                  }
                  data={modelDistribution}
                  onMetricChange={handleMetricChange('model-distribution')}
                />
              </div>
            )}

            {/* Provider usage */}
            {visibleWidgets.find((w) => w.id === 'provider-usage') && (
              <div className={getWidgetSizeClass('medium')}>
                <ProviderUsageWidget
                  widget={
                    visibleWidgets.find((w) => w.id === 'provider-usage')!
                  }
                  data={providerUsage}
                />
              </div>
            )}

            {/* Cost over time */}
            {visibleWidgets.find((w) => w.id === 'cost-over-time') && (
              <div className={getWidgetSizeClass('large')}>
                <TimeSeriesWidget
                  widget={{
                    ...visibleWidgets.find((w) => w.id === 'cost-over-time')!,
                    settings: {
                      ...visibleWidgets.find((w) => w.id === 'cost-over-time')!
                        .settings,
                      metric: 'cost',
                    },
                  }}
                  data={dataOverTime}
                  onChartTypeChange={handleChartTypeChange('cost-over-time')}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Models Tab */}
        <TabsContent value="models" className="mt-4">
          {visibleWidgets.find((w) => w.id === 'model-table') && (
            <ModelStatsTable
              widget={visibleWidgets.find((w) => w.id === 'model-table')!}
              data={modelStats}
            />
          )}
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="mt-4">
          {visibleWidgets.find((w) => w.id === 'user-table') && (
            <UserStatsTable
              widget={visibleWidgets.find((w) => w.id === 'user-table')!}
              data={userStats}
            />
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity" className="mt-4">
          <RecentActivityTable
            widget={{
              id: 'recent-activity',
              type: 'table',
              title: 'Recent Activity',
              visible: true,
              size: 'full',
              order: 0,
              settings: { limit: 50 },
            }}
            data={recentActivity}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loading skeleton
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-10 w-[140px]" />
          <Skeleton className="h-10 w-[200px]" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-[120px]" />
          <Skeleton className="h-10 w-[100px]" />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array(4)
          .fill(0)
          .map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
      </div>
      <Skeleton className="h-10 w-[500px]" />
      <Skeleton className="h-[400px] rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[320px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    </div>
  );
}
