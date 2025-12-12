'use client';

import {
  ArrowUpDown,
  Calendar,
  ChevronDown,
  Settings,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { datePresets, sortOptions } from '@/lib/search/search-constants';
import type { SortOption } from '@/hooks/use-client-search';
import type { DateFilter } from '@/lib/search/search-utils';
import { useState } from 'react';

interface SearchFilterActionsProps {
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;
  dateFilter: DateFilter | null;
  setDateFilter: (filter: DateFilter | null) => void;
  compact?: boolean;
  onSortOpenChange?: (open: boolean) => void;
  onDateOpenChange?: (open: boolean) => void;
}

export function SearchFilterActions({
  sortBy,
  setSortBy,
  dateFilter,
  setDateFilter,
  compact = true,
  onSortOpenChange,
  onDateOpenChange,
}: SearchFilterActionsProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const handleSortOpenChange = (open: boolean) => {
    setIsDropdownOpen(open);
    onSortOpenChange?.(open);
  };

  const handleDateOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    onDateOpenChange?.(open);
  };

  if (compact) {
    return (
      <TooltipProvider delayDuration={300}>
        <DropdownMenu onOpenChange={handleSortOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-7 w-7',
                    (sortBy !== 'relevance' || dateFilter) && 'text-primary'
                  )}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Search settings</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Search Settings</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {/* Sort Submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpDown className="mr-2 h-4 w-4" />
                <span>Sort by</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setSortBy(option.value)}
                    className="cursor-pointer"
                  >
                    <span>{option.label}</span>
                    {sortBy === option.value && (
                      <Check className="ml-auto h-4 w-4" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* Date Submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Calendar className="mr-2 h-4 w-4" />
                <span>Date range</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {datePresets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.value}
                    onClick={() => setDateFilter(preset.getFilter())}
                    className="cursor-pointer"
                  >
                    <span>{preset.label}</span>
                    {dateFilter?.after?.getTime() ===
                      preset.getFilter().after?.getTime() && (
                      <Check className="ml-auto h-4 w-4" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDateFilter(null)}
                  disabled={!dateFilter}
                  className="cursor-pointer"
                >
                  Clear date filter
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
    );
  }

  return (
    <>
      {/* Sort dropdown */}
      <TooltipProvider delayDuration={300}>
        <DropdownMenu onOpenChange={handleSortOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowUpDown className="mr-2 h-3.5 w-3.5" />
                  Sort
                  <ChevronDown className="ml-2 h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Sort results</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sortOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setSortBy(option.value)}
                className={cn(
                  'cursor-pointer',
                  sortBy === option.value && 'bg-accent'
                )}
              >
                <option.icon className="mr-2 h-4 w-4" />
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>

      {/* Date filter dropdown */}
      <TooltipProvider delayDuration={300}>
        <Popover onOpenChange={handleDateOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('h-8 px-2', dateFilter && 'text-primary')}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="ml-2">Date</span>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">Filter by date</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-48 p-1">
            <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
              Date range
            </div>
            {datePresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => setDateFilter(preset.getFilter())}
                className={cn(
                  'w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent',
                  dateFilter?.after?.getTime() ===
                    preset.getFilter().after?.getTime() && 'bg-accent'
                )}
              >
                {preset.label}
              </button>
            ))}
            {dateFilter && (
              <>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={() => setDateFilter(null)}
                  className="w-full text-left px-2 py-1.5 text-sm rounded-sm hover:bg-accent text-muted-foreground"
                >
                  Clear filter
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    </>
  );
}
