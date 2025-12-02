/**
 * Utility functions for working with Node.js VM module.
 * Handles script execution, promise resolution, timeout management, and error handling.
 */

import * as vm from 'vm';
import { SANDBOX_CONFIG } from './config';
import { VMError, TimeoutError } from './errors';
import { logger } from './logger';

/**
 * VM context with timeout tracking
 */
export interface VMContext {
  context: vm.Context;
  deadline: number;
}

/**
 * Creates a new VM context with configured sandbox
 */
export function createVMContext(deadline: number): VMContext {
  const sandbox = {
    // Provide safe global objects
    console: undefined, // Will be overridden in bootstrap script
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    clearImmediate: undefined,
    // Prevent access to process and other Node globals
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    Buffer: undefined,
  };

  const context = vm.createContext(sandbox);

  return {
    context,
    deadline,
  };
}

/**
 * Builds a JavaScript Error from a VM error
 */
export function buildVMError(error: unknown): Error {
  if (error instanceof Error) {
    const vmError = new VMError(error.message);
    vmError.name = error.name;
    vmError.stack = error.stack;
    return vmError;
  }

  return new VMError(String(error ?? 'VM error'));
}

/**
 * Evaluates a script and returns the result
 * @throws {VMError} If script evaluation fails
 */
export function evaluateScript(
  vmContext: VMContext,
  source: string,
  filename: string
): unknown {
  try {
    const remainingTime = Math.max(0, vmContext.deadline - Date.now());

    const script = new vm.Script(source, {
      filename,
    });

    const result = script.runInContext(vmContext.context, {
      timeout: remainingTime,
      breakOnSigint: false,
    });

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      throw new TimeoutError(SANDBOX_CONFIG.DEFAULT_TIMEOUT_MS);
    }
    throw buildVMError(error);
  }
}

/**
 * Evaluates an async script and waits for its completion.
 * Required for running async user code that awaits host-provided promises.
 */
export async function evaluateAsyncScript(
  vmContext: VMContext,
  source: string,
  filename: string,
  timeoutMs: number
): Promise<unknown> {
  try {
    const remainingTime = Math.max(0, vmContext.deadline - Date.now());

    logger.debug('Evaluating async script', {
      filename,
      sourceLength: source.length,
      remainingTime,
    });

    const script = new vm.Script(source, {
      filename,
    });

    const result = script.runInContext(vmContext.context, {
      timeout: remainingTime,
      breakOnSigint: false,
    });

    logger.debug('Script execution returned', {
      filename,
      resultType: typeof result,
      isPromise: result && typeof result === 'object' && 'then' in result,
    });

    if (result && typeof result === 'object' && 'then' in result) {
      logger.debug('Awaiting promise result', { filename });
      const awaited = await promiseWithTimeout(
        result as Promise<unknown>,
        Math.min(remainingTime, timeoutMs),
        `Execution timed out after ${timeoutMs} ms`
      );
      logger.debug('Promise resolved', {
        filename,
        awaitedType: typeof awaited,
      });
      return awaited;
    }

    return result;
  } catch (error) {
    logger.error('Async script evaluation failed', {
      filename,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (error instanceof Error && error.message.includes('timed out')) {
      throw new TimeoutError(timeoutMs);
    }

    throw buildVMError(error);
  }
}

/**
 * Wraps a promise with a timeout
 */
export function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new TimeoutError(timeoutMs));
  }

  let timeoutId: NodeJS.Timeout | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    }),
    timeout,
  ]);
}

/**
 * Gets a value from the VM context
 */
export function getContextValue(vmContext: VMContext, key: string): unknown {
  try {
    return (vmContext.context as any)[key];
  } catch (error) {
    logger.warn('Failed to get context value', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Sets a value in the VM context
 */
export function setContextValue(
  vmContext: VMContext,
  key: string,
  value: unknown
): void {
  try {
    (vmContext.context as any)[key] = value;
  } catch (error) {
    logger.warn('Failed to set context value', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Disposes of the VM context resources
 */
export function disposeVMContext(_vmContext: VMContext): void {
  // VM contexts are garbage collected, no explicit disposal needed
}
