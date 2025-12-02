export type ErrorType =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'offline';

export type Surface =
  | 'chat'
  | 'auth'
  | 'api'
  | 'stream'
  | 'database'
  | 'history'
  | 'document'
  | 'suggestions'
  | 'model'; // model entitlement / access errors

export type ErrorCode = `${ErrorType}:${Surface}`;

export type ErrorVisibility = 'response' | 'log' | 'none';

export const visibilityBySurface: Record<Surface, ErrorVisibility> = {
  database: 'log',
  chat: 'response',
  auth: 'response',
  stream: 'response',
  api: 'response',
  history: 'response',
  document: 'response',
  suggestions: 'response',
  model: 'response',
};

export class ChatSDKError extends Error {
  type: ErrorType;
  surface: Surface;
  statusCode: number;

  constructor(errorCode: ErrorCode, cause?: string) {
    super();

    const [type, surface] = errorCode.split(':');

    this.type = type as ErrorType;
    this.cause = cause;
    this.surface = surface as Surface;
    const defaultMessage = getMessageByErrorCode(errorCode);
    this.message = cause ?? defaultMessage;
    this.statusCode = getStatusCodeByType(this.type);
  }

  toResponse() {
    const code: ErrorCode = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];

    const { message, cause, statusCode } = this;

    if (visibility === 'log') {
      console.error({
        code,
        message,
        cause,
      });

      return Response.json(
        { code: '', message: 'Something went wrong. Please try again later.' },
        { status: statusCode }
      );
    }

    return Response.json({ code, message, cause }, { status: statusCode });
  }
}

export function getMessageByErrorCode(errorCode: ErrorCode): string {
  if (errorCode.includes('database')) {
    return 'An error occurred while executing a database query.';
  }

  switch (errorCode) {
    case 'bad_request:api':
      return "The request couldn't be processed. Please check your input and try again.";

    case 'unauthorized:auth':
      return 'You need to sign in before continuing.';
    case 'forbidden:auth':
      return 'Your account does not have access to this feature.';

    case 'forbidden:model':
      return "You don't have access to this model. Sign in to use premium models.";
    case 'unauthorized:model':
      return 'Sign in to use this model.';

    case 'rate_limit:chat':
      return 'You are sending messages too quickly. Please wait a bit for your quota to refill.';
    case 'not_found:chat':
      return 'The requested chat was not found. Please check the chat ID and try again.';
    case 'forbidden:chat':
      return 'This chat belongs to another user. Please check the chat ID and try again.';
    case 'unauthorized:chat':
      return 'You need to sign in to view this chat. Please sign in and try again.';
    case 'offline:chat':
      return "We're having trouble sending your message. Please check your internet connection and try again.";

    case 'not_found:document':
      return 'The requested document was not found. Please check the document ID and try again.';
    case 'forbidden:document':
      return 'This document belongs to another user. Please check the document ID and try again.';
    case 'unauthorized:document':
      return 'You need to sign in to view this document. Please sign in and try again.';
    case 'bad_request:document':
      return 'The request to create or update the document was invalid. Please check your input and try again.';

    default:
      return 'Something went wrong. Please try again later.';
  }
}

function getStatusCodeByType(type: ErrorType) {
  switch (type) {
    case 'bad_request':
      return 400;
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'rate_limit':
      return 429;
    case 'offline':
      return 503;
    default:
      return 500;
  }
}

// Enhanced error types for better type safety and discriminated unions

export interface NetworkError extends Error {
  type: 'network';
  statusCode?: number;
  endpoint?: string;
  retryable: boolean;
}

export interface ValidationError extends Error {
  type: 'validation';
  field?: string;
  value?: unknown;
  constraints: string[];
}

export interface ChatError {
  type: 'network' | 'validation' | 'unknown' | 'server';
  message: string;
  originalError?: Error;
  metadata?: Record<string, unknown>;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return (
    error instanceof Error &&
    'type' in error &&
    (error as NetworkError).type === 'network'
  );
}

export function isValidationError(error: unknown): error is ValidationError {
  return (
    error instanceof Error &&
    'type' in error &&
    (error as ValidationError).type === 'validation'
  );
}

export function toChatError(error: unknown): ChatError {
  if (error instanceof ChatSDKError) {
    return {
      type: 'server',
      message: error.message,
      originalError: error,
      metadata: {
        errorCode: `${error.type}:${error.surface}`,
        statusCode: error.statusCode,
      },
    };
  }

  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return {
        type: 'network',
        message: error.message,
        originalError: error,
        metadata: {
          statusCode: error.statusCode,
          endpoint: error.endpoint,
          retryable: error.retryable,
        },
      };
    }

    if (isValidationError(error)) {
      return {
        type: 'validation',
        message: error.message,
        originalError: error,
        metadata: {
          field: error.field,
          constraints: error.constraints,
        },
      };
    }

    return {
      type: 'unknown',
      message: error.message,
      originalError: error,
    };
  }

  return {
    type: 'unknown',
    message: String(error),
    originalError: error instanceof Error ? error : undefined,
  };
}
