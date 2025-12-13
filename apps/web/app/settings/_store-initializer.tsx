'use client';

import { useRef } from 'react';
import { useSettingsStore } from '@/lib/stores/settings-store';

export function SettingsStoreInitializer({
  defaultTab,
}: {
  defaultTab: 'archive' | 'agents' | 'admin' | 'preferences';
}) {
  const initialized = useRef(false);
  if (!initialized.current) {
    useSettingsStore.getState().initialize(defaultTab);
    initialized.current = true;
  }
  return null;
}
