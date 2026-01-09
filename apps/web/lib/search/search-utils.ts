/**
 * Search utilities for client-side full-text search.
 * Uses the advanced query parser for Lucene-like syntax support.
 */

// Re-export advanced query parser types and functions
export {
  parseAdvancedQuery,
  extractTerms,
  extractPhrases,
  toSimpleQuery,
  containsPhrase,
  matchesAllPhrases,
  type QueryNode,
  type ParsedAdvancedQuery,
  type TokenizerFn,
} from './query-parser';

export interface SearchResult<T> {
  item: T;
  score: number;
  matches: {
    field: string;
    value: string;
  }[];
}

export interface DateFilter {
  after?: Date;
  before?: Date;
}

export interface SearchFilters {
  dateRange?: DateFilter;
  /** Filter by specific field values */
  fieldFilters?: Record<string, string | string[]>;
}

/**
 * Apply date filters to search results
 */
export function applyDateFilter<T extends { updatedAt: Date | string }>(
  items: T[],
  filter: DateFilter
): T[] {
  return items.filter((item) => {
    const date =
      item.updatedAt instanceof Date
        ? item.updatedAt
        : new Date(item.updatedAt);

    if (filter.after && date < filter.after) return false;
    if (filter.before && date > filter.before) return false;

    return true;
  });
}

/**
 * Highlight matched text with HTML/React-safe markers
 */
export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

/**
 * Find positions of a phrase in text (case-insensitive)
 */
export function findPhrasePositions(
  text: string,
  phrase: string
): { start: number; end: number }[] {
  const positions: { start: number; end: number }[] = [];
  const lowerText = text.toLowerCase();
  const lowerPhrase = phrase.toLowerCase();

  let startIndex = 0;
  let index: number;
  while ((index = lowerText.indexOf(lowerPhrase, startIndex)) !== -1) {
    positions.push({
      start: index,
      end: index + phrase.length,
    });
    startIndex = index + 1;
  }

  return positions;
}

/**
 * Highlight matched phrases in text
 */
export function highlightPhrases(
  text: string,
  phrases: string[]
): HighlightSegment[] {
  if (phrases.length === 0) {
    return [{ text, highlighted: false }];
  }

  // Find all positions for all phrases
  const allPositions: { start: number; end: number }[] = [];
  for (const phrase of phrases) {
    allPositions.push(...findPhrasePositions(text, phrase));
  }

  if (allPositions.length === 0) {
    return [{ text, highlighted: false }];
  }

  // Sort by start position
  allPositions.sort((a, b) => a.start - b.start);

  // Merge overlapping positions
  const merged: { start: number; end: number }[] = [];
  for (const pos of allPositions) {
    const last = merged[merged.length - 1];
    if (last && pos.start <= last.end) {
      last.end = Math.max(last.end, pos.end);
    } else {
      merged.push({ ...pos });
    }
  }

  // Create segments
  const segments: HighlightSegment[] = [];
  let lastEnd = 0;

  for (const pos of merged) {
    if (pos.start > lastEnd) {
      segments.push({
        text: text.slice(lastEnd, pos.start),
        highlighted: false,
      });
    }
    segments.push({
      text: text.slice(pos.start, pos.end),
      highlighted: true,
    });
    lastEnd = pos.end;
  }

  if (lastEnd < text.length) {
    segments.push({
      text: text.slice(lastEnd),
      highlighted: false,
    });
  }

  return segments;
}

/**
 * Generate search suggestions based on search history
 */
export function generateSuggestions(
  query: string,
  searchHistory: string[],
  maxSuggestions = 5
): string[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  const suggestions: { text: string; score: number }[] = [];

  for (const historyItem of searchHistory) {
    const normalizedHistory = historyItem.toLowerCase();

    if (normalizedHistory.startsWith(normalizedQuery)) {
      // Exact prefix match - highest score
      suggestions.push({ text: historyItem, score: 3 });
    } else if (normalizedHistory.includes(normalizedQuery)) {
      // Contains the query
      suggestions.push({ text: historyItem, score: 2 });
    }
  }

  // Sort by score and return unique suggestions
  const seen = new Set<string>();
  return suggestions
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const lower = s.text.toLowerCase();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    })
    .slice(0, maxSuggestions)
    .map((s) => s.text);
}
