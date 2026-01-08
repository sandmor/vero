'use client';

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Sparkline } from './charts';

interface KPICardProps {
  title: string;
  value: string | number;
  subValue?: string;
  icon: LucideIcon;
  trend?: number;
  trendLabel?: string;
  sparklineData?: number[];
  loading?: boolean;
  animate?: boolean;
  delay?: number;
  className?: string;
}

export function KPICard({
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  trendLabel,
  sparklineData,
  loading = false,
  animate = true,
  delay = 0,
  className,
}: KPICardProps) {
  const isPositiveTrend = trend !== undefined && trend > 0;
  const TrendIcon = isPositiveTrend ? TrendingUp : TrendingDown;

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4 rounded" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-20 mb-1" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  const content = (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-bold">{value}</div>
            {subValue && (
              <p className="text-xs text-muted-foreground mt-1">{subValue}</p>
            )}
            {trend !== undefined && (
              <div
                className={cn(
                  'flex items-center text-xs mt-2',
                  // For costs, up is bad (red), down is good (green)
                  // This can be inverted based on the metric
                  isPositiveTrend ? 'text-red-500' : 'text-green-500'
                )}
              >
                <TrendIcon className="h-3 w-3 mr-1" />
                {Math.abs(trend).toFixed(1)}%{' '}
                {trendLabel || 'vs previous period'}
              </div>
            )}
          </div>
          {sparklineData && sparklineData.length > 0 && (
            <div className="opacity-60">
              <Sparkline data={sparklineData} height={40} width={80} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (!animate) return content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      {content}
    </motion.div>
  );
}

// Grid of KPI cards
interface KPIGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

export function KPIGrid({ children, columns = 4, className }: KPIGridProps) {
  const gridCols = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-2 lg:grid-cols-4',
    5: 'md:grid-cols-3 lg:grid-cols-5',
  };

  return (
    <div className={cn('grid gap-4', gridCols[columns], className)}>
      {children}
    </div>
  );
}

// Stat badge for inline stats
interface StatBadgeProps {
  label: string;
  value: string | number;
  color?: 'default' | 'success' | 'warning' | 'danger';
  className?: string;
}

export function StatBadge({
  label,
  value,
  color = 'default',
  className,
}: StatBadgeProps) {
  const colorClasses = {
    default: 'bg-muted text-muted-foreground',
    success: 'bg-green-500/10 text-green-600 dark:text-green-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
        colorClasses[color],
        className
      )}
    >
      <span className="opacity-70">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

// Progress stat bar
interface ProgressStatProps {
  label: string;
  value: number;
  total: number;
  formatValue?: (value: number) => string;
  color?: string;
  showPercentage?: boolean;
  className?: string;
}

export function ProgressStat({
  label,
  value,
  total,
  formatValue = (v) => v.toLocaleString(),
  color = 'var(--primary)',
  showPercentage = true,
  className,
}: ProgressStatProps) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-medium">{formatValue(value)}</span>
          {showPercentage && (
            <span className="text-muted-foreground text-xs">
              ({percentage.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%`, backgroundColor: color }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// Mini stat display
interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  className?: string;
}

export function MiniStat({
  label,
  value,
  icon: Icon,
  className,
}: MiniStatProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

// Comparison stat
interface ComparisonStatProps {
  label: string;
  current: number;
  previous: number;
  formatValue?: (value: number) => string;
  invertTrend?: boolean; // If true, decrease is good (e.g., for costs)
  className?: string;
}

export function ComparisonStat({
  label,
  current,
  previous,
  formatValue = (v) => v.toLocaleString(),
  invertTrend = false,
  className,
}: ComparisonStatProps) {
  const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
  const isPositive = change > 0;
  const isGood = invertTrend ? !isPositive : isPositive;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  return (
    <div className={cn('space-y-1', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">{formatValue(current)}</span>
        {change !== 0 && (
          <div
            className={cn(
              'flex items-center text-xs',
              isGood ? 'text-green-500' : 'text-red-500'
            )}
          >
            <TrendIcon className="h-3 w-3 mr-0.5" />
            {Math.abs(change).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
