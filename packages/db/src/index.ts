// Re-export prisma client instance
export { prisma, PrismaClient } from "./client";

// Re-export Prisma namespace and types from generated client
export { Prisma } from "../generated/client/client";
export type * from "../generated/client/client";

// Re-export error utilities
export * from "./errors";
