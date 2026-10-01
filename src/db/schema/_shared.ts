import { sql, type SQL } from "drizzle-orm";
import { pgSchema, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { uuidv7 } from "@/lib/ids";

/**
 * All application tables live in the `app` schema. Supabase's auto-generated Data API only
 * exposes `public` (and `graphql_public`), so app tables are unreachable through PostgREST with
 * the publishable key — they are only reached through our server (architecture §7, §21).
 */
export const appSchema = pgSchema("app");

/** Minimal reference to Supabase-managed `auth.users` (never created by our migrations). */
export const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

/** UUIDv7 primary key generated app-side; gen_random_uuid() only as a raw-SQL fallback. */
export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** created_at / updated_at — updated_at is maintained by the app.set_updated_at() trigger. */
export const timestamps = {
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
};

/** `column IN ('a','b',...)` for CHECK constraints, built from the domain value sets. */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[A-Za-z0-9_]+$/.test(v)) throw new Error(`Unsafe enum literal: ${v}`);
  }
  return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}
