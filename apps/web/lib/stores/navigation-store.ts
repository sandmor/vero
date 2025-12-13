'use client';

import { create } from 'zustand';

interface NavigationState {
  lastChatUrl: string | null;
  setLastChatUrl: (url: string) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  lastChatUrl: null,
  setLastChatUrl: (url: string) => set({ lastChatUrl: url }),
}));
