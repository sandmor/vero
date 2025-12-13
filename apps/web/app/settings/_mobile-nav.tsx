'use client';

import { Archive, Bot, Settings, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/lib/stores/settings-store';

export function SettingsMobileNav({ isAdmin }: { isAdmin: boolean }) {
  const { tab, setTab } = useSettingsStore();

  const navItems = [
    { id: 'preferences', label: 'Preferences', icon: Settings },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'agents', label: 'Agents', icon: Bot },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <nav className="flex md:hidden flex-row gap-2 overflow-x-auto pb-4 -mx-6 px-6 no-scrollbar">
      {navItems.map((item) => {
        const isActive = tab === item.id;
        return (
          <button
            key={item.id}
            onClick={() => setTab(item.id as any)}
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all outline-none border shrink-0',
              isActive
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon size={16} strokeWidth={isActive ? 2.5 : 2} />
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
