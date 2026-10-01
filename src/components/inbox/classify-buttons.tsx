"use client";

import { useState, useTransition } from "react";
import { classifyThreadAction } from "@/app/w/[workspaceSlug]/inbox/actions";
import { Button } from "@/components/ui/button";
import type { ThreadClassification } from "@/domain/enums";
import { CLASSIFICATION_LABELS } from "./labels";

const OPTIONS: ThreadClassification[] = [
  "INTERESTED",
  "FOLLOW_UP",
  "NOT_INTERESTED",
  "OUT_OF_OFFICE",
  "UNSUBSCRIBE",
  "OTHER",
];

export function ClassifyButtons({
  workspaceSlug,
  threadId,
  current,
}: {
  workspaceSlug: string;
  threadId: string;
  current: ThreadClassification;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Classify this conversation" className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => (
          <Button
            key={o}
            size="sm"
            variant={current === o ? "default" : "outline"}
            aria-pressed={current === o}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await classifyThreadAction(workspaceSlug, threadId, o);
                setMessage(res.ok ? res.data.message : res.error);
              })
            }
          >
            {CLASSIFICATION_LABELS[o]?.label ?? o}
          </Button>
        ))}
      </div>
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
