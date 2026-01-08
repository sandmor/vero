/**
 * Extensible API bridge system for exposing external services to the sandbox.
 * Provides a clean abstraction for adding new APIs without modifying core code.
 */

import type { VMContext } from './vm-utils';
import { setContextValue, evaluateScript } from './vm-utils';
import { fetchWeather, fetchUrl, type FetchOptions } from './external-apis';
import { webScrape, webCrawl, webMap, webSearch } from './web-apis';
import type {
  WebScrapeParams,
  WebCrawlParams,
  WebMapParams,
  WebSearchParams,
} from './web-types';
import {
  coerceFiniteNumber,
  normalizeText,
  validateCoordinates,
} from './type-utils';
import { logger } from './logger';
import { ValidationError } from './errors';

/**
 * Location hints that may be available from the request context
 */
export interface LocationHints {
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
}

/**
 * Extract location hints from request data
 */
export function extractLocationHints(hints: {
  latitude?: unknown;
  longitude?: unknown;
  city?: unknown;
  country?: unknown;
}): LocationHints | null {
  const latitude = coerceFiniteNumber(hints.latitude);
  const longitude = coerceFiniteNumber(hints.longitude);
  const city = normalizeText(hints.city);
  const country = normalizeText(hints.country);

  if (
    latitude === null &&
    longitude === null &&
    city === null &&
    country === null
  ) {
    return null;
  }

  return { latitude, longitude, city, country };
}

/**
 * Bridge handler function type for VM context
 */
type BridgeHandler = (
  vmContext: VMContext,
  payload?: unknown
) => Promise<unknown>;

/**
 * API bridge configuration
 */
export interface ApiBridgeConfig {
  /** Name of the function exposed to the sandbox */
  functionName: string;
  /** Handler implementation */
  handler: BridgeHandler;
}

/**
 * Creates a weather API bridge handler
 */
export function createWeatherBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Weather bridge called', { payload });
    try {
      const coordinates = validateCoordinates(payload);
      if (!coordinates) {
        throw new ValidationError(
          'latitude and longitude must be finite numbers within valid ranges'
        );
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Weather request timed out before it could be sent');
      }

      logger.debug('Fetching weather', { coordinates, remaining });
      const text = await fetchWeather(coordinates, remaining);
      logger.debug('Weather fetched successfully', { textLength: text.length });
      return text;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process weather request';
      logger.error('Weather bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_get_weather__',
    handler,
  };
}

/**
 * Creates a fetch API bridge handler
 */
export function createFetchBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Fetch bridge called', { payload });
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ValidationError(
          'Fetch payload must be an object with url property'
        );
      }

      const payloadObj = payload as Record<string, unknown>;
      const url = payloadObj.url;

      if (typeof url !== 'string' || !url) {
        throw new ValidationError('URL must be a non-empty string');
      }

      const options: FetchOptions = {};

      if (typeof payloadObj.method === 'string') {
        options.method = payloadObj.method;
      }

      if (payloadObj.headers && typeof payloadObj.headers === 'object') {
        options.headers = {};
        for (const [key, value] of Object.entries(payloadObj.headers)) {
          if (typeof value === 'string') {
            options.headers[key] = value;
          }
        }
      }

      if (typeof payloadObj.body === 'string') {
        options.body = payloadObj.body;
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Fetch request timed out before it could be sent');
      }

      logger.debug('Fetching URL', { url, options, remaining });
      const result = await fetchUrl(url, options, remaining);
      logger.debug('Fetch completed successfully', {
        status: result.status,
        bodyLength: result.body.length,
      });
      return JSON.stringify(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process fetch request';
      logger.error('Fetch bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_fetch__',
    handler,
  };
}

// ============================================================================
// Web API Bridges
// ============================================================================

/**
 * Creates a web scrape API bridge handler
 */
export function createWebScrapeBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Web scrape bridge called', { payload });
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ValidationError(
          'Scrape payload must be an object with url property'
        );
      }

      const params = payload as WebScrapeParams;

      if (typeof params.url !== 'string' || !params.url) {
        throw new ValidationError('URL must be a non-empty string');
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Scrape request timed out before it could be sent');
      }

      logger.debug('Scraping URL', { url: params.url, remaining });
      const result = await webScrape(params, remaining);
      logger.debug('Scrape completed successfully', {
        url: params.url,
        hasMarkdown: !!result.markdown,
        hasJson: !!result.json,
      });
      return JSON.stringify(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process scrape request';
      logger.error('Web scrape bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_web_scrape__',
    handler,
  };
}

/**
 * Creates a web crawl API bridge handler
 */
export function createWebCrawlBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Web crawl bridge called', { payload });
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ValidationError(
          'Crawl payload must be an object with url property'
        );
      }

      const params = payload as WebCrawlParams;

      if (typeof params.url !== 'string' || !params.url) {
        throw new ValidationError('URL must be a non-empty string');
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Crawl request timed out before it could be sent');
      }

      logger.debug('Crawling URL', { url: params.url, remaining });
      const result = await webCrawl(params, remaining);
      logger.debug('Crawl completed successfully', {
        url: params.url,
        status: result.status,
        pagesCount: result.pages.length,
      });
      return JSON.stringify(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process crawl request';
      logger.error('Web crawl bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_web_crawl__',
    handler,
  };
}

/**
 * Creates a web map API bridge handler
 */
export function createWebMapBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Web map bridge called', { payload });
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ValidationError(
          'Map payload must be an object with url property'
        );
      }

      const params = payload as WebMapParams;

      if (typeof params.url !== 'string' || !params.url) {
        throw new ValidationError('URL must be a non-empty string');
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Map request timed out before it could be sent');
      }

      logger.debug('Mapping URL', { url: params.url, remaining });
      const result = await webMap(params, remaining);
      logger.debug('Map completed successfully', {
        url: params.url,
        urlsCount: result.urls.length,
      });
      return JSON.stringify(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process map request';
      logger.error('Web map bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_web_map__',
    handler,
  };
}

/**
 * Creates a web search API bridge handler
 */
export function createWebSearchBridge(deadlineMs: number): ApiBridgeConfig {
  const handler: BridgeHandler = async (vmContext, payload) => {
    logger.debug('Web search bridge called', { payload });
    try {
      if (!payload || typeof payload !== 'object') {
        throw new ValidationError(
          'Search payload must be an object with query property'
        );
      }

      const params = payload as WebSearchParams;

      if (typeof params.query !== 'string' || !params.query) {
        throw new ValidationError('Query must be a non-empty string');
      }

      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        throw new Error('Search request timed out before it could be sent');
      }

      logger.debug('Searching web', { query: params.query, remaining });
      const result = await webSearch(params, remaining);
      logger.debug('Search completed successfully', {
        query: params.query,
        resultsCount: result.results.length,
      });
      return JSON.stringify(result);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to process search request';
      logger.error('Web search bridge error', {
        message,
        error: error instanceof Error ? error.stack : String(error),
      });
      throw error;
    }
  };

  return {
    functionName: '__virid_host_web_search__',
    handler,
  };
}

/**
 * Installs API bridges into the VM context
 * Exposes async bridge functions that return VM-native promises so sandbox code
 * can `await` host-side operations without leaking across realms
 */
export function installApiBridges(
  vmContext: VMContext,
  bridges: ApiBridgeConfig[]
): void {
  const bridgeHandlers = new Map<string, BridgeHandler>();

  for (const bridge of bridges) {
    bridgeHandlers.set(bridge.functionName, bridge.handler);
  }

  // Ensure the VM has a map to track pending bridge promises
  const pendingMapInit = `
(function() {
  if (!globalThis.__virid_pending_bridges__) {
    globalThis.__virid_pending_bridges__ = new Map();
  }
})();
`;

  evaluateScript(vmContext, pendingMapInit, 'bridge-pending-init.js');

  const pendingResultKey = '__virid_bridge_result__';
  const pendingErrorKey = '__virid_bridge_error__';
  let nextRequestId = 1;

  const resolveBridgePromise = (
    functionName: string,
    requestId: number,
    resultStr: string
  ) => {
    logger.debug('Resolving bridge promise', {
      functionName,
      requestId,
      resultStrLength: resultStr.length,
    });

    setContextValue(vmContext, pendingResultKey, resultStr);

    try {
      evaluateScript(
        vmContext,
        `(() => {
          const pending = globalThis.__virid_pending_bridges__;
          if (!pending) {
            return;
          }
          const entry = pending.get(${requestId});
          if (!entry) {
            return;
          }
          pending.delete(${requestId});
          try {
            const value = globalThis.${pendingResultKey};
            entry.resolve(value);
          } finally {
            globalThis.${pendingResultKey} = undefined;
          }
        })();`,
        `${functionName}-resolve-${requestId}.js`
      );
    } catch (error) {
      logger.error('Failed to resolve bridge promise inside VM', {
        functionName,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setContextValue(vmContext, pendingResultKey, undefined);
    }
  };

  const rejectBridgePromise = (
    functionName: string,
    requestId: number,
    error: unknown
  ) => {
    const rejection =
      error instanceof Error
        ? {
            message: error.message,
            name: error.name,
            stack: error.stack,
          }
        : {
            message: String(error ?? 'Bridge error'),
            name: 'Error',
            stack: null,
          };

    logger.error('Bridge handler error', {
      functionName,
      requestId,
      message: rejection.message,
    });

    setContextValue(vmContext, pendingErrorKey, rejection);

    try {
      evaluateScript(
        vmContext,
        `(() => {
          const pending = globalThis.__virid_pending_bridges__;
          if (!pending) {
            return;
          }
          const entry = pending.get(${requestId});
          if (!entry) {
            return;
          }
          pending.delete(${requestId});
          try {
            const info = globalThis.${pendingErrorKey};
            const error = new Error(info && info.message ? String(info.message) : 'Bridge error');
            if (info && info.name) {
              error.name = String(info.name);
            }
            if (info && info.stack) {
              error.stack = String(info.stack);
            }
            entry.reject(error);
          } finally {
            globalThis.${pendingErrorKey} = undefined;
          }
        })();`,
        `${functionName}-reject-${requestId}.js`
      );
    } catch (invokeError) {
      logger.error('Failed to reject bridge promise inside VM', {
        functionName,
        requestId,
        error:
          invokeError instanceof Error
            ? invokeError.message
            : String(invokeError),
      });
    } finally {
      setContextValue(vmContext, pendingErrorKey, undefined);
    }
  };

  const bridgeExecutor = {
    dispatch: (functionName: string, payloadJson: string) => {
      const requestId = nextRequestId++;

      logger.debug('Bridge executor dispatched', {
        functionName,
        payloadJson,
        requestId,
      });

      (async () => {
        try {
          const handler = bridgeHandlers.get(functionName);
          if (!handler) {
            throw new Error(`Bridge function ${functionName} not found`);
          }

          let payload: unknown;
          try {
            payload = payloadJson ? JSON.parse(payloadJson) : {};
          } catch {
            throw new SyntaxError('Invalid JSON payload');
          }

          logger.debug('Calling bridge handler', {
            functionName,
            requestId,
            payload,
          });
          const result = await handler(vmContext, payload);
          logger.debug('Bridge handler returned', {
            functionName,
            requestId,
            resultType: typeof result,
            resultLength:
              typeof result === 'string' ? result.length : undefined,
          });
          const resultStr =
            typeof result === 'string'
              ? result
              : JSON.stringify(result ?? null);

          resolveBridgePromise(functionName, requestId, resultStr);
        } catch (handlerError) {
          rejectBridgePromise(functionName, requestId, handlerError);
        }
      })();

      return requestId;
    },
  };

  // Set the bridge executor in the VM context
  setContextValue(vmContext, '__virid_bridge_executor__', bridgeExecutor);

  // For each bridge, inject a VM-native wrapper that returns a VM Promise
  for (const bridge of bridges) {
    const wrapperSetupCode = `
  (function() {
    const executor = globalThis.__virid_bridge_executor__;
    if (!executor || typeof executor.dispatch !== 'function') {
      throw new Error('Bridge executor is unavailable');
    }

    const pending = globalThis.__virid_pending_bridges__;
    if (!pending) {
      throw new Error('Pending bridge map is unavailable');
    }

    const functionName = ${JSON.stringify(bridge.functionName)};

    globalThis[functionName] = function(payloadJson) {
      return new Promise((resolve, reject) => {
        const requestId = executor.dispatch(functionName, payloadJson ?? '');
        pending.set(requestId, { resolve, reject });
      });
    };
  })();
  `;

    evaluateScript(
      vmContext,
      wrapperSetupCode,
      `${bridge.functionName}-bridge.js`
    );

    logger.debug('Bridge function set in context', {
      functionName: bridge.functionName,
    });
  }
}

/**
 * API metadata for documentation generation
 */
export interface ApiMethodMetadata {
  name: string;
  signature: string;
  description: string;
  returnType: string;
}

/**
 * Returns metadata about available sandbox APIs
 */
export function getApiMetadata(): ApiMethodMetadata[] {
  return [
    {
      name: 'fetch',
      signature: '(url: string, options?: RequestInit): Promise<Response>',
      description: 'Fetch data from external URLs using the standard Fetch API',
      returnType: 'Promise<Response>',
    },
    {
      name: 'getWeather',
      signature:
        '(coordinates: { latitude: number; longitude: number }): Promise<WeatherData>',
      description:
        'Fetch weather data from Open-Meteo API for the specified coordinates',
      returnType: 'Promise<WeatherData>',
    },
    // Web API methods
    {
      name: 'web.scrape',
      signature: '(params: WebScrapeParams): Promise<WebScrapeResult>',
      description:
        'Scrape a URL and extract content as markdown, HTML, links, or structured JSON data. Supports page interactions (click, type, wait) before scraping.',
      returnType: 'Promise<WebScrapeResult>',
    },
    {
      name: 'web.crawl',
      signature: '(params: WebCrawlParams): Promise<WebCrawlResult>',
      description:
        'Crawl a website starting from a URL, automatically discovering and scraping linked pages up to a specified limit and depth.',
      returnType: 'Promise<WebCrawlResult>',
    },
    {
      name: 'web.map',
      signature: '(params: WebMapParams): Promise<WebMapResult>',
      description:
        'Discover all URLs on a website extremely fast. Useful for site mapping and finding specific pages before scraping.',
      returnType: 'Promise<WebMapResult>',
    },
    {
      name: 'web.search',
      signature: '(params: WebSearchParams): Promise<WebSearchResult>',
      description:
        'Search the web and optionally scrape the search results for full content. Returns URLs, titles, descriptions, and markdown.',
      returnType: 'Promise<WebSearchResult>',
    },
  ];
}
