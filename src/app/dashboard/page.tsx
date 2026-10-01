import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/app/(auth)/actions";
import { defaultWorkspaceSlug } from "@/server/workspace";

export const metadata: Metadata = { title: "Dashboard" };

/** Entry point: sends the user to their default workspace, or explains that they have none. */
export default async function DashboardEntry() {
  const slug = await defaultWorkspaceSlug();
  if (slug) redirect(`/w/${slug}/dashboard`);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Wordmark tone="light" />
      <h1 className="mt-10 text-xl font-semibold">No workspace access yet</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Your account is active, but you are not a member of any workspace. Ask a LeadVault
        administrator to add you to a workspace.
      </p>
      <form action={signOutAction} className="mt-6">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
