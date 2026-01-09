import { PrismaClient } from '../generated/client/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

// Ensure a single PrismaClient instance across hot reloads in dev
const globalForPrisma = globalThis as unknown as {
  prisma?: InstanceType<typeof PrismaClient>;
};

const connectionString =
  process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error(
    'Neither DATABASE_URL nor DATABASE_URL_UNPOOLED is defined in environment variables'
  );
}

const adapter = new PrismaPg({
  connectionString,
});

// Export prisma instance - let TypeScript infer the type from the constructor
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Re-export PrismaClient for type usage
export { PrismaClient };
