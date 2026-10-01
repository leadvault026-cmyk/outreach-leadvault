import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Audiences" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/audiences">) {
  return <ModulePage moduleKey="audiences" params={params} />;
}
