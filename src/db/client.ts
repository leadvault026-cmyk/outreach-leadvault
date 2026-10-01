import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/env/server";
import { runAsUser, type AppDatabase, type AppTransaction } from "./rls";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

// Reuse one pool across dev hot reloads.
const globalForDb = globalThis as unknown as { __lvoDb?: Db };

function createDb(): Db {
  const client = postgres(serverEnv().DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return drizzle(client, { schema });
}

function db(): Db {
  globalForDb.__lvoDb ??= createDb();
  return globalForDb.__lvoDb;
}

/**
 * User-scoped database access: RLS enforced as role `authenticated`.
 * This is the default for every request-handling code path.
 */
export function withUserContext<T>(
  userId: string,
  fn: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  return runAsUser(db() as unknown as AppDatabase, userId, fn);
}

/**
 * PRIVILEGED access (table owner — bypasses RLS). Only for system operations that cannot run
 * as the user (e.g. resolving a request before a session exists, worker jobs). Callers must
 * scope every query by workspace explicitly.
 */
export function privilegedDb(): Db {
  return db();
}
