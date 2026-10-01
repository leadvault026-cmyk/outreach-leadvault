"use client";

import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/domain/permissions";
import type { WorkspaceRole } from "@/domain/enums";

function initialsFrom(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  return source
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function UserMenu({
  workspaceSlug,
  fullName,
  email,
  role,
}: {
  workspaceSlug: string;
  fullName: string | null;
  email: string | null;
  role: WorkspaceRole;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-muted"
        aria-label="Account menu"
      >
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
        >
          {initialsFrom(fullName, email)}
        </span>
        <span className="hidden text-left md:block">
          <span className="block max-w-40 truncate text-[13px] leading-tight font-medium">
            {fullName ?? email}
          </span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            {ROLE_LABELS[role]}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium">{fullName ?? "Signed in"}</span>
          <span className="block truncate text-xs text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/w/${workspaceSlug}/profile`}>
            <UserRound /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/w/${workspaceSlug}/settings`}>
            <Settings /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut /> Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
