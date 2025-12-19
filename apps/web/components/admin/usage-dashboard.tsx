'use client';

import { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ButtonWithFeedback } from '@/components/ui/button-with-feedback';
import {
  Download,
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  Zap,
  Users,
  Cpu,
  DollarSign,
  Activity,
  BarChart3,
  PieChartIcon,
  Key,
  Database,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { unparse } from 'papaparse';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const COLORS = [
  '#8884d8',
  '#82ca9d',
  '#ffc658',
  '#ff8042',
  '#0088FE',
  '#00C49F',
  '#FFBB28',
  '#FF8042',
];
const OTHER_COLOR = '#9ca3af';

type TimeRange = '24h' | '7d' | '30d' | '90d';
type ChartMetric = 'requests' | 'tokens' | 'cost' | 'users';

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

function formatCost(cost: number): string {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(6)}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

// KPI Card component for consistent styling
function KPICard({
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  trendLabel,
}: {
  title: string;
  value: string | number;
  subValue?: string;
  icon: React.ElementType;
  trend?: number;
  trendLabel?: string;
}) {
  const isPositiveTrend = trend && trend > 0;
  const TrendIcon = isPositiveTrend ? TrendingUp : TrendingDown;

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subValue && (
          <p className="text-xs text-muted-foreground mt-1">{subValue}</p>
        )}
        {trend !== undefined && (
          <div
            className={`flex items-center text-xs mt-2 ${isPositiveTrend ? 'text-red-500' : 'text-green-500'}`}
          >
            <TrendIcon className="h-3 w-3 mr-1" />
            {Math.abs(trend).toFixed(1)}% {trendLabel || 'vs previous period'}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Token breakdown mini-chart
function TokenBreakdownChart({
  data,
}: {
  data: { name: string; value: number; color: string }[];
}) {
  const { theme } = useTheme();
  const total = data.reduce((acc, item) => acc + item.value, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No token data available
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 h-full">
      <div className="w-24 h-24">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={25}
              outerRadius={40}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-1.5">
        {data.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-muted-foreground">{item.name}</span>
            </div>
            <span className="text-xs font-medium">
              {formatTokens(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageDashboard() {
  const { theme } = useTheme();
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('requests');
  const [activeTab, setActiveTab] = useState('overview');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin-stats', timeRange],
    queryFn: async () => {
      const res = await fetch(`/api/admin/stats?range=${timeRange}`);
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });

  const handleExport = () => {
    if (!data) return;

    // Export comprehensive data
    const exportData = {
      summary: data.kpi,
      timeSeriesData: data.dataOverTime,
      modelStats: data.modelStats,
      userStats: data.userStats,
      providerUsage: data.providerUsage,
      recentActivity: data.recentActivity,
    };

    // Time series CSV
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

    // Model stats CSV
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

    // Combine into a single file with sections
    const fullCsv = `=== USAGE SUMMARY ===
Time Range: ${timeRange}
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
${modelStatsCsv}`;

    const blob = new Blob([fullCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `virid_usage_report_${timeRange}_${new Date().toISOString().split('T')[0]}.csv`
    );
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Process Model Distribution Data for pie chart
  const { chartData: modelChartData, fullList: modelFullList } = useMemo(() => {
    if (!data?.modelDistribution) return { chartData: [], fullList: [] };

    const sorted = [...data.modelDistribution].sort(
      (a: any, b: any) => b.value - a.value
    );
    const top5 = sorted.slice(0, 5);
    const others = sorted.slice(5);
    const otherValue = others.reduce(
      (acc: number, curr: any) => acc + curr.value,
      0
    );
    const otherCost = others.reduce(
      (acc: number, curr: any) => acc + (curr.cost || 0),
      0
    );

    const chartData = [...top5];
    if (otherValue > 0) {
      chartData.push({
        name: 'Other models',
        value: otherValue,
        cost: otherCost,
        isOther: true,
      });
    }

    return { chartData, fullList: sorted };
  }, [data]);

  // Chart colors
  const axisColor = theme === 'dark' ? '#888888' : '#333333';
  const gridColor = theme === 'dark' ? '#333333' : '#e5e5e5';

  const chartDataKey = chartMetric === 'cost' ? 'cost' : chartMetric;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between">
          <Skeleton className="h-9 w-[180px]" />
          <Skeleton className="h-9 w-[140px]" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array(4)
            .fill(0)
            .map((_, i) => (
              <Skeleton key={i} className="h-[140px] rounded-xl" />
            ))}
        </div>
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    );
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
        <ButtonWithFeedback onClick={() => refetch()} variant="outline" size="sm">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Retry
        </ButtonWithFeedback>
      </div>
    );
  }

  const {
    kpi,
    dataOverTime,
    modelStats,
    providerUsage,
    userStats,
    tokenTypeDistribution,
    byokBreakdown,
    recentActivity,
  } = data;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Select
              value={timeRange}
              onValueChange={(v) => setTimeRange(v as TimeRange)}
            >
              <SelectTrigger className="w-[180px]">
                <Calendar className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 3 months</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCcw
                className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
          <ButtonWithFeedback
            variant="outline"
            size="sm"
            className="h-9"
            onClick={handleExport}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </ButtonWithFeedback>
        </div>

        {/* KPI Cards - Enhanced */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Total Requests"
            value={formatNumber(kpi.totalRequests)}
            subValue={`${formatNumber(kpi.avgTokensPerRequest)} avg tokens/request`}
            icon={Activity}
          />
          <KPICard
            title="Active Users"
            value={kpi.activeUsers}
            subValue={`${kpi.activeModels} models used`}
            icon={Users}
          />
          <KPICard
            title="Total Tokens"
            value={formatTokens(kpi.totalTokens.totalTokens)}
            subValue={`${kpi.cacheHitRate}% cache hit rate`}
            icon={Cpu}
          />
          <KPICard
            title="Total Cost"
            value={formatCost(kpi.totalCost)}
            subValue={`${formatCost(kpi.avgCostPerRequest)} avg per request`}
            icon={DollarSign}
            trend={kpi.costChange}
          />
        </div>

        {/* Token Type Breakdown */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Token Breakdown</CardTitle>
              <CardDescription>
                Distribution of token types in the selected period
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[100px]">
                <TokenBreakdownChart data={tokenTypeDistribution} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Key className="h-4 w-4" />
                API Key Usage
              </CardTitle>
              <CardDescription>Platform vs BYOK requests</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-primary" />
                    <span className="text-sm">Platform</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">
                      {byokBreakdown.platform.percentage}%
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({formatNumber(byokBreakdown.platform.requests)})
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-amber-500" />
                    <span className="text-sm">BYOK</span>
                  </div>
                  <div className="text-right">
                    <span className="font-medium">
                      {byokBreakdown.byok.percentage}%
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({formatNumber(byokBreakdown.byok.requests)})
                    </span>
                  </div>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${byokBreakdown.platform.percentage}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabbed Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
            <TabsTrigger value="overview" className="gap-2">
              <BarChart3 className="h-4 w-4" />
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
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">Activity</span>
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle>Usage Over Time</CardTitle>
                  <CardDescription>
                    Track your usage metrics over the selected period
                  </CardDescription>
                </div>
                <Select
                  value={chartMetric}
                  onValueChange={(v) => setChartMetric(v as ChartMetric)}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requests">Requests</SelectItem>
                    <SelectItem value="tokens">Tokens</SelectItem>
                    <SelectItem value="cost">Cost</SelectItem>
                    <SelectItem value="users">Users</SelectItem>
                  </SelectContent>
                </Select>
              </CardHeader>
              <CardContent>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dataOverTime}>
                      <defs>
                        <linearGradient
                          id="colorMetric"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#8884d8"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor="#8884d8"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridColor}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        stroke={axisColor}
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke={axisColor}
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) =>
                          chartMetric === 'cost'
                            ? `$${value}`
                            : formatNumber(value)
                        }
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor:
                            theme === 'dark' ? '#1f1f1f' : '#fff',
                          borderRadius: '8px',
                          border: `1px solid ${gridColor}`,
                        }}
                        formatter={(value) => [
                          chartMetric === 'cost'
                            ? formatCost(value as number)
                            : formatNumber(value as number),
                          chartMetric.charAt(0).toUpperCase() +
                          chartMetric.slice(1),
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey={chartDataKey}
                        stroke="#8884d8"
                        strokeWidth={2}
                        fill="url(#colorMetric)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Model Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Model Distribution</CardTitle>
                  <CardDescription>Requests by model</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex h-[280px] items-center gap-4">
                    <div className="h-full w-1/2 min-w-[140px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={modelChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            paddingAngle={2}
                            dataKey="value"
                          >
                            {modelChartData.map((entry: any, index: number) => {
                              const color = entry.isOther
                                ? OTHER_COLOR
                                : COLORS[index % COLORS.length];
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor:
                                theme === 'dark' ? '#1f1f1f' : '#fff',
                              borderRadius: '8px',
                              border: `1px solid ${gridColor}`,
                            }}
                            formatter={(value, name, props) => [
                              `${value} requests (${formatCost(props.payload?.cost || 0)})`,
                              name,
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ScrollArea className="h-full w-1/2 pr-4">
                      <div className="space-y-2.5 text-sm">
                        {modelFullList.map((model: any, index: number) => {
                          const isTop5 = index < 5;
                          const color = isTop5
                            ? COLORS[index]
                            : OTHER_COLOR;

                          return (
                            <div
                              key={model.name}
                              className="flex items-center justify-between"
                            >
                              <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                <div
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                                <span
                                  className="truncate text-xs"
                                  title={model.name}
                                >
                                  {model.name.split(':').pop()}
                                </span>
                              </div>
                              <div className="font-medium text-muted-foreground shrink-0 pl-2 text-xs">
                                {model.value}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </CardContent>
              </Card>

              {/* Provider Usage */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Provider Usage</CardTitle>
                  <CardDescription>Cost and requests by provider</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={providerUsage} layout="vertical">
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke={gridColor}
                          horizontal={true}
                          vertical={false}
                        />
                        <XAxis
                          type="number"
                          stroke={axisColor}
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => formatCost(value)}
                        />
                        <YAxis
                          dataKey="name"
                          type="category"
                          stroke={axisColor}
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          width={80}
                        />
                        <Tooltip
                          cursor={{ fill: 'transparent' }}
                          contentStyle={{
                            backgroundColor:
                              theme === 'dark' ? '#1f1f1f' : '#fff',
                            borderRadius: '8px',
                            border: `1px solid ${gridColor}`,
                          }}
                          formatter={(value, _name, props) => [
                            `${formatCost(value as number)} (${formatNumber(props.payload?.requests || 0)} requests)`,
                            'Cost',
                          ]}
                        />
                        <Bar
                          dataKey="cost"
                          fill="#8884d8"
                          radius={[0, 4, 4, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Models Tab */}
          <TabsContent value="models" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Model Statistics</CardTitle>
                <CardDescription>
                  Detailed breakdown of usage and costs per model
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 bg-background">
                          Model
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Requests
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Input
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Output
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Reasoning
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Cached
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Avg/Req
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Cost
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          BYOK
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modelStats.map((model: any) => (
                        <TableRow key={model.name}>
                          <TableCell className="font-medium">
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help truncate max-w-[200px] block">
                                  {model.name.split(':').pop()}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{model.name}</p>
                              </TooltipContent>
                            </UITooltip>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(model.requests)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTokens(model.tokens.inputTokens)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTokens(model.tokens.outputTokens)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {model.tokens.reasoningTokens > 0
                              ? formatTokens(model.tokens.reasoningTokens)
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {model.tokens.cachedInputTokens > 0
                              ? formatTokens(model.tokens.cachedInputTokens)
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatTokens(model.avgTokensPerRequest)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCost(model.cost.totalCost)}
                          </TableCell>
                          <TableCell className="text-right">
                            {model.byokRequests > 0 ? (
                              <Badge variant="secondary" className="text-xs">
                                {model.byokRequests}
                              </Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Top Users by Cost</CardTitle>
                <CardDescription>
                  Most active users in the selected period
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 bg-background">
                          User
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Requests
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Total Tokens
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Cost
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Models
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          BYOK
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background">
                          Last Active
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {userStats.map((user: any) => (
                        <TableRow key={user.userId}>
                          <TableCell className="font-medium">
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help truncate max-w-[180px] block">
                                  {user.email || user.userId}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{user.userId}</p>
                                {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                              </TooltipContent>
                            </UITooltip>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatNumber(user.requests)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTokens(user.tokens.totalTokens)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCost(user.cost.totalCost)}
                          </TableCell>
                          <TableCell className="text-right">
                            {user.models.length}
                          </TableCell>
                          <TableCell className="text-right">
                            {user.byokRequests > 0 ? (
                              <Badge variant="secondary" className="text-xs">
                                {user.byokRequests}
                              </Badge>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(user.lastActive).toLocaleDateString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>
                  Latest token usage records
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 bg-background">
                          User
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background">
                          Model
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Input
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Output
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Total
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background text-right">
                          Cost
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background">
                          Type
                        </TableHead>
                        <TableHead className="sticky top-0 bg-background">
                          Time
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentActivity.map((activity: any) => (
                        <TableRow key={activity.id}>
                          <TableCell className="font-medium">
                            <span
                              className="truncate max-w-[120px] block"
                              title={activity.user}
                            >
                              {activity.user.split('@')[0]}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="truncate max-w-[140px] block text-muted-foreground"
                              title={activity.model}
                            >
                              {activity.model.split(':').pop()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTokens(activity.inputTokens)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTokens(activity.outputTokens)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatTokens(activity.totalTokens)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCost(activity.cost)}
                          </TableCell>
                          <TableCell>
                            {activity.byok ? (
                              <Badge variant="outline" className="text-xs">
                                BYOK
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">
                                Platform
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {new Date(activity.timestamp).toLocaleTimeString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}
