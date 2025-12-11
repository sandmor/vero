import {
  type CachedChatPayload,
} from '@/lib/cache/cache-manager';
import type { CachedChatRecord } from '@/lib/cache/types';
import {
  generateSnippet,
} from '@/lib/search/snippet-helper';
import {
  findMatchPositions,
  calculateScore,
  parseSearchQuery,
  type SearchOptions,
  type SearchMatch,
  type DateFilter,
} from '@/lib/search/search-utils'; // We'll need to export these from search-utils

export interface MessageSearchResult {
  id: string; // Message ID
  chatId: string;
  chatTitle: string;
  createdAt: Date;
  content: string; // Full text content
  snippet: string; // Highlighted snippet
  score: number;
}

/**
 * Perform a search through cached chats and their message history.
 * 
 * NOTE: This function is computationally intensive as it iterates through 
 * all messages in all cached chats. It should be used with debounce and possibly
 * inside a Web Worker if the dataset grows very large.
 */
export function searchCachedMessages(
  cachedChats: CachedChatPayload<CachedChatRecord>[],
  query: string,
  options: SearchOptions = {},
  dateFilter?: DateFilter
): MessageSearchResult[] {
  if (!query.trim()) return [];

  const parsedQuery = parseSearchQuery(query);
  const allTerms = [...parsedQuery.terms, ...parsedQuery.exactPhrases];

  if (allTerms.length === 0) return [];

  const results: MessageSearchResult[] = [];

  for (const record of cachedChats) {
    // Skip if no bootstrap data or messages
    const messages = record.data.bootstrap?.initialMessages;
    if (!messages || messages.length === 0) continue;

    const chatTitle = record.data.chat.title;
    const chatId = record.chatId;

    for (const message of messages) {
      // Check date filter
      const createdAt = message.createdAt instanceof Date
        ? message.createdAt
        : new Date(message.createdAt);

      if (dateFilter) {
        if (dateFilter.after && createdAt < dateFilter.after) continue;
        if (dateFilter.before && createdAt > dateFilter.before) continue;
      }

      // Extract text content from message parts
      let fullText = '';
      if (Array.isArray(message.parts)) {
        fullText = message.parts
          .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
          .map((p: any) => p.text)
          .join(' ');
      }

      if (!fullText) continue;

      // Perform search on this message text
      let totalScore = 0;
      const allMatches: SearchMatch[] = [];
      let termMatched = false;

      for (const term of allTerms) {
        const termOptions = parsedQuery.exactPhrases.includes(term)
          ? { ...options, fuzzy: false, wholeWord: false }
          : options;

        const positions = findMatchPositions(fullText, term, termOptions);

        if (positions.length > 0) {
          termMatched = true;
          const score = calculateScore(positions, fullText.length, term.length);
          totalScore += score;
          allMatches.push(...positions);
        }
      }

      // Add to results if we found matches
      if (termMatched && totalScore > 0) {
        const snippet = generateSnippet(fullText, allMatches);

        results.push({
          id: message.id,
          chatId,
          chatTitle,
          createdAt,
          content: fullText,
          snippet,
          score: totalScore,
        });
      }
    }
  }

  // Sort by score descending (default)
  return results.sort((a, b) => b.score - a.score);
}
