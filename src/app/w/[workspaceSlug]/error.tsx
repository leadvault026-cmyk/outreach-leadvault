"use client";

import { SystemError } from "@/components/states/status-states";
import { Button } from "@/components/ui/button";

/** Segment error boundary: safe message + reference only; details stay in server logs. */
export default function WorkspaceError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <SystemError
      reference={error.digest ?? null}
      footer={
        <Button variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}
