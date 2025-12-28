import type {
  ModelMessage,
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, MessageTreeNode } from '@/lib/db/schema';
import { ChatSDKError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause } = await response.json();
    throw new ChatSDKError(code as ErrorCode, cause);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause } = await response.json();
      throw new ChatSDKError(code as ErrorCode, cause);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatSDKError('offline:chat');
    }

    throw error;
  }
}

export function getLocalStorage(key: string) {
  if (typeof window !== 'undefined') {
    return JSON.parse(localStorage.getItem(key) || '[]');
  }
  return [];
}

export function generateUUID(): string {
  // Use native crypto.randomUUID() if available (modern browsers including iOS Safari 15.4+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // Compliant UUID v4 fallback using crypto.getRandomValues()
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    
    // Set version (4) and variant bits according to RFC 4122
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    
    // Convert to hex string with proper formatting
    const hexString = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    
    return [
      hexString.slice(0, 8),
      hexString.slice(8, 12),
      hexString.slice(12, 16),
      hexString.slice(16, 20),
      hexString.slice(20, 32),
    ].join('-');
  }
  
  // Last resort fallback (should rarely be needed)
  // This uses Math.random() but with proper UUID v4 bit manipulation
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return UUID_REGEX.test(trimmed);
}

type ResponseMessage = ModelMessage & { id: string };

export function getMostRecentUserMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((message) => message.role === 'user');
  return userMessages.at(-1);
}



export function getTrailingMessageId({
  messages,
}: {
  messages: ResponseMessage[];
}): string | null {
  const trailingMessage = messages.at(-1);

  if (!trailingMessage) { return null; }

  return trailingMessage.id;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

/**
 * Convert common LaTeX math delimiters to the forms understood by remark-math.
 * remark-math (as configured in streamdown) supports `$...$` (inline) and `$$...$$` (block) by default.
 * Users (and many models) frequently emit `\( ... \)` and `\[ ... \]` delimiters; we normalize those here.
 *
 * We avoid transforming code blocks / inline code segments. The strategy:
 *  - Split the markdown on code spans & fenced code blocks using a regex capturing group
 *  - Only transform segments that are plain text (i.e., not starting with backticks)
 *  - Inside those segments, replace balanced `\[ ... \]` first (block math) then `\( ... \)` (inline math)
 *
 * Block math is wrapped with blank lines to ensure it renders as display math even if user omitted spacing.
 * We purposefully do not touch existing `$` or `$$` math to avoid double‑converting.
 */
export function normalizeLatexMathDelimiters(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return markdown;

  const codeLikePattern = /(```[\s\S]*?```|`[^`]*`)/g; // fenced or inline code
  const parts = markdown.split(codeLikePattern);

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment.match(codeLikePattern)) continue; // skip code spans / blocks

    // If the segment already contains an inline math dollar pattern, we will not convert \( ... \)
    // to avoid situations where a model mixes notations and we interfere with already-correct parsing.
    const hasInlineDollar = /(^|[^$])\$[^$]+\$/m.test(segment);

    let transformed = segment;

    // Display blocks: \[ ... \] => $$...$$ (with enforced blank lines for remark-math)
    transformed = transformed.replace(/(^|\s)\\\[((?:[^\\]|\\.)*?)\\\]/g, (_m, prefix, inner) => {
      const content = inner.trim();
      if (!content) return prefix; // retain the leading space/newline if empty
      return `${prefix}\n\n$$${content}$$\n\n`;
    });

    if (!hasInlineDollar) {
      // Inline: \( ... \) => $...$
      transformed = transformed.replace(/\\\(((?:[^\\]|\\.)*?)\\\)/g, (_m, inner) => {
        const content = inner.trim();
        if (!content) return '';
        return `$${content}$`;
      });
    }

    parts[i] = transformed;
  }

  return parts.join('');
}

export function convertToUIMessages(messages: MessageTreeNode[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
      model: message.model ?? undefined,
      siblingIndex: message.siblingIndex,
      siblingsCount: message.siblingsCount,
    },
  }));
}

export function getTextFromMessage(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
