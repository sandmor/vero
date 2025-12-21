'use client';

import { useRef } from 'react';
import { useSettingsStore } from '@/lib/stores/settings-store';

type SettingsTab = 'archive' | 'agents' | 'admin' | 'preferences';
type AgentView = 'list' | 'create' | 'edit';

export function SettingsStoreInitializer({
  defaultTab,
  agentView,
  editingAgentId,
}: {
  defaultTab: SettingsTab;
  agentView?: AgentView;
  editingAgentId?: string | null;
}) {
  const initialized = useRef(false);
  if (!initialized.current) {
    useSettingsStore
      .getState()
      .initialize(defaultTab, agentView ?? 'list', editingAgentId ?? null);
    initialized.current = true;
  }
  return null;
}
