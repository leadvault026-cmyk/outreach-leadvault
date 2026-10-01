/**
 * Applies committed SQL migrations (src/db/migrations) in order. Used locally and as the future
 * Railway pre-deploy command. Uses DATABASE_MIGRATION_URL (falls back to DATABASE_URL).
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_MIGRATION_URL or DATABASE_URL must be set.");
  process.exit(1);
}

async function main(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), {
      migrationsFolder: "src/db/migrations",
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    });
    console.log("Migrations applied.");
  } catch (error) {
    const e = error as {
      message?: string;
      cause?: { message?: string; detail?: string; where?: string };
    };
    console.error("Migration failed:", e.cause?.message ?? e.message);
    if (e.cause?.detail) console.error("Detail:", e.cause.detail);
    if (e.cause?.where) console.error("Where:", e.cause.where);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main(url);
