import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Imports" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/imports">) {
  return <ModulePage moduleKey="imports" params={params} />;
}
