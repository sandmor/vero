/**
 * External API services that can be exposed to the sandbox.
 * Provides a clean interface for fetching weather data.
 */

import { WEATHER_CONFIG, SANDBOX_CONFIG } from './config';
import { WeatherAPIError, TimeoutError } from './errors';

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
