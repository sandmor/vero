import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { defineConfig, env } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env only from this package to avoid relying on monorepo root files
const envFiles: Array<{ path: string; override?: boolean }> = [
  { path: resolve(__dirname, ".env") },
  { path: resolve(__dirname, ".env.local"), override: true },
];

for (const entry of envFiles) {
  config({ path: entry.path, override: entry.override });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
