import {
  applyCacheCheckpoint,
  calculateCheckpointPosition,
  DEFAULT_CHECKPOINT_INTERVAL,
} from '@/lib/ai/cache-checkpoints';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'bun:test';

// Helper to create text messages with specific content
function createTextMessage(
  role: 'user' | 'assistant',
  text: string
): ModelMessage {
  return {
    role,
    content: [{ type: 'text', text }],
  };
}

// Helper to generate a string of specified length
function generateText(length: number): string {
  return 'x'.repeat(length);
}

describe('calculateCheckpointPosition', () => {
  it('returns -1 for empty messages', () => {
    const result = calculateCheckpointPosition([]);
    expect(result.checkpointIndex).toBe(-1);
    expect(result.totalChars).toBe(0);
  });

  it('returns -1 when total chars have not crossed first interval', () => {
    const messages: ModelMessage[] = [
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(4000)),
    ];
    const result = calculateCheckpointPosition(messages, {
      checkpointInterval: 10000,
    });
    // 9000 total, hasn't crossed 10000
    expect(result.checkpointIndex).toBe(-1);
    expect(result.totalChars).toBe(9000);
  });

  it('finds checkpoint at the last interval crossing', () => {
    // 5000 + 5000 = 10000 (crosses 10k at index 1)
    // 10000 + 5000 = 15000 (no new crossing)
    // 15000 + 5000 = 20000 (crosses 20k at index 3)
    // 20000 + 3000 = 23000 (no new crossing)
    const messages: ModelMessage[] = [
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(3000)),
    ];

    const result = calculateCheckpointPosition(messages, {
      checkpointInterval: 10000,
    });

    // Last crossing was at 20k chars (index 3)
    expect(result.checkpointIndex).toBe(3);
    expect(result.totalChars).toBe(23000);
  });

  it('respects custom checkpoint interval', () => {
    const messages: ModelMessage[] = [
      createTextMessage('user', generateText(3000)),
      createTextMessage('assistant', generateText(3000)),
      createTextMessage('user', generateText(3000)),
    ];

    const result = calculateCheckpointPosition(messages, {
      checkpointInterval: 5000,
    });

    // 3000 (no crossing), 6000 (crosses 5k at index 1), 9000 (no new crossing)
    expect(result.checkpointIndex).toBe(1);
  });

  it('returns the single last checkpoint even with many crossings', () => {
    const messages: ModelMessage[] = [];
    // Create 10 messages, each 10000 chars - crosses at 10k, 20k, 30k, etc.
    for (let i = 0; i < 10; i++) {
      messages.push(createTextMessage('user', generateText(10000)));
    }

    const result = calculateCheckpointPosition(messages, {
      checkpointInterval: 10000,
    });

    // Last crossing is at 100k (index 9)
    expect(result.checkpointIndex).toBe(9);
    expect(result.totalChars).toBe(100000);
  });
});

describe('applyCacheCheckpoint', () => {
  describe('when no checkpoint (conversation too short)', () => {
    const shortMessages: ModelMessage[] = [
      createTextMessage('user', generateText(5000)),
    ];

    it('returns messages unchanged for any provider', () => {
      const openaiResult = applyCacheCheckpoint(shortMessages, 'openai');
      const openrouterResult = applyCacheCheckpoint(
        shortMessages,
        'openrouter'
      );
      const googleResult = applyCacheCheckpoint(shortMessages, 'google');

      expect(openaiResult.messages).toEqual(shortMessages);
      expect(openrouterResult.messages).toEqual(shortMessages);
      expect(googleResult.messages).toEqual(shortMessages);
    });

    it('returns null promptCacheKey', () => {
      const result = applyCacheCheckpoint(shortMessages, 'openai');
      expect(result.promptCacheKey).toBeNull();
    });

    it('returns checkpointIndex -1', () => {
      const result = applyCacheCheckpoint(shortMessages, 'openai');
      expect(result.checkpointIndex).toBe(-1);
    });
  });

  describe('OpenRouter provider', () => {
    const longMessages: ModelMessage[] = [
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(3000)),
    ];

    it('adds cacheControl only to the checkpoint message', () => {
      const result = applyCacheCheckpoint(longMessages, 'openrouter', {
        checkpointInterval: 10000,
      });

      // Checkpoint at index 3 (20k crossing)
      expect(result.checkpointIndex).toBe(3);
      expect(result.promptCacheKey).not.toBeNull();
      expect(result.promptCacheKey).toHaveLength(32);

      // Only index 3 should have cache control
      expect(result.messages[0].providerOptions).toBeUndefined();
      expect(result.messages[1].providerOptions).toBeUndefined();
      expect(result.messages[2].providerOptions).toBeUndefined();
      expect(
        result.messages[3].providerOptions?.anthropic?.cacheControl
      ).toEqual({
        type: 'ephemeral',
        ttl: '1h',
      });
      expect(result.messages[4].providerOptions).toBeUndefined();
    });

    it('generates a promptCacheKey', () => {
      const result = applyCacheCheckpoint(longMessages, 'openrouter');
      expect(result.promptCacheKey).not.toBeNull();
      expect(result.promptCacheKey).toHaveLength(32);
    });

    it('preserves existing providerOptions on checkpoint message', () => {
      const messagesWithOptions: ModelMessage[] = [
        {
          ...createTextMessage('user', generateText(12000)),
          providerOptions: {
            anthropic: { someOther: 'value' },
            custom: { option: true },
          },
        },
      ];

      const result = applyCacheCheckpoint(messagesWithOptions, 'openrouter', {
        checkpointInterval: 10000,
      });

      expect(
        result.messages[0].providerOptions?.anthropic?.cacheControl
      ).toEqual({
        type: 'ephemeral',
        ttl: '1h',
      });
      expect(result.messages[0].providerOptions?.anthropic?.someOther).toBe(
        'value'
      );
      expect(result.messages[0].providerOptions?.custom).toEqual({
        option: true,
      });
    });

    it('generates stable cache key for same messages', () => {
      const result1 = applyCacheCheckpoint(longMessages, 'openrouter', {
        checkpointInterval: 10000,
      });
      const result2 = applyCacheCheckpoint(longMessages, 'openrouter', {
        checkpointInterval: 10000,
      });

      expect(result1.promptCacheKey).toBe(result2.promptCacheKey);
    });

    it('generates different cache key when checkpoint changes', () => {
      const result1 = applyCacheCheckpoint(longMessages, 'openrouter', {
        checkpointInterval: 10000,
      });

      const extendedMessages = [
        ...longMessages,
        createTextMessage('assistant', generateText(8000)),
      ];
      const result2 = applyCacheCheckpoint(extendedMessages, 'openrouter', {
        checkpointInterval: 10000,
      });

      expect(result1.checkpointIndex).not.toBe(result2.checkpointIndex);
      expect(result1.promptCacheKey).not.toBe(result2.promptCacheKey);
    });
  });

  describe('OpenAI provider', () => {
    const longMessages: ModelMessage[] = [
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(5000)),
      createTextMessage('assistant', generateText(5000)),
      createTextMessage('user', generateText(3000)),
    ];

    it('returns messages unchanged', () => {
      const result = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });

      expect(result.messages).toEqual(longMessages);
    });

    it('generates a promptCacheKey', () => {
      const result = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });

      expect(result.promptCacheKey).not.toBeNull();
      expect(result.promptCacheKey).toHaveLength(32);
    });

    it('returns correct checkpointIndex', () => {
      const result = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });

      expect(result.checkpointIndex).toBe(3);
    });

    it('generates stable cache key for same messages', () => {
      const result1 = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });
      const result2 = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });

      expect(result1.promptCacheKey).toBe(result2.promptCacheKey);
    });

    it('generates different cache key when checkpoint changes', () => {
      const result1 = applyCacheCheckpoint(longMessages, 'openai', {
        checkpointInterval: 10000,
      });

      // Add more messages to shift the checkpoint
      const extendedMessages = [
        ...longMessages,
        createTextMessage('assistant', generateText(8000)),
      ];
      const result2 = applyCacheCheckpoint(extendedMessages, 'openai', {
        checkpointInterval: 10000,
      });

      // Different checkpoint positions should yield different keys
      expect(result1.checkpointIndex).not.toBe(result2.checkpointIndex);
      expect(result1.promptCacheKey).not.toBe(result2.promptCacheKey);
    });
  });

  describe('unsupported providers', () => {
    const longMessages: ModelMessage[] = [
      createTextMessage('user', generateText(15000)),
    ];

    it('returns messages unchanged for google', () => {
      const result = applyCacheCheckpoint(longMessages, 'google');
      expect(result.messages).toEqual(longMessages);
      expect(result.promptCacheKey).toBeNull();
      expect(result.checkpointIndex).toBe(-1);
    });

    it('returns messages unchanged for xai', () => {
      const result = applyCacheCheckpoint(longMessages, 'xai');
      expect(result.messages).toEqual(longMessages);
      expect(result.promptCacheKey).toBeNull();
      expect(result.checkpointIndex).toBe(-1);
    });
  });
});

describe('constants', () => {
  it('has sensible default checkpoint interval', () => {
    expect(DEFAULT_CHECKPOINT_INTERVAL).toBe(10_000);
  });
});
