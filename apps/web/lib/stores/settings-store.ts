import { create } from 'zustand';

type SettingsTab = 'archive' | 'agents' | 'admin' | 'preferences';
type AgentView = 'list' | 'create' | 'edit';

interface SettingsState {
  tab: SettingsTab;
  setTab: (tab: SettingsTab) => void;
  initialize: (
    tab: SettingsTab,
    agentView?: AgentView,
    editingAgentId?: string | null
  ) => void;

  // Agent view state
  agentView: AgentView;
  editingAgentId: string | null;
  setAgentView: (view: AgentView) => void;
  setEditingAgent: (id: string | null) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  tab: 'preferences',
  agentView: 'list',
  editingAgentId: null,

  setTab: (tab) => {
    set({ tab });
    // Reset agent view when switching away from agents tab
    if (tab !== 'agents') {
      set({ agentView: 'list', editingAgentId: null });
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      // Clear agent params when switching tabs
      url.searchParams.delete('agentView');
      url.searchParams.delete('agentId');
      window.history.replaceState({}, '', url.toString());
    }
  },

  initialize: (tab, agentView = 'list', editingAgentId = null) =>
    set({ tab, agentView, editingAgentId }),

  setAgentView: (view) => {
    set({ agentView: view });
    // Clear editing ID when going back to list or create
    if (view === 'list' || view === 'create') {
      set({ editingAgentId: null });
    }
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (view === 'list') {
        url.searchParams.delete('agentView');
        url.searchParams.delete('agentId');
      } else {
        url.searchParams.set('agentView', view);
      }
      window.history.replaceState({}, '', url.toString());
    }
  },

  setEditingAgent: (id) => {
    set({ editingAgentId: id, agentView: id ? 'edit' : 'list' });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (id) {
        url.searchParams.set('agentView', 'edit');
        url.searchParams.set('agentId', id);
      } else {
        url.searchParams.delete('agentView');
        url.searchParams.delete('agentId');
      }
      window.history.replaceState({}, '', url.toString());
    }
  },
}));
