import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { privilegedDb } from "@/db/client";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Liveness + database reachability for uptime monitoring. Returns no internal details.
 * Worker-heartbeat freshness is added when the worker ships (architecture §27).
 */
export async function GET() {
  try {
    await privilegedDb().execute(sql`select 1`);
    return NextResponse.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logger.error("health.database_unreachable", { error });
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
