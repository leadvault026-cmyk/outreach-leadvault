"use client";

import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { WorkspaceSummary } from "@/server/workspace";
import { SidebarContent } from "./sidebar-content";

/** Below the lg breakpoint the sidebar becomes an accessible slide-over drawer. */
export function MobileNav({
  workspace,
  workspaces,
}: {
  workspace: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar w-[280px] max-w-[85vw] gap-0 border-r-0 p-0 [&>button]:text-white"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Primary application navigation</SheetDescription>
        <SidebarContent
          workspace={workspace}
          workspaces={workspaces}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
