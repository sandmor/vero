'use client';
import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArchiveExplorer } from '@/components/archive/archive-explorer';
import { AgentsManagement } from '@/components/agents-management';
import { UserPreferencesEditor } from '@/components/user-preferences-editor';
import { cn } from '@/lib/utils';
import { Settings, Archive, Bot, Shield } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settings-store';

export default function SettingsView({
  isAdmin,
  adminContent,
}: {
  isAdmin: boolean;
  adminContent?: ReactNode;
}) {
  const { tab, setTab } = useSettingsStore();

  const navItems = [
    { id: 'preferences', label: 'Preferences', icon: Settings },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'agents', label: 'Agents', icon: Bot },
    ...(isAdmin ? [{ id: 'admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <div className="hidden md:block w-56 shrink-0 lg:w-64">
        <nav className="sticky top-[146px] rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-4">
          <div className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id as any)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    isActive
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                  <span className="whitespace-nowrap">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Main content area */}
      <main className="flex-1 min-w-0 rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-6 lg:p-10">
        <AnimatePresence mode="wait">
          {tab === 'archive' && (
            <motion.div
              key="archive"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <ArchiveExplorer />
            </motion.div>
          )}
          {tab === 'agents' && (
            <motion.div
              key="agents"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <AgentsManagement />
            </motion.div>
          )}
          {tab === 'preferences' && (
            <motion.div
              key="preferences"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <UserPreferencesEditor />
            </motion.div>
          )}
          {isAdmin && tab === 'admin' && (
            <motion.div
              key="admin"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {adminContent}
            </motion.div>
          )}
          {!isAdmin && tab === 'admin' && (
            <div className="p-6 text-sm text-muted-foreground">
              Access denied.
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
