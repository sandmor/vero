'use client';

import Link from 'next/link';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type { MessageSearchResult } from '@/lib/search/client-message-search';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SearchResultItemProps {
  result: MessageSearchResult;
  query: string;
  onSelect?: () => void;
}

export function SearchResultItem({ result, query, onSelect }: SearchResultItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="h-auto py-2.5 flex-col items-start gap-1.5 min-h-[4rem]">
        <Link href={`/chat/${result.chatId}`} onClick={onSelect}>
          <div className="flex w-full items-center justify-between gap-2">
            <span className="font-medium truncate text-sm text-foreground/90">{result.chatTitle}</span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(new Date(result.createdAt), { addSuffix: true })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 break-words w-full leading-relaxed">
            <HighlightText text={result.snippet} highlight={query} />
          </p>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function HighlightText({ text, highlight }: { text: string; highlight: string }) {
  if (!highlight.trim()) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
  
  return (
    <>
      {parts.map((part, i) => 
        part.toLowerCase() === highlight.toLowerCase() ? (
          <span key={i} className="bg-yellow-100 dark:bg-yellow-900/30 text-foreground font-medium rounded-[1px] px-0.5">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
