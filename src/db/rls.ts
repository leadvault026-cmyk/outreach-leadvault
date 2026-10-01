import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

type Schema = typeof schema;
export type AppDatabase = PgDatabase<PgQueryResultHKT, Schema>;
export type AppTransaction = PgTransaction<
  PgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/**
 * Runs `fn` in a transaction as Postgres role `authenticated` with the caller's JWT claims set
 * (architecture §7, layer 3). Row Level Security therefore applies to every statement inside,
 * independent of application-level checks. `userId` must come from a verified session.
 */
export async function runAsUser<T>(
  db: AppDatabase,
  userId: string,
  fn: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx as AppTransaction);
  });
}
