"use client";

import { FlaskConical } from "lucide-react";
import { useState, useTransition } from "react";
import { resolveReviewAction, simulateAction } from "@/app/w/[workspaceSlug]/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Simulation } from "@/services/inbound-service";

const ITEMS: Array<{ kind: Simulation; label: string }> = [
  { kind: "reply", label: "Simulate a reply" },
  { kind: "out_of_office", label: "Simulate an out-of-office reply" },
  { kind: "opt_out_reply", label: "Simulate a “remove me” reply" },
  { kind: "hard_bounce", label: "Simulate a hard bounce" },
  { kind: "soft_bounce", label: "Simulate a soft bounce" },
];

/** Test events for the fake transport (shown only when simulation is allowed). */
export function RecipientTestActions({
  workspaceSlug,
  campaignId,
  recipientId,
  label,
  unsubscribeHref,
}: {
  workspaceSlug: string;
  campaignId: string;
  recipientId: string;
  label: string;
  unsubscribeHref: string | null;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            aria-label={`Test events for ${label}`}
          >
            <FlaskConical /> Test
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Fake transport test events</DropdownMenuLabel>
          {ITEMS.map((i) => (
            <DropdownMenuItem
              key={i.kind}
              onSelect={() =>
                start(async () => {
                  const res = await simulateAction(workspaceSlug, campaignId, recipientId, i.kind);
                  setMessage(
                    res.ok
                      ? { tone: "ok", text: res.data.message }
                      : { tone: "err", text: res.error },
                  );
                })
              }
            >
              {i.label}
            </DropdownMenuItem>
          ))}
          {unsubscribeHref ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href={unsubscribeHref} target="_blank" rel="noopener noreferrer">
                  Open this recipient&apos;s unsubscribe page
                </a>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {message ? (
        <p
          role="status"
          className={`max-w-56 text-right text-xs ${message.tone === "ok" ? "text-success" : "text-danger"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** ADMIN resolution of an uncertain send. Never offers an automatic retry. */
export function ReviewActions({
  workspaceSlug,
  campaignId,
  messageId,
}: {
  workspaceSlug: string;
  campaignId: string;
  messageId: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: "mark_sent" | "stop_recipient") =>
    start(async () => {
      const res = await resolveReviewAction(workspaceSlug, campaignId, messageId, action);
      if (!res.ok) setError(res.error);
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("mark_sent")}>
        It was sent
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("stop_recipient")}>
        Stop this recipient
      </Button>
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
