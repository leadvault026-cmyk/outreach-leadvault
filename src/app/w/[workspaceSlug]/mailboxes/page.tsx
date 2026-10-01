import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";

export const metadata: Metadata = { title: "Mailboxes" };

export default function Page({ params }: PageProps<"/w/[workspaceSlug]/mailboxes">) {
  return <ModulePage moduleKey="mailboxes" params={params} />;
}
