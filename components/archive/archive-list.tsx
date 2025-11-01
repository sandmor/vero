'use client';
import { useEffect, useRef } from 'react';
import type { TouchEvent as ReactTouchEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchiveSearch } from '@/hooks/use-archive';
import { cn } from '@/lib/utils';
import { CheckSquare, Square } from 'lucide-react';

export function ArchiveList({
  q,
  tags,
  onSelect,
  activeSlug,
  isSelectionMode = false,
  selectedSlugs = new Set<string>(),

  onToggleSelection,
  onPressStart,
  onPressEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onShiftClick,
  archiveData,
}: {
  q?: string;
  tags?: string[];
  onSelect: (slug: string) => void;
  activeSlug?: string;
  isSelectionMode?: boolean;
  selectedSlugs?: ReadonlySet<string>;
  onToggleSelection?: (slug: string) => void;
  onPressStart?: (slug: string, onInitiated?: () => void) => void;
  onPressEnd?: () => void;
  onTouchStart?: (
    slug: string,
    event: ReactTouchEvent<HTMLButtonElement>,
    onInitiated?: () => void
  ) => void;
  onTouchMove?: (event: ReactTouchEvent<HTMLButtonElement>) => boolean;
  onTouchEnd?: () => boolean;
  onShiftClick?: (slug: string) => void;
  archiveData?: any;
}) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useArchiveSearch({ q, tags });
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const longPressInitiatedRef = useRef(false);

  // Use passed archiveData if available, otherwise use local data
  const currentData = archiveData || data;
  const pages = (currentData as any)?.pages ?? [];
  const entries = pages.flatMap((p: { entries: any[] }) => p.entries as any[]);

  useEffect(() => {
    // Only set up infinite scrolling if we're using local data (not passed archiveData)
    if (archiveData) return;

    const el = sentinelRef.current;
    if (!el) return;
    if (!hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          fetchNextPage();
        }
      });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [archiveData, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-2 p-2">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-md border p-3">
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-3 w-full mb-1" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          {entries.map((e: any) => (
            <button
              key={e.slug}
              onClick={(event) => {
                // Prevent click if long-press was initiated
                if (longPressInitiatedRef.current) {
                  longPressInitiatedRef.current = false;
                  return;
                }

                if (event.shiftKey && onShiftClick) {
                  onShiftClick(e.slug);
                } else if (isSelectionMode && onToggleSelection) {
                  onToggleSelection(e.slug);
                } else {
                  onSelect(e.slug);
                }
              }}
              onTouchStart={(event) => {
                if (!isSelectionMode && onTouchStart) {
                  longPressInitiatedRef.current = false;
                  onTouchStart(e.slug, event, () => {
                    longPressInitiatedRef.current = true;
                  });
                }
              }}
              onTouchMove={(event) => {
                if (
                  isSelectionMode ||
                  longPressInitiatedRef.current ||
                  !onTouchMove
                ) {
                  return;
                }
                const canceled = onTouchMove(event);
                if (canceled) {
                  longPressInitiatedRef.current = false;
                }
              }}
              onTouchEnd={() => {
                if (isSelectionMode) return;
                let canceled = false;
                if (onTouchEnd) {
                  canceled = onTouchEnd();
                } else if (onPressEnd) {
                  onPressEnd();
                }
                if (canceled) {
                  longPressInitiatedRef.current = false;
                }
              }}
              onTouchCancel={() => {
                if (isSelectionMode) return;
                let canceled = false;
                if (onTouchEnd) {
                  canceled = onTouchEnd();
                } else if (onPressEnd) {
                  onPressEnd();
                }
                if (canceled) {
                  longPressInitiatedRef.current = false;
                }
              }}
              onMouseDown={() => {
                if (!isSelectionMode && onPressStart) {
                  longPressInitiatedRef.current = false;
                  onPressStart(e.slug, () => {
                    longPressInitiatedRef.current = true;
                  });
                }
              }}
              onMouseUp={() => {
                if (!isSelectionMode && onPressEnd) {
                  onPressEnd();
                }
              }}
              onMouseLeave={() => {
                if (!isSelectionMode && onPressEnd) {
                  onPressEnd();
                }
              }}
              className={cn(
                'group flex flex-col items-start gap-1 rounded-md border p-3 text-left transition hover:bg-accent',
                activeSlug === e.slug &&
                  !isSelectionMode &&
                  'border-primary ring-1 ring-primary',
                isSelectionMode &&
                  selectedSlugs.has(e.slug) &&
                  'border-primary bg-primary/5 ring-1 ring-primary'
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div className="font-medium line-clamp-1" title={e.entity}>
                  {e.entity}
                </div>
                <div className="flex items-center gap-2">
                  {isSelectionMode &&
                    (selectedSlugs.has(e.slug) ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    ))}
                  {e.linkCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {e.linkCount} link{e.linkCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
              <div
                className="line-clamp-2 text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: escapeHtml(e.bodyPreview) }}
              />
              <div className="flex flex-wrap gap-1 pt-1">
                {e.tags.slice(0, 4).map((t: string) => (
                  <Badge key={t} variant="secondary" className="text-xs">
                    {t}
                  </Badge>
                ))}
                {e.tags.length > 4 && (
                  <Badge variant="outline" className="text-[10px]">
                    +{e.tags.length - 4}
                  </Badge>
                )}
              </div>
            </button>
          ))}
          {entries.length === 0 && !isLoading && (
            <div className="text-sm text-muted-foreground p-4 text-center">
              No archive entries found.
            </div>
          )}
          <div ref={sentinelRef} />
          {isFetchingNextPage && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              Loading more…
            </div>
          )}
          {hasNextPage && !archiveData && (
            <div ref={sentinelRef} className="py-4 text-center">
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-3 w-3 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground"></div>
                Loading more...
              </div>
            </div>
          )}
          {!hasNextPage && entries.length > 0 && (
            <div className="py-4 text-center text-xs text-muted-foreground">
              End of results
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
