/**
 * Sandbox module exports.
 * Provides a clean public API for the sandbox execution system.
 */

export { SANDBOX_CONFIG, WEATHER_CONFIG } from './config';
export type { SandboxConfig, WeatherConfig } from './config';

export {
  SandboxError,
  TimeoutError,
  WeatherAPIError,
  ValidationError,
  VMError,
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
