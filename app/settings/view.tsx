'use client';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArchiveExplorer } from '@/components/archive/archive-explorer';
import { AgentsManagement } from '@/components/agents-management';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function SettingsView({
  defaultTab,
  isAdmin,
  adminContent,
}: {
  defaultTab: 'archive' | 'agents' | 'admin';
  isAdmin: boolean;
  adminContent?: ReactNode;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = useState<'archive' | 'agents' | 'admin'>(defaultTab);
  const tabHeightsRef = useRef<
    Partial<Record<'archive' | 'agents' | 'admin', number>>
  >({});
  const activeTabRef = useRef<'archive' | 'agents' | 'admin'>(defaultTab);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedNodeRef = useRef<HTMLDivElement | null>(null);
  const baselineHeightRef = useRef<number>(0);
  const [activeTabHeight, setActiveTabHeight] = useState<number | null>(null);

  // Keep URL in sync (avoid full page reload; just push shallow)
  useEffect(() => {
    const current = search.get('tab');
    if (current !== tab) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      router.replace(url.pathname + '?' + url.searchParams.toString());
    }
  }, [tab]);

  useEffect(() => {
    activeTabRef.current = tab;
    const storedHeight = tabHeightsRef.current[tab];
    if (typeof storedHeight === 'number') {
      setActiveTabHeight(storedHeight);
      return;
    }
    if (baselineHeightRef.current > 0) {
      tabHeightsRef.current[tab] = baselineHeightRef.current;
      setActiveTabHeight(baselineHeightRef.current);
    }
  }, [tab]);

  useEffect(() => {
    return () => {
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      observedNodeRef.current = null;
    };
  }, []);

  const registerActiveContent = useCallback(
    (node: HTMLDivElement | null) => {
      if (observedNodeRef.current === node) {
        return;
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (!node) {
        observedNodeRef.current = null;
        return;
      }

      observedNodeRef.current = node;

      const parentElement = node.parentElement as HTMLElement | null;
      const parentHeight = parentElement?.getBoundingClientRect().height ?? 0;
      if (parentHeight > 0) {
        baselineHeightRef.current = parentHeight;
      }

      if (
        typeof window === 'undefined' ||
        typeof ResizeObserver === 'undefined'
      ) {
        return;
      }

      const updateHeight = (height: number) => {
        const baseline = baselineHeightRef.current || height;
        const nextHeight = baseline;
        const previous = tabHeightsRef.current[activeTabRef.current];
        if (
          typeof previous === 'number' &&
          Math.abs(previous - nextHeight) < 0.5
        ) {
          if (activeTabHeight === null) {
            setActiveTabHeight(nextHeight);
          }
          return;
        }
        tabHeightsRef.current[activeTabRef.current] = nextHeight;
        setActiveTabHeight(nextHeight);
      };

      const initialHeight = node.getBoundingClientRect().height;
      if (initialHeight > 0) {
        updateHeight(initialHeight);
      }

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const height = Array.isArray(entry.borderBoxSize)
          ? (entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
          : // @ts-expect-error Support browsers exposing blockSize directly
            (entry.borderBoxSize?.blockSize ?? entry.contentRect.height);
        const parentRect = (
          observedNodeRef.current?.parentElement as HTMLElement | null
        )?.getBoundingClientRect();
        if (parentRect?.height) {
          baselineHeightRef.current = parentRect.height;
        }
        updateHeight(height);
      });

      observer.observe(node);
      resizeObserverRef.current = observer;
    },
    [activeTabHeight]
  );

  const contentRegionStyle = activeTabHeight
    ? ({
        '--settings-tab-height': `${Math.ceil(activeTabHeight)}px`,
      } as CSSProperties)
    : undefined;

  const activeContentStyle: CSSProperties = activeTabHeight
    ? {
        minHeight: 'var(--settings-tab-height)',
        height: '100%',
      }
    : { height: '100%' };

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as 'archive' | 'agents' | 'admin')}
      className="flex flex-col h-full min-h-0"
    >
      <div className="px-6 pb-3">
        <TabsList className="rounded-full border border-border/60 bg-muted/50 px-1.5 py-1 shadow-sm backdrop-blur">
          <TabsTrigger value="archive" className="rounded-full px-4 py-1.5">
            Archive
          </TabsTrigger>
          <TabsTrigger value="agents" className="rounded-full px-4 py-1.5">
            Agents
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="admin" className="rounded-full px-4 py-1.5">
              Admin
            </TabsTrigger>
          )}
        </TabsList>
      </div>
      <div
        className="flex-1 min-h-0 overflow-hidden pt-2"
        style={contentRegionStyle}
      >
        <TabsContent
          value="archive"
          className="flex h-full min-h-0 flex-col overflow-hidden"
        >
          {tab === 'archive' && (
            <motion.div
              key="archive"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1] }}
              className="flex-1 min-h-0 overflow-hidden"
              ref={registerActiveContent}
              style={activeContentStyle}
            >
              <ArchiveExplorer />
            </motion.div>
          )}
        </TabsContent>
        <TabsContent
          value="agents"
          className="flex h-full min-h-0 flex-col overflow-hidden"
        >
          {tab === 'agents' && (
            <motion.div
              key="agents"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1] }}
              className="flex-1 min-h-0 overflow-hidden"
              ref={registerActiveContent}
              style={activeContentStyle}
            >
              <AgentsManagement />
            </motion.div>
          )}
        </TabsContent>
        {isAdmin && (
          <TabsContent
            value="admin"
            className="flex h-full min-h-0 flex-col overflow-auto"
          >
            {tab === 'admin' && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.21, 1.02, 0.73, 1] }}
                className="flex-1"
                ref={registerActiveContent}
                style={activeContentStyle}
              >
                {adminContent}
              </motion.div>
            )}
          </TabsContent>
        )}
        {!isAdmin && tab === 'admin' && (
          <div className="p-6 text-sm text-muted-foreground">
            Access denied.
          </div>
        )}
      </div>
    </Tabs>
  );
}
