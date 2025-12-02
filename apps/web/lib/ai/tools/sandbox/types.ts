/**
 * Type definitions for the sandbox execution system.
 */

import type { SerializableError } from './errors';
import type { LocationHints } from './api-bridge';

/**
 * Supported execution language
 */
export type SupportedLanguage = 'javascript';

/**
 * Execution summary from sandbox
 */
export interface ExecutionSummary {
  status: 'ok' | 'error';
  value: unknown;
  error: unknown;
  stdout: string[];
  stderr: string[];
  truncatedStdout: number;
  truncatedStderr: number;
}

/**
 * Environment metadata
 */
export interface ExecutionEnvironment {
  language: SupportedLanguage;
  runtime: 'nodejs-vm';
  timeoutMs: number;
  limits: {
    maxCodeLength: number;
    maxLogLines: number;
    maxCollectionItems: number;
  };
  locationHints: LocationHints | null;
  warnings: string[];
}

/**
 * Base result structure
 */
interface ExecutionResultBase {
  stdout: string[];
  stderr: string[];
  truncatedStdout: number;
  truncatedStderr: number;
  runtimeMs: number;
  codeSize: number;
  environment: ExecutionEnvironment;
}

/**
 * Successful execution result
 */
export interface SuccessResult extends ExecutionResultBase {
  status: 'ok';
  result: unknown;
  error: null;
}

/**
 * Failed execution result
 */
export interface ErrorResult extends ExecutionResultBase {
  status: 'error';
  result: null;
  error: SerializableError;
}

/**
 * Union of all possible execution results
 */
export type ExecutionResult = SuccessResult | ErrorResult;

/**
 * Input for code execution
 */
export interface ExecutionInput {
  language?: SupportedLanguage;
  code: string;
  timeoutMs?: number;
}

/**
 * Request hints that may contain location information
 */
export interface RequestHints {
  latitude?: unknown;
  longitude?: unknown;
  city?: unknown;
  country?: unknown;
}
