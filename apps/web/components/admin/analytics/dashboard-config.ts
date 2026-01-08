'use client';

import { create } from 'zustand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useCallback } from 'react';

// Chart display types
export type ChartType = 'area' | 'line' | 'bar';
export type MetricType = 'requests' | 'tokens' | 'cost' | 'users';
export type TokenBreakdownView =
  | 'all'
  | 'input'
  | 'output'
  | 'reasoning'
  | 'cached';
export type GroupByOption = 'time' | 'model' | 'user' | 'provider';

// Widget configuration
export interface WidgetConfig {
  id: string;
  type: 'time-series' | 'pie' | 'bar' | 'table' | 'kpi' | 'token-breakdown';
  title: string;
  visible: boolean;
  size: 'small' | 'medium' | 'large' | 'full';
  order: number;
  settings: {
    metric?: MetricType;
    chartType?: ChartType;
    groupBy?: GroupByOption;
    showLegend?: boolean;
    stacked?: boolean;
    tokenBreakdown?: TokenBreakdownView;
    splitByModel?: boolean;
    limit?: number;
  };
}

// Dashboard layout configuration
export interface DashboardConfig {
  widgets: WidgetConfig[];
  showKPIs: boolean;
  autoRefresh: boolean;
  refreshInterval: number; // in seconds
}

// Default widget configurations
const defaultWidgets: WidgetConfig[] = [
  {
    id: 'overview-chart',
    type: 'time-series',
    title: 'Usage Over Time',
    visible: true,
    size: 'full',
    order: 0,
    settings: {
      metric: 'requests',
      chartType: 'area',
      stacked: false,
    },
  },
  {
    id: 'token-breakdown',
    type: 'token-breakdown',
    title: 'Token Breakdown',
    visible: true,
    size: 'medium',
    order: 1,
    settings: {
      tokenBreakdown: 'all',
    },
  },
  {
    id: 'model-distribution',
    type: 'pie',
    title: 'Model Distribution',
    visible: true,
    size: 'medium',
    order: 2,
    settings: {
      metric: 'requests',
      showLegend: true,
    },
  },
  {
    id: 'model-tokens',
    type: 'time-series',
    title: 'Tokens by Model',
    visible: true,
    size: 'large',
    order: 3,
    settings: {
      metric: 'tokens',
      chartType: 'area',
      splitByModel: true,
      stacked: true,
      limit: 5,
    },
  },
  {
    id: 'provider-usage',
    type: 'bar',
    title: 'Provider Usage',
    visible: true,
    size: 'medium',
    order: 4,
    settings: {
      metric: 'cost',
    },
  },
  {
    id: 'cost-over-time',
    type: 'time-series',
    title: 'Cost Over Time',
    visible: true,
    size: 'large',
    order: 5,
    settings: {
      metric: 'cost',
      chartType: 'area',
    },
  },
  {
    id: 'model-table',
    type: 'table',
    title: 'Model Statistics',
    visible: true,
    size: 'full',
    order: 6,
    settings: {
      limit: 20,
    },
  },
  {
    id: 'user-table',
    type: 'table',
    title: 'Top Users',
    visible: true,
    size: 'full',
    order: 7,
    settings: {
      groupBy: 'user',
      limit: 20,
    },
  },
];

const defaultConfig: DashboardConfig = {
  widgets: defaultWidgets,
  showKPIs: true,
  autoRefresh: false,
  refreshInterval: 60,
};

export { defaultConfig };

const SETTING_KEY = 'adminDashboardConfig';

// Internal Zustand store for immediate local state updates
interface DashboardConfigInternalStore {
  config: DashboardConfig;
  isInitialized: boolean;
  setConfig: (config: DashboardConfig) => void;
  setInitialized: (initialized: boolean) => void;
}

const useInternalStore = create<DashboardConfigInternalStore>((set) => ({
  config: defaultConfig,
  isInitialized: false,
  setConfig: (config) => set({ config }),
  setInitialized: (initialized) => set({ isInitialized: initialized }),
}));

// Fetch config from server
async function fetchDashboardConfig(): Promise<DashboardConfig> {
  const response = await fetch('/api/admin/settings');
  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }
  const data = await response.json();
  const configStr = data.settings?.[SETTING_KEY];
  if (configStr) {
    try {
      const parsed = JSON.parse(configStr);
      // Merge with defaults to handle any new widgets that were added
      return mergeWithDefaults(parsed);
    } catch {
      return defaultConfig;
    }
  }
  return defaultConfig;
}

// Save config to server
async function saveDashboardConfig(config: DashboardConfig): Promise<void> {
  const response = await fetch('/api/admin/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: SETTING_KEY,
      value: JSON.stringify(config),
    }),
  });
  if (!response.ok) {
    throw new Error('Failed to save settings');
  }
}

// Merge stored config with defaults to handle schema changes
function mergeWithDefaults(stored: Partial<DashboardConfig>): DashboardConfig {
  const mergedWidgets = defaultWidgets.map((defaultWidget) => {
    const storedWidget = stored.widgets?.find((w) => w.id === defaultWidget.id);
    if (storedWidget) {
      return {
        ...defaultWidget,
        ...storedWidget,
        settings: {
          ...defaultWidget.settings,
          ...storedWidget.settings,
        },
      };
    }
    return defaultWidget;
  });

  return {
    widgets: mergedWidgets,
    showKPIs: stored.showKPIs ?? defaultConfig.showKPIs,
    autoRefresh: stored.autoRefresh ?? defaultConfig.autoRefresh,
    refreshInterval: stored.refreshInterval ?? defaultConfig.refreshInterval,
  };
}

// Main hook that provides dashboard config with DB persistence
export function useDashboardConfig() {
  const queryClient = useQueryClient();
  const { config, isInitialized, setConfig, setInitialized } =
    useInternalStore();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch config from server
  const { data: serverConfig, isLoading } = useQuery({
    queryKey: ['adminDashboardConfig'],
    queryFn: fetchDashboardConfig,
    staleTime: 60000, // Consider data fresh for 1 minute
    refetchOnWindowFocus: false,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: saveDashboardConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminDashboardConfig'] });
    },
  });

  // Initialize local state from server when data arrives
  useEffect(() => {
    if (serverConfig && !isInitialized) {
      setConfig(serverConfig);
      setInitialized(true);
    }
  }, [serverConfig, isInitialized, setConfig, setInitialized]);

  // Debounced save to server
  const debouncedSave = useCallback(
    (newConfig: DashboardConfig) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        saveMutation.mutate(newConfig);
      }, 1000); // Save after 1 second of no changes
    },
    [saveMutation]
  );

  // Update local state and schedule save
  const updateConfig = useCallback(
    (updater: (current: DashboardConfig) => DashboardConfig) => {
      const newConfig = updater(config);
      setConfig(newConfig);
      debouncedSave(newConfig);
    },
    [config, setConfig, debouncedSave]
  );

  // Actions
  const updateWidget = useCallback(
    (widgetId: string, updates: Partial<WidgetConfig>) => {
      updateConfig((current) => ({
        ...current,
        widgets: current.widgets.map((w) =>
          w.id === widgetId ? { ...w, ...updates } : w
        ),
      }));
    },
    [updateConfig]
  );

  const toggleWidget = useCallback(
    (widgetId: string) => {
      updateConfig((current) => ({
        ...current,
        widgets: current.widgets.map((w) =>
          w.id === widgetId ? { ...w, visible: !w.visible } : w
        ),
      }));
    },
    [updateConfig]
  );

  const reorderWidgets = useCallback(
    (startIndex: number, endIndex: number) => {
      updateConfig((current) => {
        const widgets = [...current.widgets];
        const [removed] = widgets.splice(startIndex, 1);
        widgets.splice(endIndex, 0, removed);
        return {
          ...current,
          widgets: widgets.map((w, i) => ({ ...w, order: i })),
        };
      });
    },
    [updateConfig]
  );

  const resetToDefaults = useCallback(() => {
    setConfig(defaultConfig);
    saveMutation.mutate(defaultConfig);
  }, [setConfig, saveMutation]);

  const setShowKPIs = useCallback(
    (show: boolean) => {
      updateConfig((current) => ({ ...current, showKPIs: show }));
    },
    [updateConfig]
  );

  const setAutoRefresh = useCallback(
    (auto: boolean) => {
      updateConfig((current) => ({ ...current, autoRefresh: auto }));
    },
    [updateConfig]
  );

  const setRefreshInterval = useCallback(
    (interval: number) => {
      updateConfig((current) => ({ ...current, refreshInterval: interval }));
    },
    [updateConfig]
  );

  return {
    config,
    isLoading: isLoading && !isInitialized,
    isSaving: saveMutation.isPending,
    setConfig: (newConfig: DashboardConfig) => {
      setConfig(newConfig);
      debouncedSave(newConfig);
    },
    updateWidget,
    toggleWidget,
    reorderWidgets,
    resetToDefaults,
    setShowKPIs,
    setAutoRefresh,
    setRefreshInterval,
  };
}

// Helper to get widget size classes
export function getWidgetSizeClass(size: WidgetConfig['size']): string {
  switch (size) {
    case 'small':
      return 'md:col-span-1';
    case 'medium':
      return 'md:col-span-1 lg:col-span-2';
    case 'large':
      return 'md:col-span-2 lg:col-span-3';
    case 'full':
      return 'md:col-span-2 lg:col-span-4';
    default:
      return 'md:col-span-1';
  }
}
