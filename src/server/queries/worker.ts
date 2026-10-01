import "server-only";
import { desc } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { workerHeartbeats } from "@/db/schema";

/** Latest worker heartbeat (service-only table, read through the privileged connection). */
export async function lastWorkerBeat(): Promise<Date | null> {
  const [row] = await systemDb()
    .select({ at: workerHeartbeats.lastBeatAt })
    .from(workerHeartbeats)
    .orderBy(desc(workerHeartbeats.lastBeatAt))
    .limit(1);
  return row?.at ?? null;
}
