import { Activity, FlaskConical, PlugZap } from "lucide-react";
import { relativeTime } from "@/lib/format";

/** Whether the background worker is running (heartbeat within the last 30 seconds). */
export function WorkerStatus({
  lastBeat,
  now = new Date(),
}: {
  lastBeat: Date | null;
  now?: Date;
}) {
  const running = lastBeat && now.getTime() - lastBeat.getTime() < 30_000;
  return (
    <p
      className={`inline-flex items-center gap-1.5 text-xs ${running ? "text-success" : "text-warning"}`}
      role="status"
    >
      <Activity aria-hidden className="size-3.5" />
      {running
        ? `Worker running (last seen ${relativeTime(lastBeat!, now)})`
        : lastBeat
          ? `Worker not running (last seen ${relativeTime(lastBeat, now)}). Start it with: npm run worker`
          : "Worker not running. Start it with: npm run worker"}
    </p>
  );
}

/** Makes the transport impossible to miss: fake = nothing leaves this computer. */
export function TransportNotice({ transport }: { transport: "fake" | "live" }) {
  return transport === "fake" ? (
    <p className="inline-flex items-center gap-1.5 rounded-md border border-info/20 bg-info-soft px-2 py-1 text-xs text-info">
      <FlaskConical aria-hidden className="size-3.5" />
      Fake email transport: messages are recorded as sent, but no email leaves this computer.
    </p>
  ) : (
    <p className="inline-flex items-center gap-1.5 rounded-md border border-warning/25 bg-warning-soft px-2 py-1 text-xs text-warning">
      <PlugZap aria-hidden className="size-3.5" />
      Live transport requested, but no email provider is connected: nothing will be sent.
    </p>
  );
}
