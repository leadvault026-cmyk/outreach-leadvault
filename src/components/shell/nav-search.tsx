"use client";

import { CornerDownLeft, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ALL_NAV_ITEMS, workspaceHref } from "@/config/navigation";
import { cn } from "@/lib/utils";

/**
 * Global search (⌘K / Ctrl+K). Phase 1 searches application destinations; record search
 * (prospects, campaigns, audiences) plugs into the same dialog when those modules ship.
 */
export function NavSearch({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();

  const destinations = useMemo(
    () => [
      ...ALL_NAV_ITEMS.map((i) => ({
        key: i.key,
        label: i.label,
        description: i.description,
        href: workspaceHref(workspaceSlug, i.segment),
      })),
      {
        key: "profile",
        label: "Profile",
        description: "Your account and security.",
        href: workspaceHref(workspaceSlug, "profile"),
      },
    ],
    [workspaceSlug],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return destinations;
    return destinations.filter(
      (d) => d.label.toLowerCase().includes(q) || d.description.toLowerCase().includes(q),
    );
  }, [destinations, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="text-muted-foreground h-9 w-9 justify-center px-0 sm:w-64 sm:justify-start sm:px-3"
        aria-label="Search (Ctrl+K)"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="bg-muted ml-auto hidden rounded border px-1.5 text-[10px] font-medium sm:inline">
          Ctrl K
        </kbd>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to a section of LeadVault Outreach. Use the arrow keys to choose and Enter to open.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <Search aria-hidden className="text-muted-foreground size-4" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === "Enter" && results[active]) {
                  e.preventDefault();
                  go(results[active].href);
                }
              }}
              placeholder="Search sections…"
              aria-label="Search sections"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${results[active].key}` : undefined}
              className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none focus-visible:outline-none"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Sections" className="max-h-80 overflow-y-auto p-2">
            {results.length === 0 ? (
              <li className="text-muted-foreground px-3 py-6 text-center text-sm">
                No matching sections.
              </li>
            ) : (
              results.map((r, i) => (
                <li
                  key={r.key}
                  id={`${listId}-${r.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r.href)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
                    i === active ? "bg-muted" : "",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {r.description}
                    </span>
                  </span>
                  {i === active ? (
                    <CornerDownLeft aria-hidden className="text-muted-foreground size-3.5" />
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
