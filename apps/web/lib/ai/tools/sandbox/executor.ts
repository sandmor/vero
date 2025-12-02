/**
 * Core sandbox execution logic.
 * Orchestrates VM setup, script execution, and result collection.
 */

import { SANDBOX_CONFIG } from './config';
import { ValidationError, isTimeoutError, serializeError } from './errors';
import { logger } from './logger';
import {
  createVMContext,
  evaluateScript,
  evaluateAsyncScript,
  getContextValue,
  disposeVMContext,
  type VMContext,
} from './vm-utils';
import {
  createWeatherBridge,
  installApiBridges,
  extractLocationHints,
  type LocationHints,
} from './api-bridge';
import {
  createBootstrapScript,
  createApiScript,
  createExecutionScript,
  createSummaryScript,
} from './scripts';
import type {
  ExecutionResult,
  ExecutionInput,
  RequestHints,
  SupportedLanguage,
  ExecutionEnvironment,
  ExecutionSummary,
} from './types';

/**
 * Validates the execution language
 */
function validateLanguage(
  language: string
): asserts language is SupportedLanguage {
  if (language !== 'javascript') {
    throw new ValidationError(
      `Unsupported language: ${language}. Only "javascript" is supported.`
    );
  }
}

/**
 * Clamps timeout to valid range
 */
function clampTimeout(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || Number.isNaN(timeoutMs)) {
    return SANDBOX_CONFIG.DEFAULT_TIMEOUT_MS;
  }

  return Math.min(
    Math.max(Math.floor(timeoutMs), SANDBOX_CONFIG.MIN_TIMEOUT_MS),
    SANDBOX_CONFIG.MAX_TIMEOUT_MS
  );
}

/**
 * Creates environment description
 */
function createEnvironmentDescription(
  timeoutMs: number,
  locationHints: LocationHints | null,
  warnings: string[]
): ExecutionEnvironment {
  return {
    language: 'javascript',
    runtime: 'nodejs-vm',
    timeoutMs,
    limits: {
      maxCodeLength: SANDBOX_CONFIG.MAX_CODE_LENGTH,
      maxLogLines: SANDBOX_CONFIG.MAX_LOG_LINES,
      maxCollectionItems: SANDBOX_CONFIG.MAX_COLLECTION_ITEMS,
    },
    locationHints,
    warnings,
  };
}

/**
 * Generates warnings based on location hints availability
 */
function generateWarnings(locationHints: LocationHints | null): string[] {
  const warnings: string[] = [];

  if (!locationHints) {
    warnings.push(
      'Location hints unavailable; weather API requires explicit coordinates.'
    );
  } else if (
    locationHints.latitude === null ||
    locationHints.longitude === null
  ) {
    warnings.push(
      'Estimated coordinates incomplete; provide explicit latitude and longitude for weather API.'
    );
  }

  return warnings;
}

/**
 * Executes code in the sandbox
 */
export async function executeSandboxCode(
  input: ExecutionInput,
  requestHints: RequestHints
): Promise<ExecutionResult> {
  const language = input.language ?? 'javascript';
  validateLanguage(language);

  const effectiveTimeout = clampTimeout(input.timeoutMs);
  const startTime = Date.now();
  const deadline = startTime + effectiveTimeout;

  const locationHints = extractLocationHints(requestHints);
  const warnings = generateWarnings(locationHints);
  const environment = createEnvironmentDescription(
    effectiveTimeout,
    locationHints,
    warnings
  );

  logger.debug('Starting sandbox execution', {
    codeSize: input.code.length,
    timeout: effectiveTimeout,
    hasLocationHints: !!locationHints,
  });

  logger.info('Executing code', {
    code: input.code,
    language,
    timeoutMs: effectiveTimeout,
  });

  const vmContext = createVMContext(deadline);

  try {
    // Install API bridges
    const weatherBridge = createWeatherBridge(deadline);
    installApiBridges(vmContext, [weatherBridge]);

    logger.debug('API bridges installed', {
      bridgeCount: 1,
      functionName: weatherBridge.functionName,
    });

    // Execute bootstrap script
    evaluateScript(vmContext, createBootstrapScript(), 'bootstrap.js');
    logger.debug('Bootstrap script executed');

    // Execute API setup script
    evaluateScript(vmContext, createApiScript(locationHints), 'api.js');
    logger.debug('API setup script executed');

    // Execute user code wrapped in async IIFE
    logger.debug('Starting user code execution');
    const executionResult = await evaluateAsyncScript(
      vmContext,
      createExecutionScript(input.code),
      'execute.js',
      effectiveTimeout
    );
    logger.debug('User code execution completed', {
      resultType: typeof executionResult,
      hasResult: executionResult !== undefined,
    });

    // Check what's in the context before collecting
    const lastResult = getContextValue(vmContext, '__virid_last_result__');
    const stdout = getContextValue(vmContext, '__virid_stdout__');
    const stderr = getContextValue(vmContext, '__virid_stderr__');
    logger.debug('Context state before summary', {
      hasLastResult: !!lastResult,
      lastResult: JSON.stringify(lastResult),
      stdoutLength: Array.isArray(stdout) ? stdout.length : 0,
      stderrLength: Array.isArray(stderr) ? stderr.length : 0,
    });

    // Collect results
    const summaryJson = evaluateScript(
      vmContext,
      createSummaryScript(),
      'summary.js'
    );
    logger.debug('Summary collected', {
      summaryLength: String(summaryJson).length,
    });

    const summary = JSON.parse(String(summaryJson)) as ExecutionSummary;
    const runtimeMs = Date.now() - startTime;

    logger.debug('Execution completed', {
      status: summary.status,
      runtimeMs,
      stdoutLines: summary.stdout.length,
      stderrLines: summary.stderr.length,
    });

    logger.info('Execution result', {
      status: summary.status,
      runtimeMs,
      hasResult: summary.status === 'ok' && summary.value !== undefined,
      hasError: summary.status === 'error',
      stdoutLines: summary.stdout.length,
      stderrLines: summary.stderr.length,
      result: summary.status === 'ok' ? summary.value : summary.error,
    });

    if (summary.status === 'error') {
      return {
        status: 'error',
        result: null,
        error: serializeError(summary.error),
        stdout: summary.stdout,
        stderr: summary.stderr,
        truncatedStdout: summary.truncatedStdout,
        truncatedStderr: summary.truncatedStderr,
        runtimeMs,
        codeSize: input.code.length,
        environment,
      };
    }

    return {
      status: 'ok',
      result: summary.value,
      error: null,
      stdout: summary.stdout,
      stderr: summary.stderr,
      truncatedStdout: summary.truncatedStdout,
      truncatedStderr: summary.truncatedStderr,
      runtimeMs,
      codeSize: input.code.length,
      environment,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startTime;
    const isTimeout = isTimeoutError(error);

    logger.error('Execution failed', {
      error: error instanceof Error ? error.message : String(error),
      isTimeout,
      runtimeMs,
    });

    return {
      status: 'error',
      result: null,
      error: serializeError(error),
      stdout: [],
      stderr: [],
      truncatedStdout: 0,
      truncatedStderr: 0,
      runtimeMs,
      codeSize: input.code.length,
      environment,
    };
  } finally {
    disposeVMContext(vmContext);
  }
}
