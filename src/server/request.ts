import "server-only";
import { headers } from "next/headers";

export const REQUEST_ID_HEADER = "x-request-id";

/** Request correlation id set by src/proxy.ts; shown to users on error screens for support. */
export async function getRequestId(): Promise<string | null> {
  try {
    return (await headers()).get(REQUEST_ID_HEADER);
  } catch {
    return null; // outside a request scope (scripts, tests)
  }
}
