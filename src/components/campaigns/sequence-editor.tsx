"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStepsAction } from "@/app/w/[workspaceSlug]/campaigns/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { TokenHelp } from "@/components/templates/token-help";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DELAY_UNITS, splitDelay, type DelayUnit } from "@/domain/campaigns";
import { validateTemplateText } from "@/domain/personalization";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger";

type Step = {
  key: number;
  subject: string;
  body: string;
  delayValue: number;
  delayUnit: DelayUnit;
  templateId: string | null;
};

export function SequenceEditor({
  workspaceSlug,
  campaignId,
  initial,
  templates,
}: {
  workspaceSlug: string;
  campaignId: string;
  initial: Array<{
    subject: string | null;
    body: string;
    delayMinutes: number;
    sourceTemplateId: string | null;
  }>;
  templates: Array<{ id: string; name: string; subject: string; body: string }>;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(
    initial.length
      ? initial.map((s, i) => {
          const d = splitDelay(s.delayMinutes);
          return {
            key: i + 1,
            subject: s.subject ?? "",
            body: s.body,
            delayValue: d.value,
            delayUnit: d.unit,
            templateId: s.sourceTemplateId,
          };
        })
      : [{ key: 1, subject: "", body: "", delayValue: 0, delayUnit: "days", templateId: null }],
  );
  const [problems, setProblems] = useState<Array<{ step: number; field: string; message: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Step>) => {
    setSaved(false);
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const [item] = next.splice(i, 1);
      next.splice(i + dir, 0, item!);
      return next;
    });

  const save = () =>
    start(async () => {
      setError(null);
      setSaved(false);
      const res = await saveStepsAction(
        workspaceSlug,
        campaignId,
        steps.map((s, i) => ({
          subject: s.subject,
          body: s.body,
          delayMinutes:
            i === 0 ? 0 : Math.max(0, Math.round(s.delayValue * DELAY_UNITS[s.delayUnit])),
          templateId: s.templateId,
        })),
      );
      if (!res.ok) return setError(res.error);
      setProblems(res.data.problems);
      if (!res.data.problems.length) {
        setSaved(true);
        router.refresh();
      }
    });

  return (
    <div className="max-w-3xl space-y-4">
      <TokenHelp />
      <ol className="space-y-4">
        {steps.map((s, i) => {
          const stepProblems = problems.filter((p) => p.step === i + 1);
          const liveIssues = [...validateTemplateText(s.subject), ...validateTemplateText(s.body)];
          return (
            <li key={s.key} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                <h3 className="text-sm font-semibold">
                  Step {i + 1}
                  {i === 0 ? " — first email" : " — follow-up"}
                </h3>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move step ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Move step ${i + 1} down`}
                    disabled={i === steps.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove step ${i + 1}`}
                    disabled={steps.length === 1}
                    onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="space-y-3 px-4 py-3">
                {i > 0 ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label
                        htmlFor={`delay-${s.key}`}
                        className="mb-1 block text-xs text-muted-foreground"
                      >
                        Wait after the previous email
                      </label>
                      <input
                        id={`delay-${s.key}`}
                        type="number"
                        min={0}
                        value={s.delayValue}
                        onChange={(e) => update(i, { delayValue: Number(e.target.value) })}
                        className={`${inputClass} w-24`}
                      />
                    </div>
                    <div>
                      <label htmlFor={`unit-${s.key}`} className="sr-only">
                        Unit
                      </label>
                      <select
                        id={`unit-${s.key}`}
                        value={s.delayUnit}
                        onChange={(e) => update(i, { delayUnit: e.target.value as DelayUnit })}
                        className={`${inputClass} w-32`}
                      >
                        <option value="minutes">minutes</option>
                        <option value="hours">hours</option>
                        <option value="days">days</option>
                      </select>
                    </div>
                  </div>
                ) : null}
                {templates.length ? (
                  <div>
                    <label
                      htmlFor={`tpl-${s.key}`}
                      className="mb-1 block text-xs text-muted-foreground"
                    >
                      Start from a template (copies its text into this step)
                    </label>
                    <select
                      id={`tpl-${s.key}`}
                      value=""
                      onChange={(e) => {
                        const t = templates.find((x) => x.id === e.target.value);
                        if (t)
                          update(i, {
                            subject: i === 0 ? t.subject : s.subject,
                            body: t.body,
                            templateId: t.id,
                          });
                      }}
                      className={inputClass}
                    >
                      <option value="">Choose a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div>
                  <label
                    htmlFor={`subj-${s.key}`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    {i === 0 ? "Subject" : "Subject (leave empty to reply in the same thread)"}
                  </label>
                  <input
                    id={`subj-${s.key}`}
                    value={s.subject}
                    maxLength={300}
                    onChange={(e) => update(i, { subject: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor={`body-${s.key}`}
                    className="mb-1 block text-xs text-muted-foreground"
                  >
                    Email text
                  </label>
                  <Textarea
                    id={`body-${s.key}`}
                    rows={7}
                    value={s.body}
                    maxLength={10_000}
                    onChange={(e) => update(i, { body: e.target.value })}
                    className="font-mono text-[13px]"
                  />
                </div>
                {[
                  ...stepProblems.map((p) => p.message),
                  ...(stepProblems.length ? [] : liveIssues.map((x) => x.message)),
                ].map((m) => (
                  <p key={m} className="text-xs text-danger">
                    {m}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={steps.length >= 10}
          onClick={() =>
            setSteps((prev) => [
              ...prev,
              {
                key: Date.now() + Math.random(),
                subject: "",
                body: "",
                delayValue: 3,
                delayUnit: "days",
                templateId: null,
              },
            ])
          }
        >
          <Plus /> Add follow-up
        </Button>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save sequence"}
        </Button>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {problems.length ? (
        <InlineAlert tone="warning">Fix the highlighted steps, then save again.</InlineAlert>
      ) : null}
      {saved ? (
        <InlineAlert tone="success">Sequence saved. Next: open the Preview tab.</InlineAlert>
      ) : null}
    </div>
  );
}
