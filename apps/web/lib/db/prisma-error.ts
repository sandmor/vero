import { ChatSDKError } from '../errors';

// Minimal known Prisma error code surface we care about. Avoid importing full Prisma types to keep edge bundle slim.
type PrismaKnownError = { code?: string; message?: string } & Record<
  string,
  any
>;

export interface PrismaErrorContext {
  model: string; // e.g. ArchiveEntry
  operation: string; // e.g. create | update | delete | read | link
  action?: string; // optional more specific domain action
}

// Map Prisma known request error codes to ChatSDKError classifications.
export function mapPrismaError(
  error: unknown,
  ctx: PrismaErrorContext
): ChatSDKError {
  if (error instanceof ChatSDKError) return error;
  const err = error as PrismaKnownError | undefined;
  const code = err?.code;

  // Decide error type / cause by code.
  switch (code) {
    case 'P2025': // Record not found
    case 'P2001': // Record does not exist
      return new ChatSDKError(
        'not_found:database',
        `Record not found during ${ctx.operation} on ${ctx.model}`
      );
    case 'P2002': // Unique constraint violation
      return new ChatSDKError(
        'bad_request:database',
        `Unique constraint violation while attempting to ${ctx.operation} ${ctx.model}`
      );
    case 'P2000': // Value too long
      return new ChatSDKError(
        'bad_request:database',
        `One of the provided field values is too long for ${ctx.model}`
      );
    case 'P2003': // FK constraint
      return new ChatSDKError(
        'bad_request:database',
        `Foreign key constraint failed while performing ${ctx.operation} on ${ctx.model}`
      );
    default:
      // Fallback: generic database bad request; keep original message as cause snippet.
      const raw = (err?.message || 'Unknown error').slice(0, 160);
      return new ChatSDKError(
        'bad_request:database',
        `Failed to ${ctx.operation} ${ctx.model}: ${raw}`
      );
  }
}
