'use client';
import { useState, useEffect } from 'react';
import { CHAT_TOOL_IDS, type ChatToolId } from '@/lib/ai/tool-ids';
import {
  useChatSettings,
  useUpdateAllowedTools,
} from '@/hooks/use-chat-settings';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Loader, Settings, AlertCircle } from 'lucide-react';
import type { ChatModelCapabilitiesSummary } from '@/lib/ai/models';

// Human friendly labels (fallback to id if not present)
const LABELS: Record<ChatToolId, string> = {
  getWeather: 'Weather',
  runCode: 'Run Code',

  readArchive: 'Read Archive',
  writeArchive: 'Write Archive',
  manageChatPins: 'Manage Chat Pins',
};

// Define logical groups (order preserved)
const TOOL_GROUPS: { id: string; label: string; tools: ChatToolId[] }[] = [
  {
    id: 'archive',
    label: 'Archive',
    tools: ['readArchive', 'writeArchive', 'manageChatPins'],
  },
  {
    id: 'other',
    label: 'Other',
    tools: ['getWeather', 'runCode'],
  },
];

export function ChatToolSelector({
  chatId,
  className,
  chatHasStarted,
  stagedAllowedTools,
  onUpdateStagedAllowedTools,
  selectedModelId: _selectedModelId,
  selectedModelCapabilities,
}: {
  chatId: string;
  className?: string;
  chatHasStarted?: boolean;
  stagedAllowedTools?: ChatToolId[] | undefined;
  onUpdateStagedAllowedTools?: (tools: ChatToolId[] | undefined) => void;
  selectedModelId?: string;
  selectedModelCapabilities?: ChatModelCapabilitiesSummary | null;
}) {
  const { data, isLoading } = useChatSettings(
    chatHasStarted ? chatId : undefined
  );
  const mutation = useUpdateAllowedTools(chatHasStarted ? chatId : undefined);
  const [open, setOpen] = useState(false);

  // Local state for selected tools: undefined means all, array means specific
  const [selectedTools, setSelectedTools] = useState<ChatToolId[] | undefined>(
    undefined
  );

  // Check if model supports tools
  const modelSupportsTools = selectedModelCapabilities?.supportsTools ?? true;

  // Sync with server data or staged props
  useEffect(() => {
    if (chatHasStarted) {
      if (!isLoading && data) {
        setSelectedTools(
          (data.settings.tools?.allow as ChatToolId[]) ?? undefined
        );
      }
    } else {
      setSelectedTools((stagedAllowedTools as ChatToolId[]) ?? undefined);
    }
  }, [chatHasStarted, data, isLoading, stagedAllowedTools]);

  const isAllSelected = selectedTools === undefined;
  const selectedSet = new Set<ChatToolId>(
    isAllSelected ? CHAT_TOOL_IDS : (selectedTools ?? [])
  );
  const count = isAllSelected ? CHAT_TOOL_IDS.length : selectedSet.size;
  const isBusy = mutation.isPending || (chatHasStarted && isLoading);

  // If model doesn't support tools, show disabled state
  if (!modelSupportsTools) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-border/40 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground',
          className
        )}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        <span>Tools not supported by this model</span>
      </div>
    );
  }

  const updateTools = (tools: ChatToolId[] | undefined) => {
    setSelectedTools(tools);
    if (!chatHasStarted) {
      onUpdateStagedAllowedTools?.(tools);
    } else {
      mutation.mutate(tools ?? null);
    }
  };

  const toggleTool = (id: ChatToolId) => {
    if (isBusy) return;
    const newSet = new Set(selectedSet);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    const newTools = Array.from(newSet);
    updateTools(
      newTools.length === CHAT_TOOL_IDS.length ? undefined : newTools
    );
  };

  const toggleAll = () => {
    if (isBusy) return;
    updateTools(isAllSelected ? [] : undefined);
  };

  const toggleGroup = (groupTools: ChatToolId[]) => {
    if (isBusy) return;
    const newSet = new Set(selectedSet);
    const allSelected = groupTools.every((t) => newSet.has(t));
    if (allSelected) {
      groupTools.forEach((t) => newSet.delete(t));
    } else {
      groupTools.forEach((t) => newSet.add(t));
    }
    const newTools = Array.from(newSet);
    updateTools(
      newTools.length === CHAT_TOOL_IDS.length ? undefined : newTools
    );
  };

  const getGroupState = (groupTools: ChatToolId[]) => {
    const selectedCount = groupTools.filter((t) => selectedSet.has(t)).length;
    if (selectedCount === 0) return { checked: false, indeterminate: false };
    if (selectedCount === groupTools.length)
      return { checked: true, indeterminate: false };
    return { checked: false, indeterminate: true };
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn('h-8 gap-1', className)}
          disabled={isBusy}
        >
          <Settings size={16} className="md:hidden" />
          <span className="hidden md:inline text-xs font-medium">Tools</span>
          <Badge
            variant="secondary"
            className="hidden md:inline text-[10px] px-1 py-0 leading-none"
          >
            {isBusy ? '…' : count}
          </Badge>
          {isBusy && (
            <span className="animate-spin">
              <Loader size={12} />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 shadow-lg">
        <div className="border-b px-3 py-2 flex items-center justify-between text-xs font-medium">
          <span>Allowed Tools</span>
          {isBusy && (
            <span className="text-[10px] text-muted-foreground">
              {chatHasStarted && isLoading ? 'Loading…' : 'Saving…'}
            </span>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2 flex flex-col gap-2">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (isBusy) return;
              toggleAll();
            }}
            onKeyDown={(e) => {
              if (isBusy) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAll();
              }
            }}
            aria-disabled={isBusy}
            className={cn(
              'flex items-center gap-2 rounded-md border px-2 py-1 text-xs hover:bg-accent',
              isBusy ? 'opacity-50 pointer-events-none' : ''
            )}
          >
            <Checkbox checked={isAllSelected} className="h-3.5 w-3.5" />
            <span className="truncate">All Tools</span>
          </div>
          <div className="flex flex-col gap-3">
            {TOOL_GROUPS.map((group) => {
              const state = getGroupState(group.tools);
              return (
                <div key={group.id} className="flex flex-col gap-1">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isBusy) return;
                      toggleGroup(group.tools);
                    }}
                    onKeyDown={(e) => {
                      if (isBusy) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(group.tools);
                      }
                    }}
                    aria-disabled={isBusy}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent',
                      state.checked ? 'bg-accent/60' : 'bg-background',
                      isBusy ? 'opacity-50 pointer-events-none' : ''
                    )}
                  >
                    <Checkbox
                      checked={state.checked}
                      indeterminate={state.indeterminate}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate" title={group.label}>
                      {group.label}
                    </span>
                  </div>
                  <div className="pl-4 flex flex-col gap-1">
                    {group.tools.map((tid) => {
                      const checked = selectedSet.has(tid);
                      return (
                        <div
                          key={tid}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (isBusy) return;
                            toggleTool(tid);
                          }}
                          onKeyDown={(e) => {
                            if (isBusy) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleTool(tid);
                            }
                          }}
                          aria-disabled={isBusy}
                          className={cn(
                            'flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] text-left hover:bg-accent',
                            checked ? 'bg-accent/60' : 'bg-background',
                            isBusy ? 'opacity-50 pointer-events-none' : ''
                          )}
                        >
                          <Checkbox checked={checked} className="h-3.5 w-3.5" />
                          <span className="truncate" title={tid}>
                            {LABELS[tid] || tid}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t pt-2 mt-1 text-[10px] text-muted-foreground leading-snug">
            Unchecking tools restricts the model from calling them. Selecting
            all enables every tool (no allow-list stored).
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
