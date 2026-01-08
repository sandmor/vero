'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  Eye,
  EyeOff,
  GripVertical,
  RotateCcw,
  RefreshCw,
  Maximize2,
  Minimize2,
  BarChart3,
  LineChart,
  AreaChartIcon,
  PieChartIcon,
  TableIcon,
  Loader2,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useDashboardConfig,
  type WidgetConfig,
  type ChartType,
  type MetricType,
} from './dashboard-config';
import { cn } from '@/lib/utils';

const chartTypeIcons: Record<string, React.ElementType> = {
  area: AreaChartIcon,
  line: LineChart,
  bar: BarChart3,
  pie: PieChartIcon,
  table: TableIcon,
};

const chartTypeLabels: Record<string, string> = {
  area: 'Area Chart',
  line: 'Line Chart',
  bar: 'Bar Chart',
};

const metricLabels: Record<MetricType, string> = {
  requests: 'Requests',
  tokens: 'Tokens',
  cost: 'Cost',
  users: 'Users',
};

const sizeLabels: Record<WidgetConfig['size'], string> = {
  small: 'Small (1 col)',
  medium: 'Medium (2 cols)',
  large: 'Large (3 cols)',
  full: 'Full Width',
};

interface WidgetConfigItemProps {
  widget: WidgetConfig;
  onToggle: () => void;
  onUpdate: (updates: Partial<WidgetConfig>) => void;
}

function WidgetConfigItem({
  widget,
  onToggle,
  onUpdate,
}: WidgetConfigItemProps) {
  const [expanded, setExpanded] = useState(false);
  const IconComponent =
    chartTypeIcons[widget.settings.chartType || widget.type] || BarChart3;

  return (
    <motion.div
      layout
      className={cn(
        'rounded-lg border p-3 transition-colors',
        widget.visible ? 'bg-card' : 'bg-muted/50 opacity-60'
      )}
    >
      <div className="flex items-center gap-3">
        <button className="cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-4 w-4" />
        </button>

        <IconComponent className="h-4 w-4 text-muted-foreground" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{widget.title}</p>
          <p className="text-xs text-muted-foreground">
            {widget.type} • {sizeLabels[widget.size]}
          </p>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onToggle}
              >
                {widget.visible ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {widget.visible ? 'Hide widget' : 'Show widget'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <Separator className="my-3" />
            <div className="space-y-3">
              {/* Size selector */}
              <div className="space-y-1.5">
                <Label className="text-xs">Size</Label>
                <Select
                  value={widget.size}
                  onValueChange={(value) =>
                    onUpdate({ size: value as WidgetConfig['size'] })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Small (1 col)</SelectItem>
                    <SelectItem value="medium">Medium (2 cols)</SelectItem>
                    <SelectItem value="large">Large (3 cols)</SelectItem>
                    <SelectItem value="full">Full Width</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Chart type selector for time-series */}
              {widget.type === 'time-series' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Chart Type</Label>
                  <Select
                    value={widget.settings.chartType || 'area'}
                    onValueChange={(value) =>
                      onUpdate({
                        settings: {
                          ...widget.settings,
                          chartType: value as ChartType,
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="area">Area Chart</SelectItem>
                      <SelectItem value="line">Line Chart</SelectItem>
                      <SelectItem value="bar">Bar Chart</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Metric selector */}
              {(widget.type === 'time-series' || widget.type === 'pie') &&
                widget.settings.metric !== undefined && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Metric</Label>
                    <Select
                      value={widget.settings.metric}
                      onValueChange={(value) =>
                        onUpdate({
                          settings: {
                            ...widget.settings,
                            metric: value as MetricType,
                          },
                        })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="requests">Requests</SelectItem>
                        <SelectItem value="tokens">Tokens</SelectItem>
                        <SelectItem value="cost">Cost</SelectItem>
                        <SelectItem value="users">Users</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

              {/* Stacked toggle */}
              {widget.type === 'time-series' &&
                widget.settings.splitByModel && (
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Stacked</Label>
                    <Switch
                      checked={widget.settings.stacked || false}
                      onCheckedChange={(checked) =>
                        onUpdate({
                          settings: { ...widget.settings, stacked: checked },
                        })
                      }
                    />
                  </div>
                )}

              {/* Show legend toggle */}
              {widget.type === 'pie' && (
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Show Legend</Label>
                  <Switch
                    checked={widget.settings.showLegend !== false}
                    onCheckedChange={(checked) =>
                      onUpdate({
                        settings: { ...widget.settings, showLegend: checked },
                      })
                    }
                  />
                </div>
              )}

              {/* Limit selector for tables */}
              {widget.type === 'table' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Rows to Show</Label>
                  <Select
                    value={String(widget.settings.limit || 20)}
                    onValueChange={(value) =>
                      onUpdate({
                        settings: {
                          ...widget.settings,
                          limit: parseInt(value),
                        },
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 rows</SelectItem>
                      <SelectItem value="20">20 rows</SelectItem>
                      <SelectItem value="50">50 rows</SelectItem>
                      <SelectItem value="100">100 rows</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface DashboardConfiguratorProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function DashboardConfigurator({
  onRefresh,
  isRefreshing,
}: DashboardConfiguratorProps) {
  const {
    config,
    isLoading,
    isSaving,
    updateWidget,
    toggleWidget,
    resetToDefaults,
    setShowKPIs,
    setAutoRefresh,
    setRefreshInterval,
  } = useDashboardConfig();

  const visibleCount = config.widgets.filter((w) => w.visible).length;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          Customize
          <Badge variant="secondary" className="ml-1 text-xs">
            {visibleCount}/{config.widgets.length}
          </Badge>
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[400px] sm:max-w-[400px]">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <SheetTitle>Dashboard Settings</SheetTitle>
            {isSaving ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Saving...</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3 w-3 text-green-500" />
                <span>Saved</span>
              </div>
            )}
          </div>
          <SheetDescription>
            Customize which widgets to show and how they appear.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Global settings */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium">Display Options</h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="show-kpis" className="text-sm">
                Show KPI Cards
              </Label>
              <Switch
                id="show-kpis"
                checked={config.showKPIs}
                onCheckedChange={setShowKPIs}
              />
            </div>

            <Separator />

            <h4 className="text-sm font-medium">Auto Refresh</h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="auto-refresh" className="text-sm">
                Enable Auto Refresh
              </Label>
              <Switch
                id="auto-refresh"
                checked={config.autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
            </div>

            {config.autoRefresh && (
              <div className="space-y-1.5">
                <Label className="text-xs">Refresh Interval</Label>
                <Select
                  value={String(config.refreshInterval)}
                  onValueChange={(value) => setRefreshInterval(parseInt(value))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                    <SelectItem value="120">2 minutes</SelectItem>
                    <SelectItem value="300">5 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Separator />

          {/* Widget configurations */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Widgets</h4>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={resetToDefaults}
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-2">
                {config.widgets
                  .sort((a, b) => a.order - b.order)
                  .map((widget) => (
                    <WidgetConfigItem
                      key={widget.id}
                      widget={widget}
                      onToggle={() => toggleWidget(widget.id)}
                      onUpdate={(updates) => updateWidget(widget.id, updates)}
                    />
                  ))}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')}
              />
              Refresh Data
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// Quick toggle button for showing/hiding widgets
interface WidgetToggleProps {
  widgets: WidgetConfig[];
  onToggle: (widgetId: string) => void;
}

export function WidgetQuickToggle({ widgets, onToggle }: WidgetToggleProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {widgets.map((widget) => (
        <TooltipProvider key={widget.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={widget.visible ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onToggle(widget.id)}
              >
                {widget.visible ? (
                  <Eye className="h-3 w-3 mr-1" />
                ) : (
                  <EyeOff className="h-3 w-3 mr-1" />
                )}
                {widget.title.split(' ')[0]}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {widget.visible ? 'Hide' : 'Show'} {widget.title}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}
