/**
 * Simple match position for snippet generation
 */
export interface MatchPosition {
  start: number;
  end: number;
}

/**
 * Helper to generate a text snippet from a full text string and match positions
 */
export function generateSnippet(
  text: string,
  matches: MatchPosition[],
  padding: number = 60
): string {
  if (!matches || matches.length === 0) {
    return text.length > padding * 2
      ? text.substring(0, padding * 2) + '...'
      : text;
  }

  // Use the first match for the snippet center
  const bestMatch = matches[0];

  const start = Math.max(0, bestMatch.start - padding);
  const end = Math.min(text.length, bestMatch.end + padding);

  let snippet = text.substring(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
}
