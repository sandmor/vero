'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreatorLogo } from '@/components/creator-logo';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    TimeSeriesChart,
    DonutChart,
    HorizontalBarChart,
    TokenStackedBar,
    formatCost,
    formatTokens,
    formatNumber,
    CHART_COLORS,
    TOKEN_TYPE_COLORS,
} from './charts';
import type { WidgetConfig, MetricType, ChartType } from './dashboard-config';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

// Types matching the API response
interface TokenBreakdown {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
}

interface ModelStat {
    id: string;
    name: string;
    creator: string;
    creatorName: string;
    requests: number;
    tokens: TokenBreakdown;
    cost: {
        inputCost: number;
        outputCost: number;
        reasoningCost: number;
        cachedInputCost: number;
        extrasCost: number;
        totalCost: number;
    };
    byokRequests: number;
    avgTokensPerRequest: number;
}

interface TimeSeriesDataPoint {
    name: string;
    requests: number;
    users: number;
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
}

interface ModelDistributionItem {
    id: string;
    name: string;
    creator: string;
    creatorName: string;
    value: number;
    cost: number;
    tokens: number;
}

interface ProviderUsageItem {
    id: string;
    name: string;
    requests: number;
    tokens: number;
    cost: number;
    byokRequests: number;
}

// Base widget wrapper with animation
interface WidgetWrapperProps {
    widget: WidgetConfig;
    children: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
}

export function WidgetWrapper({ widget, children, actions, className }: WidgetWrapperProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: widget.order * 0.05 }}
            className={className}
        >
            <Card className="h-full">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <CardTitle className="text-base">{widget.title}</CardTitle>
                    </div>
                    {actions}
                </CardHeader>
                <CardContent>{children}</CardContent>
            </Card>
        </motion.div>
    );
}

// Time Series Widget
interface TimeSeriesWidgetProps {
    widget: WidgetConfig;
    data: TimeSeriesDataPoint[];
    modelData?: Record<string, TimeSeriesDataPoint[]>;
    onMetricChange?: (metric: MetricType) => void;
    onChartTypeChange?: (chartType: ChartType) => void;
}

export function TimeSeriesWidget({
    widget,
    data,
    modelData,
    onMetricChange,
    onChartTypeChange,
}: TimeSeriesWidgetProps) {
    const metric = widget.settings.metric || 'requests';
    const chartType = widget.settings.chartType || 'area';
    const splitByModel = widget.settings.splitByModel && modelData;
    const limit = widget.settings.limit || 5;

    // Prepare data keys based on configuration
    const dataKeys = useMemo(() => {
        if (splitByModel && modelData) {
            const modelNames = Object.keys(modelData).slice(0, limit);
            return modelNames.map((name, index) => ({
                key: name,
                name: name,
                color: CHART_COLORS[index % CHART_COLORS.length],
            }));
        }

        return [
            {
                key: metric,
                name: metric.charAt(0).toUpperCase() + metric.slice(1),
                color: CHART_COLORS[0],
            },
        ];
    }, [metric, splitByModel, modelData, limit]);

    // Transform data for split by model view
    const chartData = useMemo((): Array<Record<string, string | number>> => {
        if (splitByModel && modelData) {
            const modelNames = Object.keys(modelData).slice(0, limit);
            return data.map((point) => {
                const result: Record<string, string | number> = { name: point.name };
                modelNames.forEach((modelName) => {
                    const modelPoints = modelData[modelName];
                    const matchingPoint = modelPoints?.find((p) => p.name === point.name);
                    result[modelName] = matchingPoint
                        ? metric === 'cost'
                            ? matchingPoint.cost
                            : metric === 'tokens'
                                ? matchingPoint.tokens
                                : matchingPoint.requests
                        : 0;
                });
                return result;
            });
        }
        return data.map((d) => ({ ...d } as Record<string, string | number>));
    }, [data, modelData, splitByModel, metric, limit]);

    const yAxisFormatter = metric === 'cost' ? (v: number) => `$${v}` : formatNumber;
    const tooltipFormatter = (value: number, name: string): [string, string] => {
        if (metric === 'cost') return [formatCost(value), name];
        if (metric === 'tokens') return [formatTokens(value), name];
        return [formatNumber(value), name];
    };

    return (
        <WidgetWrapper
            widget={widget}
            actions={
                <div className="flex gap-2">
                    {onMetricChange && (
                        <Select value={metric} onValueChange={(v) => onMetricChange(v as MetricType)}>
                            <SelectTrigger className="w-[110px] h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="requests">Requests</SelectItem>
                                <SelectItem value="tokens">Tokens</SelectItem>
                                <SelectItem value="cost">Cost</SelectItem>
                                <SelectItem value="users">Users</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                    {onChartTypeChange && (
                        <Select value={chartType} onValueChange={(v) => onChartTypeChange(v as ChartType)}>
                            <SelectTrigger className="w-[100px] h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="area">Area</SelectItem>
                                <SelectItem value="line">Line</SelectItem>
                                <SelectItem value="bar">Bar</SelectItem>
                            </SelectContent>
                        </Select>
                    )}
                </div>
            }
        >
            <div className="h-[350px]">
                <TimeSeriesChart
                    data={chartData as any}
                    dataKeys={dataKeys}
                    chartType={chartType}
                    stacked={widget.settings.stacked}
                    yAxisFormatter={yAxisFormatter}
                    tooltipFormatter={tooltipFormatter}
                />
            </div>
        </WidgetWrapper>
    );
}

// Token Breakdown Widget
interface TokenBreakdownWidgetProps {
    widget: WidgetConfig;
    totalTokens: TokenBreakdown;
}

export function TokenBreakdownWidget({ widget, totalTokens }: TokenBreakdownWidgetProps) {
    const pieData = useMemo(
        () =>
            [
                { name: 'Input', value: totalTokens.inputTokens, color: TOKEN_TYPE_COLORS.input },
                { name: 'Output', value: totalTokens.outputTokens, color: TOKEN_TYPE_COLORS.output },
                { name: 'Reasoning', value: totalTokens.reasoningTokens, color: TOKEN_TYPE_COLORS.reasoning },
                { name: 'Cached', value: totalTokens.cachedInputTokens, color: TOKEN_TYPE_COLORS.cached },
            ].filter((t) => t.value > 0),
        [totalTokens]
    );

    return (
        <WidgetWrapper widget={widget}>
            <div className="space-y-4">
                <TokenStackedBar
                    inputTokens={totalTokens.inputTokens}
                    outputTokens={totalTokens.outputTokens}
                    reasoningTokens={totalTokens.reasoningTokens}
                    cachedTokens={totalTokens.cachedInputTokens}
                />
                <div className="h-[200px]">
                    <DonutChart
                        data={pieData}
                        innerRadius={40}
                        outerRadius={70}
                        showLegend={false}
                        tooltipFormatter={(value, name) => [formatTokens(value), `${name} Tokens`]}
                    />
                </div>
            </div>
        </WidgetWrapper>
    );
}

// Model Distribution Widget
interface ModelDistributionWidgetProps {
    widget: WidgetConfig;
    data: ModelDistributionItem[];
    onMetricChange?: (metric: MetricType) => void;
}

export function ModelDistributionWidget({
    widget,
    data,
    onMetricChange,
}: ModelDistributionWidgetProps) {
    const metric = widget.settings.metric || 'requests';
    const [showOthers, setShowOthers] = useState(false);

    const { chartData, otherModels, hasOthers } = useMemo(() => {
        const sorted = [...data].sort((a, b) => {
            const aValue = metric === 'cost' ? a.cost : metric === 'tokens' ? a.tokens : a.value;
            const bValue = metric === 'cost' ? b.cost : metric === 'tokens' ? b.tokens : b.value;
            return bValue - aValue;
        });

        const top5 = sorted.slice(0, 5);
        const others = sorted.slice(5);

        const result = top5.map((item, index) => ({
            ...item,
            displayValue: metric === 'cost' ? item.cost : metric === 'tokens' ? item.tokens : item.value,
            color: CHART_COLORS[index % CHART_COLORS.length],
            isOther: false,
        }));

        if (others.length > 0) {
            const otherValue = others.reduce((acc, item) => {
                return acc + (metric === 'cost' ? item.cost : metric === 'tokens' ? item.tokens : item.value);
            }, 0);

            result.push({
                id: 'others',
                name: `Other (${others.length})`,
                creator: '',
                creatorName: '',
                value: metric === 'requests' ? otherValue : 0,
                cost: metric === 'cost' ? otherValue : 0,
                tokens: metric === 'tokens' ? otherValue : 0,
                displayValue: otherValue,
                color: CHART_COLORS[5 % CHART_COLORS.length],
                isOther: true,
            });
        }

        // Prepare other models with their display values
        const otherWithValues = others.map((item, index) => ({
            ...item,
            displayValue: metric === 'cost' ? item.cost : metric === 'tokens' ? item.tokens : item.value,
            color: CHART_COLORS[(6 + index) % CHART_COLORS.length],
        }));

        return { chartData: result, otherModels: otherWithValues, hasOthers: others.length > 0 };
    }, [data, metric]);

    return (
        <WidgetWrapper
            widget={widget}
            actions={
                onMetricChange && (
                    <Select value={metric} onValueChange={(v) => onMetricChange(v as MetricType)}>
                        <SelectTrigger className="w-[100px] h-8">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="requests">Requests</SelectItem>
                            <SelectItem value="tokens">Tokens</SelectItem>
                            <SelectItem value="cost">Cost</SelectItem>
                        </SelectContent>
                    </Select>
                )
            }
        >
            <div className="flex h-[280px] items-center gap-4">
                <div className="h-full w-1/2 min-w-[140px]">
                    <DonutChart
                        data={chartData.map((d) => ({
                            name: d.name,
                            value: d.displayValue,
                            color: d.color,
                        }))}
                        showLegend={false}
                        tooltipFormatter={(value, name, payload) => {
                            if (metric === 'cost') return [formatCost(value), name];
                            if (metric === 'tokens') return [formatTokens(value), name];
                            return [formatNumber(value), name];
                        }}
                    />
                </div>
                <ScrollArea className="h-full w-1/2 pr-4">
                    <div className="space-y-2.5 text-sm">
                        {chartData.map((model) => (
                            <div key={model.id}>
                                <div
                                    className={`flex items-center justify-between ${model.isOther && hasOthers ? 'cursor-pointer hover:bg-muted/50 rounded-md -mx-1 px-1' : ''}`}
                                    onClick={model.isOther ? () => setShowOthers(!showOthers) : undefined}
                                >
                                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                        <div
                                            className="h-2.5 w-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: model.color }}
                                        />
                                        {model.creator && (
                                            <CreatorLogo creatorSlug={model.creator} size={12} className="shrink-0" />
                                        )}
                                        <span className="truncate text-xs" title={model.id}>
                                            {model.name}
                                        </span>
                                        {model.isOther && (
                                            <span className="text-muted-foreground">
                                                {showOthers ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                            </span>
                                        )}
                                    </div>
                                    <div className="font-medium text-muted-foreground shrink-0 pl-2 text-xs">
                                        {metric === 'cost'
                                            ? formatCost(model.cost)
                                            : metric === 'tokens'
                                                ? formatTokens(model.tokens)
                                                : formatNumber(model.value)}
                                    </div>
                                </div>
                                {/* Expandable "Other" models list */}
                                <AnimatePresence>
                                    {model.isOther && showOthers && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden"
                                        >
                                            <div className="ml-4 mt-2 space-y-1.5 border-l-2 border-muted pl-3">
                                                {otherModels.map((other) => (
                                                    <div key={other.id} className="flex items-center justify-between text-xs">
                                                        <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                                                            {other.creator && (
                                                                <CreatorLogo creatorSlug={other.creator} size={10} className="shrink-0" />
                                                            )}
                                                            <span className="truncate text-muted-foreground" title={other.id}>
                                                                {other.name}
                                                            </span>
                                                        </div>
                                                        <div className="text-muted-foreground shrink-0 pl-2">
                                                            {metric === 'cost'
                                                                ? formatCost(other.cost)
                                                                : metric === 'tokens'
                                                                    ? formatTokens(other.tokens)
                                                                    : formatNumber(other.value)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </div>
        </WidgetWrapper>
    );
}

// Provider Usage Widget
interface ProviderUsageWidgetProps {
    widget: WidgetConfig;
    data: ProviderUsageItem[];
}

export function ProviderUsageWidget({ widget, data }: ProviderUsageWidgetProps) {
    const chartData = useMemo(
        () =>
            data.map((item) => ({
                name: item.name,
                value: item.cost,
                requests: item.requests,
                tokens: item.tokens,
            })),
        [data]
    );

    return (
        <WidgetWrapper widget={widget}>
            <div className="h-[280px]">
                <HorizontalBarChart
                    data={chartData}
                    tooltipFormatter={(value, _name, payload) => [
                        `${formatCost(value)} (${formatNumber(payload?.requests || 0)} requests)`,
                        'Cost',
                    ]}
                />
            </div>
        </WidgetWrapper>
    );
}

// BYOK Usage Widget
interface BYOKBreakdown {
    platform: { requests: number; cost: number; percentage: number };
    byok: { requests: number; cost: number; percentage: number };
}

interface BYOKWidgetProps {
    widget: WidgetConfig;
    data: BYOKBreakdown;
}

export function BYOKWidget({ widget, data }: BYOKWidgetProps) {
    return (
        <WidgetWrapper widget={widget}>
            <div className="space-y-4">
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full bg-primary" />
                            <span className="text-sm">Platform</span>
                        </div>
                        <div className="text-right">
                            <span className="font-medium">{data.platform.percentage}%</span>
                            <span className="text-xs text-muted-foreground ml-2">
                                ({formatNumber(data.platform.requests)} requests)
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full bg-amber-500" />
                            <span className="text-sm">BYOK</span>
                        </div>
                        <div className="text-right">
                            <span className="font-medium">{data.byok.percentage}%</span>
                            <span className="text-xs text-muted-foreground ml-2">
                                ({formatNumber(data.byok.requests)} requests)
                            </span>
                        </div>
                    </div>
                </div>
                <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                    <motion.div
                        className="h-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${data.platform.percentage}%` }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="text-center">
                        <p className="text-lg font-semibold">{formatCost(data.platform.cost)}</p>
                        <p className="text-xs text-muted-foreground">Platform Cost</p>
                    </div>
                    <div className="text-center">
                        <p className="text-lg font-semibold">{formatCost(data.byok.cost)}</p>
                        <p className="text-xs text-muted-foreground">BYOK Cost</p>
                    </div>
                </div>
            </div>
        </WidgetWrapper>
    );
}
