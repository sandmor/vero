/**
 * Search utilities for client-side full-text search with fuzzy matching,
 * highlighting, and advanced filtering capabilities.
 */

export type SearchMatchType = 'exact' | 'fuzzy' | 'prefix' | 'word';

export interface SearchMatch {
  start: number;
  end: number;
  matchType: SearchMatchType;
}

export interface SearchResult<T> {
  item: T;
  score: number;
  matches: {
    field: string;
    value: string;
    positions: SearchMatch[];
  }[];
}

export interface SearchOptions {
  /** Enable fuzzy matching (allows small typos) */
  fuzzy?: boolean;
  /** Maximum edit distance for fuzzy matching (default: 2) */
  maxDistance?: number;
  /** Minimum score threshold (0-1) to include results */
  minScore?: number;
  /** Whether search is case-sensitive */
  caseSensitive?: boolean;
  /** Match whole words only */
  wholeWord?: boolean;
  /** Use prefix matching (matches beginning of words) */
  prefixMatch?: boolean;
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
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find all positions where a term matches in a text
 */
function findMatchPositions(
  text: string,
  term: string,
  options: SearchOptions
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  const normalizedText = options.caseSensitive ? text : text.toLowerCase();
  const normalizedTerm = options.caseSensitive ? term : term.toLowerCase();

  // Exact matching
  let startIndex = 0;
  let index: number;
  while ((index = normalizedText.indexOf(normalizedTerm, startIndex)) !== -1) {
    const isWordBoundary =
      !options.wholeWord ||
      ((index === 0 || /\W/.test(normalizedText[index - 1])) &&
        (index + normalizedTerm.length === normalizedText.length ||
          /\W/.test(normalizedText[index + normalizedTerm.length])));

    if (isWordBoundary) {
      matches.push({
        start: index,
        end: index + normalizedTerm.length,
        matchType: 'exact',
      });
    }
    startIndex = index + 1;
  }

  // Prefix matching
  if (options.prefixMatch && matches.length === 0) {
    const words = normalizedText.split(/\s+/);
    let currentIndex = 0;

    for (const word of words) {
      const wordStart = normalizedText.indexOf(word, currentIndex);
      if (word.startsWith(normalizedTerm)) {
        matches.push({
          start: wordStart,
          end: wordStart + normalizedTerm.length,
          matchType: 'prefix',
        });
      }
      currentIndex = wordStart + word.length;
    }
  }

  // Fuzzy matching
  if (options.fuzzy && matches.length === 0) {
    const maxDistance = options.maxDistance ?? 2;
    const words = normalizedText.split(/\s+/);
    let currentIndex = 0;

    for (const word of words) {
      const wordStart = normalizedText.indexOf(word, currentIndex);
      const distance = levenshteinDistance(word, normalizedTerm);

      if (distance <= maxDistance && distance > 0) {
        matches.push({
          start: wordStart,
          end: wordStart + word.length,
          matchType: 'fuzzy',
        });
      }
      currentIndex = wordStart + word.length;
    }
  }

  return matches;
}

/**
 * Calculate a relevance score based on matches
 */
function calculateScore(
  matches: SearchMatch[],
  textLength: number,
  termLength: number
): number {
  if (matches.length === 0) return 0;

  let score = 0;

  for (const match of matches) {
    // Base score for having a match
    let matchScore = 1;

    // Boost for exact matches
    if (match.matchType === 'exact') {
      matchScore *= 2;
    } else if (match.matchType === 'prefix') {
      matchScore *= 1.5;
    } else if (match.matchType === 'fuzzy') {
      matchScore *= 0.7;
    }

    // Boost for matches at the beginning
    if (match.start === 0) {
      matchScore *= 1.5;
    }

    // Boost for longer matches relative to text length
    const matchLength = match.end - match.start;
    matchScore *= matchLength / Math.max(textLength, 1);

    score += matchScore;
  }

  // Normalize score
  return Math.min(score, 1);
}

/**
 * Parse search query for advanced operators
 * Supports: "exact phrase", -exclude, field:value
 */
export interface ParsedQuery {
  terms: string[];
  exactPhrases: string[];
  excludeTerms: string[];
  fieldQueries: Record<string, string>;
}

export function parseSearchQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    terms: [],
    exactPhrases: [],
    excludeTerms: [],
    fieldQueries: {},
  };

  // Extract exact phrases (quoted strings)
  const phraseRegex = /"([^"]+)"/g;
  let match;
  let processedQuery = query;

  while ((match = phraseRegex.exec(query)) !== null) {
    result.exactPhrases.push(match[1]);
    processedQuery = processedQuery.replace(match[0], '');
  }

  // Extract field queries (field:value)
  const fieldRegex = /(\w+):(\S+)/g;
  while ((match = fieldRegex.exec(processedQuery)) !== null) {
    result.fieldQueries[match[1]] = match[2];
    processedQuery = processedQuery.replace(match[0], '');
  }

  // Process remaining terms
  const terms = processedQuery.split(/\s+/).filter((term) => term.length > 0);

  for (const term of terms) {
    if (term.startsWith('-') && term.length > 1) {
      result.excludeTerms.push(term.slice(1));
    } else {
      result.terms.push(term);
    }
  }

  return result;
}

/**
 * Perform a search on a collection of items
 */
export function search<T extends Record<string, unknown>>(
  items: T[],
  query: string,
  searchFields: (keyof T)[],
  options: SearchOptions = {}
): SearchResult<T>[] {
  if (!query.trim()) return [];

  const parsedQuery = parseSearchQuery(query);
  const allTerms = [...parsedQuery.terms, ...parsedQuery.exactPhrases];

  if (
    allTerms.length === 0 &&
    Object.keys(parsedQuery.fieldQueries).length === 0
  ) {
    return [];
  }

  const results: SearchResult<T>[] = [];

  for (const item of items) {
    let totalScore = 0;
    const allMatches: SearchResult<T>['matches'] = [];
    let excluded = false;

    // Check for excluded terms
    for (const excludeTerm of parsedQuery.excludeTerms) {
      for (const field of searchFields) {
        const value = String(item[field] ?? '');
        if (value.toLowerCase().includes(excludeTerm.toLowerCase())) {
          excluded = true;
          break;
        }
      }
      if (excluded) break;
    }

    if (excluded) continue;

    // Check field queries
    let fieldQueryMatch = true;
    for (const [field, queryValue] of Object.entries(
      parsedQuery.fieldQueries
    )) {
      const itemValue = item[field as keyof T];
      if (itemValue !== undefined) {
        const itemValueStr = String(itemValue).toLowerCase();
        if (!itemValueStr.includes(queryValue.toLowerCase())) {
          fieldQueryMatch = false;
          break;
        }
      } else {
        fieldQueryMatch = false;
        break;
      }
    }

    if (!fieldQueryMatch) continue;

    // Search in each field
    for (const field of searchFields) {
      const value = String(item[field] ?? '');

      for (const term of allTerms) {
        const termOptions = parsedQuery.exactPhrases.includes(term)
          ? { ...options, fuzzy: false, wholeWord: false }
          : options;

        const positions = findMatchPositions(value, term, termOptions);

        if (positions.length > 0) {
          const score = calculateScore(positions, value.length, term.length);
          totalScore += score;

          allMatches.push({
            field: String(field),
            value,
            positions,
          });
        }
      }
    }

    // Only include if we have matches or field queries matched
    if (
      allMatches.length > 0 ||
      Object.keys(parsedQuery.fieldQueries).length > 0
    ) {
      const minScore = options.minScore ?? 0;
      const normalizedScore = totalScore / Math.max(allTerms.length, 1);

      if (
        normalizedScore >= minScore ||
        Object.keys(parsedQuery.fieldQueries).length > 0
      ) {
        results.push({
          item,
          score: normalizedScore,
          matches: allMatches,
        });
      }
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  return results;
}

/**
 * Apply date filters to search results
 */
export function applyDateFilter<T extends { createdAt: Date | string }>(
  items: T[],
  filter: DateFilter
): T[] {
  return items.filter((item) => {
    const date =
      item.createdAt instanceof Date
        ? item.createdAt
        : new Date(item.createdAt);

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

export function highlightMatches(
  text: string,
  matches: SearchMatch[]
): HighlightSegment[] {
  if (matches.length === 0) {
    return [{ text, highlighted: false }];
  }

  // Sort matches by start position
  const sortedMatches = [...matches].sort((a, b) => a.start - b.start);

  // Merge overlapping matches
  const mergedMatches: SearchMatch[] = [];
  for (const match of sortedMatches) {
    const last = mergedMatches[mergedMatches.length - 1];
    if (last && match.start <= last.end) {
      last.end = Math.max(last.end, match.end);
    } else {
      mergedMatches.push({ ...match });
    }
  }

  // Create segments
  const segments: HighlightSegment[] = [];
  let lastEnd = 0;

  for (const match of mergedMatches) {
    if (match.start > lastEnd) {
      segments.push({
        text: text.slice(lastEnd, match.start),
        highlighted: false,
      });
    }
    segments.push({
      text: text.slice(match.start, match.end),
      highlighted: true,
    });
    lastEnd = match.end;
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
 * Generate search suggestions based on search history and common patterns
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
    } else {
      // Fuzzy match
      const distance = levenshteinDistance(
        normalizedQuery,
        normalizedHistory.slice(0, normalizedQuery.length + 2)
      );
      if (distance <= 2) {
        suggestions.push({ text: historyItem, score: 1 });
      }
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
