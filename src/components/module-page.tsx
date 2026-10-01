import { ModulePlaceholder } from "@/components/states/module-placeholder";
import { MODULES, type ModuleKey } from "@/config/modules";
import { navItemByKey } from "@/config/navigation";
import { getPageContext } from "@/server/page-context";

export async function ModulePage({
  moduleKey,
  params,
}: {
  moduleKey: ModuleKey;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const nav = navItemByKey(moduleKey);
  if (!nav) throw new Error(`Unknown module ${moduleKey}`);
  return <ModulePlaceholder info={MODULES[moduleKey]} icon={nav.icon} />;
}
