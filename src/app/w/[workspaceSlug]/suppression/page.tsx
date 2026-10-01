import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Suppression" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/suppression">) {
  return <ModulePage moduleKey="suppression" params={params} />;
}
