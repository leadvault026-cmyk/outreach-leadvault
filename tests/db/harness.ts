import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { runAsUser, type AppDatabase, type AppTransaction } from "@/db/rls";
import * as schema from "@/db/schema";

/**
 * Real PostgreSQL (PGlite) with the committed migrations applied, plus a minimal stand-in for the
 * Supabase-managed pieces our migrations depend on: the anon/authenticated roles and auth.users.
 */
const SUPABASE_SHIM = `
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
  );
`;

export type TestDb = PgliteDatabase<typeof schema>;

export async function createTestDatabase(): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  await client.exec(SUPABASE_SHIM);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../src/db/migrations") });
  return { db, client };
}

export async function createAuthUser(client: PGlite, id: string, email: string, fullName?: string) {
  await client.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`, [
    id,
    email,
    JSON.stringify(fullName ? { full_name: fullName } : {}),
  ]);
}

export function asUser<T>(db: TestDb, userId: string, fn: (tx: AppTransaction) => Promise<T>) {
  return runAsUser(db as unknown as AppDatabase, userId, fn);
}

/** Run raw SQL as `anon` (no JWT) — e.g. the publishable-key Data API path. */
export async function asAnon<T>(db: TestDb, fn: (tx: AppTransaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role anon`);
    return fn(tx as unknown as AppTransaction);
  });
}

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "unknown";
  }
}
