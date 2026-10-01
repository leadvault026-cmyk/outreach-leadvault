import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// Loads .env.local for local tooling; deployed environments inject variables directly.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  // Only the `app` schema is managed here; `auth` belongs to Supabase.
  schemaFilter: ["app"],
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL ?? "",
  },
  migrations: {
    schema: "drizzle",
    table: "__drizzle_migrations",
  },
  strict: true,
  verbose: true,
});
