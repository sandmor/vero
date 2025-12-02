/**
 * Configuration constants for the JavaScript sandbox execution environment.
 * Centralizes all limits, timeouts, and other configuration values.
 */

export const SANDBOX_CONFIG = {
  /** Maximum length of code that can be executed (in characters) */
  MAX_CODE_LENGTH: 12_000,

  /** Default execution timeout in milliseconds */
  DEFAULT_TIMEOUT_MS: 1_500,

  /** Maximum allowed execution timeout in milliseconds */
  MAX_TIMEOUT_MS: 5_000,

  /** Minimum allowed execution timeout in milliseconds */
  MIN_TIMEOUT_MS: 250,

  /** Maximum number of console log lines to capture */
  MAX_LOG_LINES: 120,

  /** Maximum number of items in collections (arrays/objects) when serializing */
  MAX_COLLECTION_ITEMS: 200,

  /** Maximum depth for object serialization to prevent stack overflow */
  MAX_SERIALIZATION_DEPTH: 6,

  /** VM memory limit awareness (16 MB soft limit for monitoring) */
  MEMORY_LIMIT_BYTES: 16 * 1024 * 1024,

  /** VM stack size awareness (512 KB soft limit for monitoring) */
  STACK_SIZE_BYTES: 512 * 1024,

  /** Maximum length of error body snippets to include in error messages */
  ERROR_BODY_SNIPPET_LENGTH: 200,
} as const;

export const WEATHER_CONFIG = {
  /** Base URL for the weather API */
  BASE_URL: 'https://api.open-meteo.com/v1/forecast',

  /** Maximum timeout for weather API requests in milliseconds */
  REQUEST_TIMEOUT_MS: 7_500,

  /** Weather API parameters to request */
  PARAMS: {
    current: 'temperature_2m',
    hourly: 'temperature_2m',
    daily: 'sunrise,sunset',
    timezone: 'auto',
  },
} as const;

export type SandboxConfig = typeof SANDBOX_CONFIG;
export type WeatherConfig = typeof WEATHER_CONFIG;
