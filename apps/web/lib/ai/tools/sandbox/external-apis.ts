/**
 * External API services that can be exposed to the sandbox.
 * Provides a clean interface for fetching weather data and making HTTP requests.
 */

import { WEATHER_CONFIG, SANDBOX_CONFIG, FETCH_CONFIG } from './config';
import { WeatherAPIError, FetchAPIError, TimeoutError, ValidationError } from './errors';

export interface WeatherCoordinates {
  latitude: number;
  longitude: number;
}

/**
 * Fetches weather data from Open-Meteo API
 */
export async function fetchWeather(
  coordinates: WeatherCoordinates,
  timeoutMs?: number
): Promise<string> {
  const requestedTimeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? Math.max(timeoutMs, 0)
      : WEATHER_CONFIG.REQUEST_TIMEOUT_MS;

  const effectiveTimeout = Math.min(
    requestedTimeout,
    WEATHER_CONFIG.REQUEST_TIMEOUT_MS
  );

  if (effectiveTimeout <= 0) {
    throw new TimeoutError(effectiveTimeout);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const url = new URL(WEATHER_CONFIG.BASE_URL);
    url.searchParams.set('latitude', coordinates.latitude.toString());
    url.searchParams.set('longitude', coordinates.longitude.toString());
    url.searchParams.set('current', WEATHER_CONFIG.PARAMS.current);
    url.searchParams.set('hourly', WEATHER_CONFIG.PARAMS.hourly);
    url.searchParams.set('daily', WEATHER_CONFIG.PARAMS.daily);
    url.searchParams.set('timezone', WEATHER_CONFIG.PARAMS.timezone);

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const snippet = body.slice(0, SANDBOX_CONFIG.ERROR_BODY_SNIPPET_LENGTH);
      const errorMessage =
        snippet.length > 0
          ? `Weather provider responded with status ${response.status}: ${snippet}`
          : `Weather provider responded with status ${response.status}`;

      throw new WeatherAPIError(errorMessage, response.status);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(effectiveTimeout);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  ok: boolean;
  url: string;
}

/**
 * Validates and sanitizes a URL for fetching
 */
function validateFetchUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new ValidationError(`Invalid URL: ${urlString}`);
  }

  // Check protocol
  if (!FETCH_CONFIG.ALLOWED_PROTOCOLS.includes(url.protocol)) {
    throw new ValidationError(
      `Protocol not allowed: ${url.protocol}. Allowed: ${FETCH_CONFIG.ALLOWED_PROTOCOLS.join(', ')}`
    );
  }

  const hostname = url.hostname.toLowerCase();

  // Check blocked hosts
  if (FETCH_CONFIG.BLOCKED_HOSTS.includes(hostname)) {
    throw new ValidationError(`Access to ${hostname} is not allowed`);
  }

  // Check blocked IP prefixes
  for (const prefix of FETCH_CONFIG.BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      throw new ValidationError(`Access to private network addresses is not allowed`);
    }
  }

  // Block .local domains
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new ValidationError(`Access to internal domains is not allowed`);
  }

  return url;
}

/**
 * Validates fetch options
 */
function validateFetchOptions(options: FetchOptions): void {
  // Validate method
  const method = (options.method ?? 'GET').toUpperCase();
  if (!FETCH_CONFIG.ALLOWED_METHODS.includes(method)) {
    throw new ValidationError(
      `HTTP method not allowed: ${method}. Allowed: ${FETCH_CONFIG.ALLOWED_METHODS.join(', ')}`
    );
  }

  // Validate body size
  if (options.body !== undefined) {
    const bodySize = new TextEncoder().encode(options.body).length;
    if (bodySize > FETCH_CONFIG.MAX_REQUEST_BODY_SIZE_BYTES) {
      throw new ValidationError(
        `Request body too large: ${bodySize} bytes. Maximum: ${FETCH_CONFIG.MAX_REQUEST_BODY_SIZE_BYTES} bytes`
      );
    }
  }
}

/**
 * Fetches data from an external URL with security restrictions
 */
export async function fetchUrl(
  urlString: string,
  options: FetchOptions = {},
  timeoutMs?: number
): Promise<FetchResult> {
  // Validate URL
  const url = validateFetchUrl(urlString);

  // Validate options
  validateFetchOptions(options);

  const requestedTimeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
      ? Math.max(timeoutMs, 0)
      : FETCH_CONFIG.REQUEST_TIMEOUT_MS;

  const effectiveTimeout = Math.min(
    requestedTimeout,
    FETCH_CONFIG.REQUEST_TIMEOUT_MS
  );

  if (effectiveTimeout <= 0) {
    throw new TimeoutError(effectiveTimeout);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const method = (options.method ?? 'GET').toUpperCase();

    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Virid-Sandbox/1.0',
        ...options.headers,
      },
    };

    // Only include body for methods that support it
    if (options.body !== undefined && !['GET', 'HEAD'].includes(method)) {
      fetchOptions.body = options.body;
    }

    const response = await fetch(url.toString(), fetchOptions);

    // Read response with size limit
    const reader = response.body?.getReader();
    if (!reader) {
      // No body, return empty
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: '',
        ok: response.ok,
        url: response.url,
      };
    }

    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > FETCH_CONFIG.MAX_RESPONSE_SIZE_BYTES) {
        reader.cancel();
        throw new FetchAPIError(
          `Response body too large: exceeded ${FETCH_CONFIG.MAX_RESPONSE_SIZE_BYTES} bytes`,
          undefined,
          url.toString()
        );
      }

      chunks.push(value);
    }

    // Combine chunks and decode
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    const body = new TextDecoder().decode(combined);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      ok: response.ok,
      url: response.url,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(effectiveTimeout);
    }
    if (error instanceof ValidationError || error instanceof FetchAPIError) {
      throw error;
    }
    throw new FetchAPIError(
      error instanceof Error ? error.message : 'Fetch request failed',
      undefined,
      url.toString()
    );
  } finally {
    clearTimeout(timeout);
  }
}
