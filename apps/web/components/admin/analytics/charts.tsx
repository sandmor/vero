'use client';

import { useMemo } from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Chart color palette using theme variables
export const CHART_COLORS = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
    '#8884d8',
    '#82ca9d',
    '#ffc658',
    '#ff8042',
    '#0088FE',
];

export const TOKEN_TYPE_COLORS = {
    input: '#8884d8',
    output: '#82ca9d',
    reasoning: '#ffc658',
    cached: '#ff8042',
};

// Formatters
export function formatNumber(num: number): string {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return num.toLocaleString();
}

export function formatCost(cost: number): string {
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    if (cost >= 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(6)}`;
}

export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return tokens.toLocaleString();
}

// Common chart props
interface BaseChartProps {
    className?: string;
    height?: number;
    animate?: boolean;
}

// Hook to get theme-aware colors
export function useChartColors() {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    return useMemo(
        () => ({
            axis: isDark ? '#888888' : '#333333',
            grid: isDark ? '#333333' : '#e5e5e5',
            tooltip: {
                background: isDark ? '#1f1f1f' : '#fff',
                border: isDark ? '#333333' : '#e5e5e5',
            },
        }),
        [isDark]
    );
}

// Custom tooltip component
interface CustomTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    formatter?: (value: number, name: string) => [string, string];
}

export function CustomTooltip({ active, payload, label, formatter }: CustomTooltipProps) {
    const colors = useChartColors();

    if (!active || !payload?.length) return null;

    return (
        <div
            className="rounded-lg border px-3 py-2 shadow-md"
            style={{
                backgroundColor: colors.tooltip.background,
                borderColor: colors.tooltip.border,
            }}
        >
            <p className="text-sm font-medium mb-1">{label}</p>
            {payload.map((entry, index) => {
                const [value, name] = formatter
                    ? formatter(entry.value, entry.name)
                    : [formatNumber(entry.value), entry.name];
                return (
                    <div key={index} className="flex items-center gap-2 text-sm">
                        <div
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">{name}:</span>
                        <span className="font-medium">{value}</span>
                    </div>
                );
            })}
        </div>
    );
}

// Animation wrapper
interface AnimatedChartWrapperProps {
    children: React.ReactNode;
    animate?: boolean;
    delay?: number;
}

export function AnimatedChartWrapper({ children, animate = true, delay = 0 }: AnimatedChartWrapperProps) {
    if (!animate) return <>{children}</>;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
        >
            {children}
        </motion.div>
    );
}

// Chart Card wrapper for consistent styling
interface ChartCardProps extends BaseChartProps {
    title: string;
    description?: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
}

export function ChartCard({ title, description, children, actions, className, height = 300, animate = true }: ChartCardProps) {
    return (
        <AnimatedChartWrapper animate={animate}>
            <Card className={className}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <div>
                        <CardTitle className="text-base">{title}</CardTitle>
                        {description && <CardDescription>{description}</CardDescription>}
                    </div>
                    {actions}
                </CardHeader>
                <CardContent>
                    <div style={{ height }}>{children}</div>
                </CardContent>
            </Card>
        </AnimatedChartWrapper>
    );
}

// Time Series Area Chart
interface TimeSeriesData {
    name: string;
    [key: string]: string | number;
}

interface TimeSeriesChartProps extends BaseChartProps {
    data: TimeSeriesData[];
    dataKeys: { key: string; name: string; color?: string }[];
    yAxisFormatter?: (value: number) => string;
    tooltipFormatter?: (value: number, name: string) => [string, string];
    stacked?: boolean;
    chartType?: 'area' | 'line' | 'bar';
}

export function TimeSeriesChart({
    data,
    dataKeys,
    height = 350,
    yAxisFormatter = formatNumber,
    tooltipFormatter,
    stacked = false,
    chartType = 'area',
}: TimeSeriesChartProps) {
    const colors = useChartColors();

    const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;

    return (
        <ResponsiveContainer width="100%" height={height}>
            <ChartComponent data={data}>
                <defs>
                    {dataKeys.map((dk, index) => (
                        <linearGradient key={dk.key} id={`gradient-${dk.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop
                                offset="5%"
                                stopColor={dk.color || CHART_COLORS[index % CHART_COLORS.length]}
                                stopOpacity={0.3}
                            />
                            <stop
                                offset="95%"
                                stopColor={dk.color || CHART_COLORS[index % CHART_COLORS.length]}
                                stopOpacity={0}
                            />
                        </linearGradient>
                    ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
                <XAxis
                    dataKey="name"
                    stroke={colors.axis}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                />
                <YAxis
                    stroke={colors.axis}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={yAxisFormatter}
                />
                <Tooltip
                    content={<CustomTooltip formatter={tooltipFormatter} />}
                />
                {dataKeys.length > 1 && (
                    <Legend
                        verticalAlign="top"
                        height={36}
                        iconType="circle"
                        iconSize={8}
                    />
                )}
                {dataKeys.map((dk, index) => {
                    const color = dk.color || CHART_COLORS[index % CHART_COLORS.length];

                    if (chartType === 'bar') {
                        return (
                            <Bar
                                key={dk.key}
                                dataKey={dk.key}
                                name={dk.name}
                                fill={color}
                                radius={[4, 4, 0, 0]}
                                stackId={stacked ? 'stack' : undefined}
                            />
                        );
                    }

                    if (chartType === 'line') {
                        return (
                            <Line
                                key={dk.key}
                                type="monotone"
                                dataKey={dk.key}
                                name={dk.name}
                                stroke={color}
                                strokeWidth={2}
                                dot={false}
                                activeDot={{ r: 4 }}
                            />
                        );
                    }

                    return (
                        <Area
                            key={dk.key}
                            type="monotone"
                            dataKey={dk.key}
                            name={dk.name}
                            stroke={color}
                            strokeWidth={2}
                            fill={`url(#gradient-${dk.key})`}
                            stackId={stacked ? 'stack' : undefined}
                        />
                    );
                })}
            </ChartComponent>
        </ResponsiveContainer>
    );
}

// Pie/Donut Chart
interface PieChartData {
    name: string;
    value: number;
    color?: string;
    [key: string]: any;
}

interface DonutChartProps extends BaseChartProps {
    data: PieChartData[];
    innerRadius?: number;
    outerRadius?: number;
    showLegend?: boolean;
    tooltipFormatter?: (value: number, name: string, payload: any) => [string, string];
}

export function DonutChart({
    data,
    height = 280,
    innerRadius = 50,
    outerRadius = 80,
    showLegend = true,
    tooltipFormatter,
}: DonutChartProps) {
    const colors = useChartColors();

    return (
        <ResponsiveContainer width="100%" height={height}>
            <PieChart>
                <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={innerRadius}
                    outerRadius={outerRadius}
                    paddingAngle={2}
                    dataKey="value"
                    animationBegin={0}
                    animationDuration={800}
                >
                    {data.map((entry, index) => (
                        <Cell
                            key={`cell-${index}`}
                            fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]}
                        />
                    ))}
                </Pie>
                <Tooltip
                    content={
                        <CustomTooltip
                            formatter={
                                tooltipFormatter
                                    ? (value, name) => tooltipFormatter(value, name, data.find((d) => d.name === name))
                                    : undefined
                            }
                        />
                    }
                />
                {showLegend && (
                    <Legend
                        verticalAlign="bottom"
                        height={36}
                        iconType="circle"
                        iconSize={8}
                    />
                )}
            </PieChart>
        </ResponsiveContainer>
    );
}

// Horizontal Bar Chart
interface HorizontalBarData {
    name: string;
    value: number;
    [key: string]: any;
}

interface HorizontalBarChartProps extends BaseChartProps {
    data: HorizontalBarData[];
    dataKey?: string;
    fill?: string;
    yAxisWidth?: number;
    tooltipFormatter?: (value: number, name: string, payload: any) => [string, string];
}

export function HorizontalBarChart({
    data,
    height = 280,
    dataKey = 'value',
    fill = CHART_COLORS[0],
    yAxisWidth = 80,
    tooltipFormatter,
}: HorizontalBarChartProps) {
    const colors = useChartColors();

    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} horizontal vertical={false} />
                <XAxis
                    type="number"
                    stroke={colors.axis}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatNumber}
                />
                <YAxis
                    dataKey="name"
                    type="category"
                    stroke={colors.axis}
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    width={yAxisWidth}
                />
                <Tooltip
                    cursor={{ fill: 'transparent' }}
                    content={
                        <CustomTooltip
                            formatter={
                                tooltipFormatter
                                    ? (value, name) => tooltipFormatter(value, name, data.find((d) => d.name === name))
                                    : undefined
                            }
                        />
                    }
                />
                <Bar
                    dataKey={dataKey}
                    fill={fill}
                    radius={[0, 4, 4, 0]}
                    animationDuration={800}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

// Stacked token breakdown bar
interface TokenStackedBarProps extends BaseChartProps {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedTokens: number;
}

export function TokenStackedBar({
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    height = 24,
}: TokenStackedBarProps) {
    const total = inputTokens + outputTokens + reasoningTokens + cachedTokens;
    if (total === 0) return null;

    const segments = [
        { label: 'Input', value: inputTokens, color: TOKEN_TYPE_COLORS.input },
        { label: 'Output', value: outputTokens, color: TOKEN_TYPE_COLORS.output },
        { label: 'Reasoning', value: reasoningTokens, color: TOKEN_TYPE_COLORS.reasoning },
        { label: 'Cached', value: cachedTokens, color: TOKEN_TYPE_COLORS.cached },
    ].filter((s) => s.value > 0);

    return (
        <div className="space-y-1">
            <div
                className="flex w-full overflow-hidden rounded-full"
                style={{ height }}
            >
                {segments.map((segment) => (
                    <motion.div
                        key={segment.label}
                        className="h-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        title={`${segment.label}: ${formatTokens(segment.value)}`}
                    />
                ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {segments.map((segment) => (
                    <div key={segment.label} className="flex items-center gap-1.5">
                        <div
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: segment.color }}
                        />
                        <span className="text-muted-foreground">{segment.label}</span>
                        <span className="font-medium">{formatTokens(segment.value)}</span>
                        <span className="text-muted-foreground">
                            ({((segment.value / total) * 100).toFixed(1)}%)
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Mini sparkline chart
interface SparklineProps {
    data: number[];
    color?: string;
    height?: number;
    width?: number;
}

export function Sparkline({ data, color = CHART_COLORS[0], height = 40, width = 100 }: SparklineProps) {
    const chartData = data.map((value, index) => ({ value, index }));

    return (
        <ResponsiveContainer width={width} height={height}>
            <AreaChart data={chartData}>
                <defs>
                    <linearGradient id="sparklineGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <Area
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={1.5}
                    fill="url(#sparklineGradient)"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
