/**
 * Generic Prisma error utilities for mapping database errors to application errors.
 * This module is app-agnostic and can be used by any consuming application.
 */

// Minimal known Prisma error code surface
type PrismaKnownError = { code?: string; message?: string } & Record<
  string,
  unknown
>;

/**
 * Context for error mapping - provides information about where the error occurred
 */
export interface PrismaErrorContext {
  model: string; // e.g. ArchiveEntry
  operation: string; // e.g. create | update | delete | read | link
  action?: string; // optional more specific domain action
}

/**
 * Mapped error result with type classification
 */
export interface MappedPrismaError {
  type: "not_found" | "constraint_violation" | "validation" | "unknown";
  message: string;
  code?: string;
  originalError?: unknown;
}

/**
 * Map Prisma known request error codes to a generic error classification.
 * Consumers can then map these to their own error types.
 */
export function mapPrismaError(
  error: unknown,
  ctx: PrismaErrorContext
): MappedPrismaError {
  const err = error as PrismaKnownError | undefined;
  const code = err?.code;

  switch (code) {
    case "P2025": // Record not found
    case "P2001": // Record does not exist
      return {
        type: "not_found",
        message: `Record not found during ${ctx.operation} on ${ctx.model}`,
        code,
        originalError: error,
      };

    case "P2002": // Unique constraint violation
      return {
        type: "constraint_violation",
        message: `Unique constraint violation while attempting to ${ctx.operation} ${ctx.model}`,
        code,
        originalError: error,
      };

    case "P2000": // Value too long
      return {
        type: "validation",
        message: `One of the provided field values is too long for ${ctx.model}`,
        code,
        originalError: error,
      };

    case "P2003": // FK constraint
      return {
        type: "constraint_violation",
        message: `Foreign key constraint failed while performing ${ctx.operation} on ${ctx.model}`,
        code,
        originalError: error,
      };

    default:
      // Fallback: generic unknown error; keep original message as cause snippet
      const raw = (err?.message || "Unknown error").slice(0, 160);
      return {
        type: "unknown",
        message: `Failed to ${ctx.operation} ${ctx.model}: ${raw}`,
        code,
        originalError: error,
      };
  }
}

/**
 * Check if an error is a Prisma "not found" error
 */
export function isPrismaNotFoundError(error: unknown): boolean {
  const err = error as PrismaKnownError | undefined;
  return err?.code === "P2025" || err?.code === "P2001";
}

/**
 * Check if an error is a Prisma unique constraint violation
 */
export function isPrismaUniqueConstraintError(error: unknown): boolean {
  const err = error as PrismaKnownError | undefined;
  return err?.code === "P2002";
}
