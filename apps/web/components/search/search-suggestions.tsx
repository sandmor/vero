'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { History, Search, X } from 'lucide-react';
import { generateSuggestions } from '@/lib/search/search-utils';

interface SearchSuggestionsProps {
  query: string;
  history: string[];
  onSelect: (suggestion: string) => void;
  onRemove: (suggestion: string) => void;
  visible: boolean;
}

export function SearchSuggestions({
  query,
  history,
  onSelect,
  onRemove,
  visible,
}: SearchSuggestionsProps) {
  const suggestions = useMemo(
    () => generateSuggestions(query, history, 5),
    [query, history]
  );

  if (!visible || (suggestions.length === 0 && history.length === 0)) {
    return null;
  }

  const showHistory = !query && history.length > 0;
  const items = showHistory ? history.slice(0, 5) : suggestions;

  if (items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover p-1 shadow-md"
    >
      <div className="text-xs text-muted-foreground px-2 py-1">
        {showHistory ? 'Recent searches' : 'Suggestions'}
      </div>
      {items.map((item) => (
        <div
          key={item}
          className="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent cursor-pointer group"
          onClick={() => onSelect(item)}
        >
          <div className="flex items-center gap-2">
            {showHistory ? (
              <History className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Search className="h-3 w-3 text-muted-foreground" />
            )}
            <span>{item}</span>
          </div>
          {showHistory && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item);
              }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </motion.div>
  );
}
