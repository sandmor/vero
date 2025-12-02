'use client';

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  startTransition,
} from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  Brain,
  Check,
  Zap,
  TrendingUp,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { saveReasoningEffortAsCookie } from '@/app/(chat)/actions';

export type ReasoningEffort = 'low' | 'medium' | 'high';

interface ReasoningEffortSelectorProps {
  selectedEffort?: ReasoningEffort;
  chatHasStarted: boolean;
  onSelectEffort?: (
    effort: ReasoningEffort,
    options?: { userInitiated?: boolean }
  ) => void | Promise<void>;
}

const REASONING_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  description: string;
  icon: typeof Zap;
}> = [
  {
    value: 'low',
    label: 'Low',
    description: 'Faster responses with basic reasoning',
    icon: Zap,
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Balanced speed and reasoning depth',
    icon: Brain,
  },
  {
    value: 'high',
    label: 'High',
    description: 'Slower but most thorough reasoning',
    icon: TrendingUp,
  },
];

export function ReasoningEffortSelector({
  selectedEffort = 'medium',
  chatHasStarted,
  onSelectEffort,
}: ReasoningEffortSelectorProps) {
  const [open, setOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const syncedEffortRef = useRef<ReasoningEffort>(selectedEffort);

  const canModify = Boolean(onSelectEffort);
  const buttonDisabled = !canModify || isApplying;

  const handleOpenChange = (next: boolean) => {
    if (!canModify) return;
    setOpen(next);
  };

  const chooseEffort = useCallback(
    async (effort: ReasoningEffort) => {
      if (!onSelectEffort) return;
      const result = onSelectEffort(effort, { userInitiated: true });
      // If caller returned a promise, await it and show spinner
      if (result && typeof (result as Promise<void>).then === 'function') {
        try {
          setIsApplying(true);
          await result;
          syncedEffortRef.current = effort;
          startTransition(() => {
            saveReasoningEffortAsCookie(effort);
          });
        } catch (e) {
          // swallow here; caller is expected to show errors
        } finally {
          setIsApplying(false);
        }
      } else {
        syncedEffortRef.current = effort;
        startTransition(() => {
          saveReasoningEffortAsCookie(effort);
        });
      }
      setOpen(false);
    },
    [onSelectEffort]
  );

  useEffect(() => {
    // Sync ref when selectedEffort changes from parent
    syncedEffortRef.current = selectedEffort;
  }, [selectedEffort]);

  const selectedOption = REASONING_OPTIONS.find(
    (opt) => opt.value === selectedEffort
  );
  const SelectedIcon = selectedOption?.icon ?? Brain;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={buttonDisabled}
          className={cn(
            'flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-background px-2 text-xs font-medium text-foreground transition-colors',
            'hover:bg-accent focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            buttonDisabled && 'cursor-not-allowed opacity-60'
          )}
        >
          {isApplying ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <SelectedIcon size={14} className="text-muted-foreground" />
          )}
          <span className="hidden sm:inline">
            {selectedOption?.label ?? 'Medium'}
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="top"
        sideOffset={8}
      >
        <div className="flex flex-col">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold text-sm">Reasoning Effort</h3>
            <p className="mt-1 text-muted-foreground text-xs">
              Control how much computational effort the model uses for reasoning
            </p>
            {chatHasStarted && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Changes apply to future responses.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1 p-2">
            {REASONING_OPTIONS.map((option) => {
              const isSelected = selectedEffort === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => chooseEffort(option.value)}
                  disabled={isApplying}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    'hover:bg-accent',
                    isSelected && 'bg-accent/50',
                    isApplying && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Icon
                    size={16}
                    className={cn(
                      'mt-0.5 shrink-0',
                      isSelected ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'font-medium text-sm',
                          isSelected && 'text-primary'
                        )}
                      >
                        {option.label}
                      </span>
                      {isSelected && (
                        <Check size={14} className="text-primary" />
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
