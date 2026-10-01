"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/domain/permissions";
import type { WorkspaceSummary } from "@/server/workspace";

function initials(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="border-sidebar-border bg-sidebar-accent/40 hover:bg-sidebar-accent focus-visible:outline-sidebar-ring flex w-full items-center gap-3 rounded-md border px-2.5 py-2 text-left transition-colors"
        aria-label={`Current workspace: ${current.name}. Switch workspace`}
      >
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-bold text-white"
        >
          {initials(current.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-white">
            {current.name}
          </span>
          <span className="text-sidebar-muted block truncate text-[11px]">
            {ROLE_LABELS[current.role]}
            {current.isDemo ? " · Demo data" : ""}
          </span>
        </span>
        <ChevronsUpDown aria-hidden className="text-sidebar-muted size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} asChild>
            <Link href={`/w/${w.slug}/dashboard`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{w.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {ROLE_LABELS[w.role]}
                  {w.isDemo ? " · Demo" : ""}
                </span>
              </span>
              {w.id === current.id ? (
                <Check aria-label="Current workspace" className="size-4" />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
