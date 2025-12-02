import { tool } from 'ai';
import { z } from 'zod';
import type { RequestHints } from '@/lib/ai/prompts';
import { SANDBOX_CONFIG } from './sandbox/config';
import { executeSandboxCode } from './sandbox/executor';

type RunCodeOptions = {
  requestHints: RequestHints;
};

/**
 * Creates a tool for executing sandboxed JavaScript code.
 * Provides a secure execution environment with limited external API access.
 */
export function runCode({ requestHints }: RunCodeOptions) {
  return tool({
    description:
      'Execute sandboxed JavaScript using Node.js VM (Promises supported). Use the global `api` helpers to access external data. Console output is captured and returned.',
    inputSchema: z.object({
      language: z.literal('javascript').optional().default('javascript'),
      code: z.string().min(1).max(SANDBOX_CONFIG.MAX_CODE_LENGTH),
      timeoutMs: z
        .number()
        .int()
        .min(SANDBOX_CONFIG.MIN_TIMEOUT_MS)
        .max(SANDBOX_CONFIG.MAX_TIMEOUT_MS)
        .optional(),
    }),
    execute: async ({ language = 'javascript', code, timeoutMs }) => {
      return executeSandboxCode({ language, code, timeoutMs }, requestHints);
    },
  });
}
