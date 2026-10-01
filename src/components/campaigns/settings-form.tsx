"use client";

import { useActionState, useState } from "react";
import { saveCampaignSettingsAction } from "@/app/w/[workspaceSlug]/campaigns/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WEEKDAYS } from "@/domain/campaigns";
import type { ActionResult } from "@/server/action-result";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger disabled:opacity-60";

export type SettingsDefaults = {
  name: string;
  description: string;
  audienceId: string;
  mailboxId: string;
  timezone: string;
  startMode: "launch" | "at";
  startDate: string;
  startTime: string;
  anyTime: boolean;
  sendDays: number[];
  windowStart: string;
  windowEnd: string;
  dailyLimit: string;
};

function Err({ id, msg }: { id: string; msg?: string }) {
  return msg ? (
    <p id={id} className="mt-1 text-xs text-danger">
      {msg}
    </p>
  ) : null;
}

export function CampaignSettingsForm({
  workspaceSlug,
  campaignId,
  defaults,
  audiences,
  mailboxes,
  timezones,
  editable,
  saved,
}: {
  workspaceSlug: string;
  campaignId: string | null;
  defaults: SettingsDefaults;
  audiences: Array<{ id: string; name: string; members: number }>;
  mailboxes: Array<{ id: string; label: string; usable: boolean }>;
  timezones: string[];
  editable: boolean;
  saved?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    saveCampaignSettingsAction.bind(null, workspaceSlug, campaignId),
    null,
  );
  const [startMode, setStartMode] = useState(defaults.startMode);
  const [anyTime, setAnyTime] = useState(defaults.anyTime);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form action={action} className="max-w-2xl space-y-6">
      <fieldset disabled={!editable} className="space-y-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">Campaign</legend>
        <div>
          <label htmlFor="c-name" className="mb-1 block text-sm font-medium">
            Name
          </label>
          <input
            id="c-name"
            name="name"
            required
            minLength={2}
            maxLength={120}
            defaultValue={defaults.name}
            aria-invalid={fe?.name ? true : undefined}
            aria-describedby="c-name-e"
            className={inputClass}
          />
          <Err id="c-name-e" msg={fe?.name} />
        </div>
        <div>
          <label htmlFor="c-desc" className="mb-1 block text-sm font-medium">
            Description (optional)
          </label>
          <Textarea
            id="c-desc"
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={defaults.description}
          />
        </div>
        <div>
          <label htmlFor="c-aud" className="mb-1 block text-sm font-medium">
            Audience
          </label>
          <select
            id="c-aud"
            name="audienceId"
            required
            defaultValue={defaults.audienceId}
            aria-invalid={fe?.audienceId ? true : undefined}
            aria-describedby="c-aud-e"
            className={inputClass}
          >
            <option value="">Choose an audience…</option>
            {audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.members.toLocaleString()} members)
              </option>
            ))}
          </select>
          <Err id="c-aud-e" msg={fe?.audienceId} />
        </div>
        <div>
          <label htmlFor="c-mb" className="mb-1 block text-sm font-medium">
            Sending mailbox
          </label>
          <select
            id="c-mb"
            name="mailboxId"
            required
            defaultValue={defaults.mailboxId}
            aria-invalid={fe?.mailboxId ? true : undefined}
            aria-describedby="c-mb-e"
            className={inputClass}
          >
            <option value="">Choose a mailbox…</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.usable ? "" : " — not available"}
              </option>
            ))}
          </select>
          <Err id="c-mb-e" msg={fe?.mailboxId} />
        </div>
      </fieldset>

      <fieldset disabled={!editable} className="space-y-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-sm font-semibold">Schedule</legend>
        <div>
          <label htmlFor="c-tz" className="mb-1 block text-sm font-medium">
            Time zone
          </label>
          <select id="c-tz" name="timezone" defaultValue={defaults.timezone} className={inputClass}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Start</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="startMode"
                value="launch"
                checked={startMode === "launch"}
                onChange={() => setStartMode("launch")}
                className="size-4 accent-primary"
              />
              As soon as it is launched
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="startMode"
                value="at"
                checked={startMode === "at"}
                onChange={() => setStartMode("at")}
                className="size-4 accent-primary"
              />
              At a date and time
            </label>
          </div>
          {startMode === "at" ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="c-sd" className="mb-1 block text-xs text-muted-foreground">
                  Date
                </label>
                <input
                  id="c-sd"
                  type="date"
                  name="startDate"
                  defaultValue={defaults.startDate}
                  aria-invalid={fe?.startDate ? true : undefined}
                  className={inputClass}
                />
                <Err id="c-sd-e" msg={fe?.startDate} />
              </div>
              <div>
                <label htmlFor="c-st" className="mb-1 block text-xs text-muted-foreground">
                  Time (in the time zone above)
                </label>
                <input
                  id="c-st"
                  type="time"
                  name="startTime"
                  defaultValue={defaults.startTime}
                  aria-invalid={fe?.startTime ? true : undefined}
                  className={inputClass}
                />
                <Err id="c-st-e" msg={fe?.startTime} />
              </div>
            </div>
          ) : null}
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Sending window</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="anyTime"
              checked={anyTime}
              onChange={(e) => setAnyTime(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Any day and time
              <span className="block text-xs text-muted-foreground">
                Useful for testing with the fake transport. Real campaigns normally send on weekdays
                during business hours.
              </span>
            </span>
          </label>
          {!anyTime ? (
            <div className="mt-3 space-y-3">
              <div
                className="flex flex-wrap gap-x-3 gap-y-2"
                role="group"
                aria-label="Sending days"
              >
                {WEEKDAYS.map((d) => (
                  <label key={d.n} className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      name="sendDays"
                      value={d.n}
                      defaultChecked={defaults.sendDays.includes(d.n)}
                      className="size-4 accent-primary"
                    />
                    {d.short}
                  </label>
                ))}
              </div>
              <Err id="c-days-e" msg={fe?.sendDays} />
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="c-ws" className="mb-1 block text-xs text-muted-foreground">
                    From
                  </label>
                  <input
                    id="c-ws"
                    type="time"
                    name="windowStart"
                    defaultValue={defaults.windowStart}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="c-we" className="mb-1 block text-xs text-muted-foreground">
                    Until
                  </label>
                  <input
                    id="c-we"
                    type="time"
                    name="windowEnd"
                    defaultValue={defaults.windowEnd}
                    aria-invalid={fe?.windowEnd ? true : undefined}
                    className={inputClass}
                  />
                  <Err id="c-we-e" msg={fe?.windowEnd} />
                </div>
              </div>
            </div>
          ) : null}
        </fieldset>
        <div>
          <label htmlFor="c-limit" className="mb-1 block text-sm font-medium">
            Daily limit for this campaign (optional)
          </label>
          <input
            id="c-limit"
            type="number"
            name="dailyLimit"
            min={1}
            max={2000}
            defaultValue={defaults.dailyLimit}
            className={`${inputClass} sm:w-40`}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            The mailbox&apos;s own daily limit and spacing always apply as well.
          </p>
        </div>
      </fieldset>

      {state && !state.ok ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
      {saved && !state ? <InlineAlert tone="success">Settings saved.</InlineAlert> : null}
      {editable ? (
        <Button type="submit" disabled={pending}>
          {pending
            ? "Saving…"
            : campaignId
              ? "Save settings"
              : "Create campaign and write the sequence"}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Settings can only be changed while the campaign is a draft.
        </p>
      )}
    </form>
  );
}
