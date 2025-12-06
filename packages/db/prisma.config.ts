import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { defineConfig, env } from "prisma/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from packages/db or monorepo root
config({ path: resolve(__dirname, ".env") }); // packages/db/.env
config({ path: resolve(__dirname, "../../.env") }); // root/.env

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
