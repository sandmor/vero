// Re-export prisma client instance
export { prisma, PrismaClient } from "./client.js";

// Re-export Prisma namespace and types from generated client
export { Prisma } from "../generated/client/client.js";
export type * from "../generated/client/client.js";

// Re-export error utilities
export * from "./errors.js";

// Re-export NOTIFY utilities for realtime notifications
export * from "./notify.js";
