import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Campaigns" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/campaigns">) {
  return <ModulePage moduleKey="campaigns" params={params} />;
}
