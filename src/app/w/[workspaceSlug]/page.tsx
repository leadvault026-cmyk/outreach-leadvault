import { redirect } from "next/navigation";

export default async function WorkspaceIndex({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/dashboard`);
}
