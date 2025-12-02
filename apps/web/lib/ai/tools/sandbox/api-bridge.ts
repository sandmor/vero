/**
 * Extensible API bridge system for exposing external services to the sandbox.
 * Provides a clean abstraction for adding new APIs without modifying core code.
 */

import type { VMContext } from './vm-utils';
import { setContextValue, evaluateScript } from './vm-utils';
import { fetchWeather, type WeatherCoordinates } from './external-apis';
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
  ];
}
