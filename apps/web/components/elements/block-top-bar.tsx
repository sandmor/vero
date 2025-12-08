'use client';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BlockTopBarProps = {
  title?: string;
  content?: string;
  onCopy?: () => void;
  className?: string;
};

export const BlockTopBar = ({
  title,
  content,
  onCopy,
  className,
}: BlockTopBarProps) => {
  const [isCopied, setIsCopied] = useState(false);

  const copyToClipboard = async () => {
    if (typeof window === 'undefined' || !navigator.clipboard.writeText || !content) {
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      onCopy?.();
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between border-b bg-muted/50 px-4 py-2',
        className
      )}
    >
      <span className="text-xs font-medium text-muted-foreground uppercase">
        {title}
      </span>
      {content && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={copyToClipboard}
        >
          {isCopied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
        </Button>
      )}
    </div>
  );
};
