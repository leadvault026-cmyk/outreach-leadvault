import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Templates" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/templates">) {
  return <ModulePage moduleKey="templates" params={params} />;
}
