import "server-only";
import { resolveWorkspace, type WorkspaceContext } from "./workspace";

/**
 * Pages render in parallel with their layout, so every page re-checks access itself before
 * loading data (the call is memoized per request). Returns null when the workspace is not
 * available — the layout renders the explanation, and the page renders nothing.
 */
export async function getPageContext(
  params: Promise<{ workspaceSlug: string }>,
): Promise<WorkspaceContext | null> {
  const { workspaceSlug } = await params;
  const resolution = await resolveWorkspace(workspaceSlug);
  return resolution.ok ? resolution.context : null;
}
