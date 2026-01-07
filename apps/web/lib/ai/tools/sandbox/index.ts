/**
 * Sandbox module exports.
 * Provides a clean public API for the sandbox execution system.
 */

export { SANDBOX_CONFIG, WEATHER_CONFIG } from './config';
export type { SandboxConfig, WeatherConfig } from './config';

export { WEB_API_CONFIG } from './web-config';
export type { WebApiConfig } from './web-config';

export {
  SandboxError,
  TimeoutError,
  WeatherAPIError,
  ValidationError,
  VMError,
  WebAPIError,
  WebScrapeError,
  WebCrawlError,
  WebMapError,
  WebSearchError,
  serializeError,
  isTimeoutError,
} from './errors';
export type { SerializableError } from './errors';

export { logger, createLogger } from './logger';
export type { Logger, LogLevel, LogContext } from './logger';

export { executeSandboxCode } from './executor';

export type {
  SupportedLanguage,
  ExecutionSummary,
  ExecutionEnvironment,
  SuccessResult,
  ErrorResult,
  ExecutionResult,
  ExecutionInput,
  RequestHints,
} from './types';

export { extractLocationHints, getApiMetadata } from './api-bridge';
export type { LocationHints, ApiMethodMetadata } from './api-bridge';

// Web API types
export type {
  WebScrapeParams,
  WebCrawlParams,
  WebMapParams,
  WebSearchParams,
  WebScrapeResult,
  WebCrawlResult,
  WebMapResult,
  WebSearchResult,
  ScrapeAction,
  ScrapeFormat,
} from './web-types';
