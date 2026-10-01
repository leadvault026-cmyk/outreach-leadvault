import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Analytics" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/analytics">) {
  return <ModulePage moduleKey="analytics" params={params} />;
}
