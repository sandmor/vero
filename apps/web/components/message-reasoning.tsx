'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from './elements/reasoning';

type MessageReasoningProps = {
  isLoading: boolean;
  reasoning: string;
  appearance?: 'default' | 'inline';
  className?: string;
};

export function MessageReasoning({
  isLoading,
  reasoning,
  appearance = 'default',
  className,
}: MessageReasoningProps) {
  const [hasBeenStreaming, setHasBeenStreaming] = useState(isLoading);

  useEffect(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);

  return (
    <Reasoning
      className={cn(
        appearance === 'inline'
          ? 'w-full rounded-xl border border-border/60 bg-background/80 px-3 py-2 shadow-sm'
          : undefined,
        className
      )}
      data-testid="message-reasoning"
      defaultOpen={hasBeenStreaming}
      isStreaming={isLoading}
    >
      <ReasoningTrigger />
      <ReasoningContent>{reasoning}</ReasoningContent>
    </Reasoning>
  );
}
