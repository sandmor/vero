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

export class FetchAPIError extends SandboxError {
  public readonly statusCode?: number;
  public readonly url?: string;

  constructor(
    message: string,
    statusCode?: number,
    url?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'FetchAPIError';
    this.statusCode = statusCode;
    this.url = url;
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

export class WebAPIError extends SandboxError {
  public readonly statusCode?: number;
  public readonly url?: string;
  public readonly operation?: string;

  constructor(
    message: string,
    statusCode?: number,
    url?: string,
    operation?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'WebAPIError';
    this.statusCode = statusCode;
    this.url = url;
    this.operation = operation;
  }
}

export class WebScrapeError extends WebAPIError {
  constructor(
    message: string,
    statusCode?: number,
    url?: string,
    options?: ErrorOptions
  ) {
    super(message, statusCode, url, 'scrape', options);
    this.name = 'WebScrapeError';
  }
}

export class WebCrawlError extends WebAPIError {
  constructor(
    message: string,
    statusCode?: number,
    url?: string,
    options?: ErrorOptions
  ) {
    super(message, statusCode, url, 'crawl', options);
    this.name = 'WebCrawlError';
  }
}

export class WebMapError extends WebAPIError {
  constructor(
    message: string,
    statusCode?: number,
    url?: string,
    options?: ErrorOptions
  ) {
    super(message, statusCode, url, 'map', options);
    this.name = 'WebMapError';
  }
}

export class WebSearchError extends WebAPIError {
  constructor(
    message: string,
    statusCode?: number,
    options?: ErrorOptions
  ) {
    super(message, statusCode, undefined, 'search', options);
    this.name = 'WebSearchError';
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
