/**
 * Custom error classes for the sandbox execution environment.
 * Provides a clear hierarchy and better error handling.
 */

export class SandboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SandboxError';
  }
}

export class TimeoutError extends SandboxError {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, options?: ErrorOptions) {
    super(`Execution timed out after ${timeoutMs} ms`, options);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class WeatherAPIError extends SandboxError {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WeatherAPIError';
    this.statusCode = statusCode;
  }
}

export class ValidationError extends SandboxError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

export class VMError extends SandboxError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VMError';
  }
}

/**
 * Serializable error format for tool responses
 */
export interface SerializableError {
  name: string;
  message: string;
  stack?: string | null;
}

/**
 * Converts an error to a serializable format
 */
export function serializeError(error: unknown): SerializableError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: 'Error',
    message: String(error ?? 'Unknown error'),
    stack: null,
  };
}

/**
 * Checks if an error is a timeout-related error
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof TimeoutError) {
    return true;
  }

  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();
    return (
      error.name === 'TimeoutError' ||
      normalized.includes('interrupted') ||
      normalized.includes('timed out')
    );
  }

  return false;
}
