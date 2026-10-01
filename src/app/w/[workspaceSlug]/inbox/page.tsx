import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Inbox" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/inbox">) {
  return <ModulePage moduleKey="inbox" params={params} />;
}
