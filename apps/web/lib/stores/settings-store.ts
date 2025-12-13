import { create } from 'zustand';

type SettingsTab = 'archive' | 'agents' | 'admin' | 'preferences';

interface SettingsState {
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  initialize: (tab: SettingsTab) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  tab: 'preferences',
  setTab: (tab) => {
    set({ tab });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.pushState({}, '', url.toString());
    }
  },
  initialize: (tab) => set({ tab }),
}));
