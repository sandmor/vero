# @vero/db

Shared database package for the Vero monorepo. Provides the Prisma client, schema, and utilities for database access.

## Installation

This package is used internally within the monorepo. Add it as a dependency to your app:

```json
{
  "dependencies": {
    "@vero/db": "workspace:*"
  }
}
```

## Setup

### Environment Variables

Create a `.env` file in `packages/db/` with:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/vero?schema=public"
```

The app-specific env files live alongside each app (e.g., `apps/web/.env.local`). This package reads only `packages/db/.env` (and `.env.local`) when running Prisma commands.

### Generate Prisma Client

From the monorepo root:

```bash
bun run db:generate
```

Or directly:

```bash
cd packages/db && bun run db:generate
```

## Usage

Import the Prisma client and types in your application:

```typescript
import { prisma, Prisma } from '@vero/db';

// Use the Prisma client
const users = await prisma.user.findMany();

// Use Prisma types
const query: Prisma.UserWhereInput = { email: 'test@example.com' };
```

## Available Scripts

From monorepo root:

| Script                | Description                    |
| --------------------- | ------------------------------ |
| `bun run db:generate` | Generate Prisma client         |
| `bun run db:migrate`  | Run database migrations        |
| `bun run db:push`     | Push schema changes (dev only) |
| `bun run db:studio`   | Open Prisma Studio             |

## Exports

- `prisma` - Singleton Prisma client instance with connection pooling
- `Prisma` - Prisma namespace for types and utilities
- `PrismaClient` - PrismaClient class for type references
- `mapPrismaError` - Utility to map Prisma errors to standardized types
- `isPrismaNotFoundError` - Check if error is a "not found" error
- `isPrismaUniqueConstraintError` - Check if error is a unique constraint violation

## Schema Location

The Prisma schema is located at `packages/db/prisma/schema.prisma`. Migrations are stored in `packages/db/prisma/migrations/`.
