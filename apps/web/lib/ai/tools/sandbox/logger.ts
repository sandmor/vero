/**
 * Simple logger utility for the sandbox environment.
 * Can be extended to use different logging backends.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

class ConsoleLogger implements Logger {
  constructor(private enabled: boolean = true) {}

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (context && Object.keys(context).length > 0) {
      console[level === 'debug' ? 'log' : level](
        `${prefix} ${message}`,
        context
      );
    } else {
      console[level === 'debug' ? 'log' : level](`${prefix} ${message}`);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }
}

// Default logger instance
export const logger: Logger = new ConsoleLogger(
  process.env.NODE_ENV !== 'production'
);

/**
 * Create a custom logger instance
 */
export function createLogger(enabled: boolean = true): Logger {
  return new ConsoleLogger(enabled);
}
