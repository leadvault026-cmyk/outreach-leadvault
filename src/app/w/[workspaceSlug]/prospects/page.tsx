import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Prospects" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/prospects">) {
  return <ModulePage moduleKey="prospects" params={params} />;
}
