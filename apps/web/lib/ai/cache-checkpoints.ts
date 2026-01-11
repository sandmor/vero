import type { ModelMessage } from 'ai';
import { createHash } from 'crypto';

/**
 * Default character interval for cache checkpoints.
 * The checkpoint will be placed at the last message that crosses
 * a multiple of this interval, ensuring a stable cache prefix.
 */
export const DEFAULT_CHECKPOINT_INTERVAL = 10_000;

/**
 * Gets the character count from a message's content.
 */
function getMessageCharCount(message: ModelMessage): number {
  const content = message.content;

  if (!Array.isArray(content)) {
    return 0;
  }

  return content.reduce((sum, part) => {
    if (part && typeof part === 'object' && 'text' in part) {
      return sum + ((part.text as string)?.length ?? 0);
    }
    return sum;
  }, 0);
}

/**
 * Serializes messages up to a given index for cache key generation.
 */
function serializeMessagesForCacheKey(
  messages: ModelMessage[],
  endIndex: number
): string {
  const subset = messages.slice(0, endIndex + 1);
  return JSON.stringify(
    subset.map((m) => ({
      role: m.role,
      content: m.content,
    }))
  );
}

export type CheckpointCacheOptions = {
  /**
   * Character interval for checkpoint calculation.
   * The checkpoint is placed at the message where cumulative chars
   * last crossed a multiple of this interval.
   * @default 10000
   */
  checkpointInterval?: number;
};

export type CheckpointResult = {
  /**
   * The index of the message to place the checkpoint on, or -1 if no checkpoint.
   */
  checkpointIndex: number;

  /**
   * Total characters in all messages.
   */
  totalChars: number;
};

/**
 * Calculates the optimal checkpoint position for caching in a conversation.
 *
 * This finds the last message index where the cumulative character count
 * crosses a checkpoint interval boundary. By placing a cache breakpoint
 * at this position, the LLM provider can cache the conversation prefix
 * up to and including that message.
 *
 * For a conversation with 45,000 characters and a 10,000 char interval:
 * - The checkpoint is placed at the message where we crossed 40,000 chars
 * - This gives a stable cache prefix that won't change as the conversation grows
 *
 * Returns -1 if the total conversation length hasn't crossed the first interval yet.
 *
 * @param messages - Array of model messages to analyze
 * @param options.checkpointInterval - Character interval (default: 10000)
 *
 * @returns The checkpoint index (-1 if none) and total character count
 */
export function calculateCheckpointPosition(
  messages: ModelMessage[],
  options: CheckpointCacheOptions = {}
): CheckpointResult {
  const { checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL } = options;

  if (messages.length === 0) {
    return { checkpointIndex: -1, totalChars: 0 };
  }

  let totalChars = 0;
  let lastCheckpointIndex = -1;
  let lastCheckpointThreshold = 0;

  for (let i = 0; i < messages.length; i++) {
    totalChars += getMessageCharCount(messages[i]);

    // Check if we crossed a new checkpoint threshold
    const currentThreshold =
      Math.floor(totalChars / checkpointInterval) * checkpointInterval;

    if (currentThreshold > lastCheckpointThreshold) {
      lastCheckpointIndex = i;
      lastCheckpointThreshold = currentThreshold;
    }
  }

  return { checkpointIndex: lastCheckpointIndex, totalChars };
}

/**
 * Result from applying cache checkpoint logic.
 */
export type CacheCheckpointResult = {
  /**
   * Messages with cache control applied (for OpenRouter).
   * For other providers, same as input messages.
   */
  messages: ModelMessage[];

  /**
   * Cache key for OpenAI prompt caching, derived from messages up to checkpoint.
   * Null if no checkpoint was found or provider doesn't use cache keys.
   */
  promptCacheKey: string | null;

  /**
   * The checkpoint index that was used, or -1 if none.
   */
  checkpointIndex: number;
};

/**
 * Applies cache checkpoint logic to messages based on provider.
 *
 * For OpenRouter: Adds cacheControl to the checkpoint message's providerOptions
 * and generates a promptCacheKey compatible with OpenAI-style caching.
 * For OpenAI: Generates a promptCacheKey from messages up to the checkpoint.
 * For other providers: Returns messages unchanged with no cache key.
 *
 * If the conversation hasn't crossed the first checkpoint interval yet,
 * returns without modifications (existing system prompt caching handles short conversations).
 *
 * @param messages - Array of model messages
 * @param providerId - The resolved provider ID (e.g., 'openrouter', 'openai')
 * @param options - Checkpoint calculation options
 *
 * @returns Messages (possibly modified), optional cache key, and checkpoint index
 */
export function applyCacheCheckpoint(
  messages: ModelMessage[],
  providerId: string,
  options: CheckpointCacheOptions = {}
): CacheCheckpointResult {
  const normalizedProviderId = providerId?.toLowerCase?.() ?? '';
  const isOpenRouter =
    normalizedProviderId === 'openrouter' ||
    normalizedProviderId.startsWith('openrouter:');
  const isOpenAI = normalizedProviderId === 'openai';

  const { checkpointIndex } = calculateCheckpointPosition(messages, options);

  // No checkpoint found - conversation too short for checkpoint caching
  if (checkpointIndex < 0) {
    return {
      messages,
      promptCacheKey: null,
      checkpointIndex: -1,
    };
  }

  const shouldGeneratePromptCacheKey = isOpenAI || isOpenRouter;
  const promptCacheKey = shouldGeneratePromptCacheKey
    ? createHash('sha256')
        .update(serializeMessagesForCacheKey(messages, checkpointIndex))
        .digest('hex')
        .slice(0, 32)
    : null;

  if (isOpenRouter) {
    // OpenRouter: Add cacheControl to the checkpoint message
    const cacheControl = { type: 'ephemeral' as const, ttl: '1h' as const };

    const modifiedMessages = messages.map((message, index) => {
      if (index !== checkpointIndex) {
        return message;
      }

      return {
        ...message,
        providerOptions: {
          ...message.providerOptions,
          anthropic: {
            ...(message.providerOptions?.anthropic as
              | Record<string, unknown>
              | undefined),
            cacheControl,
          },
        },
      };
    });

    return {
      messages: modifiedMessages,
      promptCacheKey,
      checkpointIndex,
    };
  }

  if (isOpenAI) {
    // OpenAI: Generate a cache key from messages up to checkpoint
    return {
      messages,
      promptCacheKey,
      checkpointIndex,
    };
  }

  // Other providers: no checkpoint caching support
  return {
    messages,
    promptCacheKey: null,
    checkpointIndex: -1,
  };
}
