"use client";

import { Pause, Play, Rocket, Square } from "lucide-react";
import { useState, useTransition } from "react";
import {
  launchCampaignAction,
  transitionCampaignAction,
} from "@/app/w/[workspaceSlug]/campaigns/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Pause / Resume / Stop for a launched campaign. */
export function CampaignControls({
  workspaceSlug,
  campaignId,
  status,
}: {
  workspaceSlug: string;
  campaignId: string;
  status: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const run = (action: "pause" | "resume" | "stop") =>
    start(async () => {
      setError(null);
      const res = await transitionCampaignAction(workspaceSlug, campaignId, action);
      if (!res.ok) setError(res.error);
      setConfirmStop(false);
    });
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" || status === "SCHEDULED" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run("pause")}>
            <Pause /> Pause
          </Button>
        ) : null}
        {status === "PAUSED" ? (
          <Button size="sm" disabled={pending} onClick={() => run("resume")}>
            <Play /> Resume
          </Button>
        ) : null}
        {["ACTIVE", "SCHEDULED", "PAUSED"].includes(status) ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => setConfirmStop(true)}
          >
            <Square /> Stop
          </Button>
        ) : null}
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <Dialog open={confirmStop} onOpenChange={(o) => !pending && setConfirmStop(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stop this campaign?</DialogTitle>
            <DialogDescription>
              No further email will be sent to anyone in it. Emails already sent stay in the
              history. A stopped campaign cannot be restarted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmStop(false)} disabled={pending}>
              Keep running
            </Button>
            <Button variant="destructive" onClick={() => run("stop")} disabled={pending}>
              {pending ? "Stopping…" : "Stop campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Launch, with an explicit confirmation of what will happen. */
export function LaunchButton({
  workspaceSlug,
  campaignId,
  enroll,
  excluded,
  startsLater,
  transport,
  disabled,
}: {
  workspaceSlug: string;
  campaignId: string;
  enroll: number;
  excluded: number;
  startsLater: boolean;
  transport: "fake" | "live";
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        <Rocket /> {startsLater ? "Schedule campaign" : "Launch campaign"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {startsLater ? "Schedule this campaign?" : "Launch this campaign?"}
            </DialogTitle>
            <DialogDescription>
              {enroll.toLocaleString()} prospect{enroll === 1 ? "" : "s"} will receive the sequence
              {startsLater ? " from the scheduled start" : ""}.{" "}
              {excluded
                ? `${excluded.toLocaleString()} will be left out, each with its reason. `
                : ""}
              Every email is re-checked for eligibility right before it is sent.
            </DialogDescription>
          </DialogHeader>
          {transport === "fake" ? (
            <InlineAlert tone="info" title="Fake transport">
              Messages are recorded as sent, but no email leaves this computer.
            </InlineAlert>
          ) : null}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Back
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await launchCampaignAction(workspaceSlug, campaignId);
                  if (res && !res.ok) setError(res.error);
                })
              }
            >
              {pending ? "Launching…" : startsLater ? "Schedule" : "Launch now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
