import { Settings2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states/empty-state";
import { Button } from "@/components/ui/button";
import { SETTINGS_SECTIONS } from "@/config/settings";
import { getPageContext } from "@/server/page-context";

const PLANNED = SETTINGS_SECTIONS.filter((s) => s.status === "planned");

export async function generateMetadata({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/[section]">): Promise<Metadata> {
  const { section } = await params;
  return { title: PLANNED.find((s) => s.key === section)?.label ?? "Settings" };
}

export default async function PlannedSettingsSection({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/[section]">) {
  const ctx = await getPageContext(params);
  if (!ctx) return null;
  const { section } = await params;
  const info = PLANNED.find((s) => s.key === section);
  if (!info) notFound();

  return (
    <>
      <PageHeader title={info.label} description={info.description} />
      <EmptyState
        icon={Settings2}
        className="max-w-3xl bg-card"
        title={`${info.label} settings are not active yet`}
        description={info.plannedDetail ?? "This settings area activates in a later phase."}
        action={
          <Button variant="outline" asChild>
            <Link href={`/w/${ctx.workspace.slug}/settings`}>Back to settings</Link>
          </Button>
        }
      />
    </>
  );
}
