import { notFound, redirect } from "next/navigation";
import { ALL_NAV_ITEMS } from "@/config/navigation";
import { defaultWorkspaceSlug } from "@/server/workspace";

/**
 * Convenience routes (/prospects, /campaigns, /settings, …) resolve to the same module in the
 * user's default workspace. Workspace-scoped URLs (/w/[slug]/…) remain canonical.
 */
export default async function ModuleShortcut({ params }: PageProps<"/[module]">) {
  const { module } = await params;
  const item = ALL_NAV_ITEMS.find((i) => i.segment === module);
  if (!item && module !== "profile") notFound();
  const slug = await defaultWorkspaceSlug();
  redirect(slug ? `/w/${slug}/${module}` : "/dashboard");
}
