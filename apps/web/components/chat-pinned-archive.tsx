'use client';
import { useState, useMemo } from 'react';
import {
  useArchiveSlugSuggestions,
  usePinnedArchiveEntries,
  usePinArchiveEntry,
  useUnpinArchiveEntry,
} from '@/hooks/use-archive';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Loader, Bookmark } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function ChatPinnedArchive({
  chatId,
  className,
  stagedPinnedSlugs = [],
  onAddStagedPin,
  onRemoveStagedPin,
  chatHasStarted,
}: {
  chatId: string;
  className?: string;
  stagedPinnedSlugs?: string[];
  onAddStagedPin?: (slug: string) => void;
  onRemoveStagedPin?: (slug: string) => void;
  chatHasStarted?: boolean;
}) {
  const { data: pinned = [], isLoading } = usePinnedArchiveEntries(
    chatHasStarted ? chatId : undefined
  );
  const pinMutation = usePinArchiveEntry();
  const unpinMutation = useUnpinArchiveEntry();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data: suggestions = [], isFetching } =
    useArchiveSlugSuggestions(search);

  async function handlePin(slug: string) {
    if (!slug.trim()) return;
    const cleaned = slug.trim();
    if (!chatHasStarted) {
      onAddStagedPin?.(cleaned);
      setSearch('');
      return;
    }
    try {
      await pinMutation.mutateAsync({ chatId, slug: cleaned });
      setSearch('');
    } catch {}
  }
  async function handleUnpin(slug: string) {
    if (!chatHasStarted) {
      onRemoveStagedPin?.(slug);
      return;
    }
    try {
      await unpinMutation.mutateAsync({ chatId, slug });
    } catch {}
  }

  const effectivePinned = chatHasStarted
    ? pinned
    : stagedPinnedSlugs.map((s) => ({
        slug: s,
        entity: '(pending)',
        tags: [],
        updatedAt: new Date().toISOString(),
        pinnedAt: new Date().toISOString(),
        bodyPreview: undefined,
      }));
  const filteredPinned = useMemo(() => {
    if (!search) return effectivePinned;
    return effectivePinned.filter(
      (p) =>
        p.slug.includes(search) ||
        p.entity.toLowerCase().includes(search.toLowerCase())
    );
  }, [effectivePinned, search]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn('h-8 gap-1', className)}
        >
          <Bookmark size={16} className="md:hidden" />
          <span className="hidden md:inline text-xs font-medium">Memory</span>
          {effectivePinned.length > 0 && (
            <Badge
              variant="secondary"
              className="hidden md:inline text-[10px] px-1 py-0 leading-none"
            >
              {effectivePinned.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-lg">
        <div className="border-b px-3 py-2 flex items-center justify-between text-xs font-medium">
          <span>Pinned Entries</span>
          <div className="flex gap-1">
            {pinMutation.isPending && (
              <span className="animate-spin">
                <Loader size={12} />
              </span>
            )}
            {unpinMutation.isPending && (
              <span className="animate-spin">
                <Loader size={12} />
              </span>
            )}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-2">
            <Command shouldFilter={false} className="rounded-md border">
              <CommandInput
                value={search}
                onValueChange={setSearch}
                placeholder="Search or pin slug..."
                className="text-xs"
              />
              <CommandList className="max-h-40">
                {search.length >= 2 && (
                  <>
                    <CommandGroup heading="Suggestions">
                      {isFetching && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">
                          Loading…
                        </div>
                      )}
                      {!isFetching &&
                        suggestions.map((s) => (
                          <CommandItem
                            key={s.slug}
                            value={s.slug}
                            onSelect={() => handlePin(s.slug)}
                            className="flex items-start gap-2 text-xs"
                          >
                            <span
                              className="font-medium truncate max-w-[6rem]"
                              title={s.slug}
                            >
                              {s.slug}
                            </span>
                            <span
                              className="truncate text-muted-foreground max-w-[10rem]"
                              title={s.entity}
                            >
                              {s.entity}
                            </span>
                          </CommandItem>
                        ))}
                      {!isFetching && suggestions.length === 0 && (
                        <CommandEmpty>No matches</CommandEmpty>
                      )}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
            {search &&
              search.length >= 2 &&
              !effectivePinned.some((p) => p.slug === search) && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 h-6 px-2 text-[11px]"
                  onClick={() => handlePin(search)}
                >
                  Pin “{search}”
                </Button>
              )}
          </div>
          <div className="flex flex-wrap gap-1 p-2 border-t overflow-y-auto">
            {chatHasStarted && isLoading && (
              <span className="text-xs text-muted-foreground">Loading…</span>
            )}
            {!chatHasStarted && effectivePinned.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No provisional pins
              </span>
            )}
            {!isLoading &&
              filteredPinned.map((p) => (
                <Tooltip key={p.slug}>
                  <TooltipTrigger asChild>
                    <span className="group relative flex cursor-pointer items-center gap-1 rounded-full bg-accent/60 px-2 py-1 text-[11px] hover:bg-accent border max-w-[9rem]">
                      <span className="font-medium truncate" title={p.entity}>
                        {p.slug}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUnpin(p.slug);
                        }}
                        className="opacity-40 group-hover:opacity-100 transition text-[10px]"
                      >
                        ✕
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    className="max-w-xs whitespace-pre-wrap text-[11px] leading-snug"
                  >
                    <div className="mb-1 font-semibold">{p.entity}</div>
                    {p.bodyPreview ? p.bodyPreview : 'No preview available.'}
                  </TooltipContent>
                </Tooltip>
              ))}
            {!isLoading && filteredPinned.length === 0 && chatHasStarted && (
              <span className="text-xs text-muted-foreground">
                No pinned entries
              </span>
            )}
          </div>
          <div className="border-t p-1 text-[10px] text-muted-foreground text-center">
            Pinned file bodies are automatically included in system context.
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
