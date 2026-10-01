import "server-only";
import type { Capability } from "@/domain/permissions";
import { logger } from "./logger";
import { AuthorizationError, requireCapability, type WorkspaceContext } from "./workspace";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const PERMISSION_DENIED = "You don't have permission to do this in this workspace.";
export const SOMETHING_WENT_WRONG = "Something went wrong. Please try again.";

/**
 * Runs a server action body after resolving the workspace and checking the capability. Domain
 * errors with safe messages are returned to the UI; anything unexpected is logged and replaced by
 * a generic message (no internals leak to the browser).
 */
export async function withCapability<T>(
  workspaceSlug: string,
  capability: Capability,
  body: (ctx: WorkspaceContext) => Promise<ActionResult<T>>,
  safeErrors: ReadonlyArray<new (...args: never[]) => Error> = [],
): Promise<ActionResult<T>> {
  let ctx: WorkspaceContext;
  try {
    ctx = await requireCapability(workspaceSlug, capability);
  } catch (e) {
    if (e instanceof AuthorizationError) return { ok: false, error: PERMISSION_DENIED };
    throw e;
  }
  try {
    return await body(ctx);
  } catch (e) {
    if (safeErrors.some((C) => e instanceof C)) return { ok: false, error: (e as Error).message };
    if (isRedirect(e)) throw e;
    const code =
      (e as { code?: string; cause?: { code?: string } }).cause?.code ??
      (e as { code?: string }).code;
    if (code === "42501") return { ok: false, error: PERMISSION_DENIED };
    logger.error("action.failed", { capability, error: e });
    return { ok: false, error: SOMETHING_WENT_WRONG };
  }
}

/** next/navigation redirect() throws a special error that must propagate. */
function isRedirect(e: unknown): boolean {
  const digest = (e as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}
