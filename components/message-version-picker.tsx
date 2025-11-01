import { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type MessageVersionPickerProps = {
  activeIndex: number;
  total: number;
  onNavigate?: (direction: 'prev' | 'next') => void;
  disabled?: boolean;
  className?: string;
};

export const MessageVersionPicker = memo(function MessageVersionPicker({
  activeIndex,
  total,
  onNavigate,
  disabled = false,
  className,
}: MessageVersionPickerProps) {
  const canGoPrev = activeIndex > 0;
  const canGoNext = activeIndex < total - 1;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-1 py-0.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60',
        className
      )}
    >
      <Button
        aria-label="View previous version"
        disabled={!onNavigate || disabled || !canGoPrev}
        onClick={() => onNavigate?.('prev')}
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-full p-0"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span
        aria-live="polite"
        className="min-w-[3.5rem] text-center leading-none"
      >
        {activeIndex + 1} / {total}
      </span>
      <Button
        aria-label="View next version"
        disabled={!onNavigate || disabled || !canGoNext}
        onClick={() => onNavigate?.('next')}
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-full p-0"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
});
