'use client';

import Link from 'next/link';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type {
  MessageSearchResult,
  HighlightRange,
} from '@/hooks/use-client-search';
import { formatDistanceToNow } from 'date-fns';

interface SearchResultItemProps {
  result: MessageSearchResult;
  onSelect?: () => void;
}

export function SearchResultItem({ result, onSelect }: SearchResultItemProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        className="h-auto py-2.5 flex-col items-start gap-1.5 min-h-[4rem]"
      >
        <Link href={`/chat/${result.chatId}`} onClick={onSelect}>
          <div className="flex w-full items-center justify-between gap-2">
            <span className="font-medium truncate text-sm text-foreground/90">
              {result.chatTitle}
            </span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">
              {formatDistanceToNow(new Date(result.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 break-words w-full leading-relaxed">
            <HighlightedSnippet
              text={result.snippet}
              highlights={result.highlights}
            />
          </p>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function HighlightedSnippet({
  text,
  highlights,
}: {
  text: string;
  highlights: HighlightRange[];
}) {
  if (!highlights || highlights.length === 0) {
    return <>{text}</>;
  }

  const segments: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < highlights.length; i++) {
    const { start, end } = highlights[i];

    // Add non-highlighted text before this highlight
    if (start > lastEnd) {
      segments.push(
        <span key={`text-${i}`}>{text.slice(lastEnd, start)}</span>
      );
    }

    // Add highlighted text
    segments.push(
      <span
        key={`highlight-${i}`}
        className="bg-yellow-100 dark:bg-yellow-900/30 text-foreground font-medium rounded-[1px] px-0.5"
      >
        {text.slice(start, end)}
      </span>
    );

    lastEnd = end;
  }

  // Add remaining text after the last highlight
  if (lastEnd < text.length) {
    segments.push(<span key="text-end">{text.slice(lastEnd)}</span>);
  }

  return <>{segments}</>;
}
