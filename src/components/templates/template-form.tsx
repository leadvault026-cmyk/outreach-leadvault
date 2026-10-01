"use client";

import { useActionState, useState } from "react";
import {
  archiveTemplateAction,
  saveTemplateAction,
} from "@/app/w/[workspaceSlug]/templates/actions";
import { InlineAlert } from "@/components/states/inline-alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { renderTemplate, validateTemplateText } from "@/domain/personalization";
import type { ActionResult } from "@/server/action-result";
import { SAMPLE_VALUES, TokenHelp } from "./token-help";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-danger";

export function TemplateForm({
  workspaceSlug,
  templateId,
  initial,
  canEdit,
  saved,
}: {
  workspaceSlug: string;
  templateId: string | null;
  initial: { name: string; subject: string; body: string };
  canEdit: boolean;
  saved?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    saveTemplateAction.bind(null, workspaceSlug, templateId),
    null,
  );
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const issues = [...validateTemplateText(subject), ...validateTemplateText(body)];
  const previewSubject = renderTemplate(subject, SAMPLE_VALUES).text;
  const previewBody = renderTemplate(body, SAMPLE_VALUES).text;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={action} className="space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <div>
            <label htmlFor="tpl-name" className="mb-1 block text-sm font-medium">
              Template name
            </label>
            <input
              id="tpl-name"
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={initial.name}
              aria-invalid={fe?.name ? true : undefined}
              className={inputClass}
            />
            {fe?.name ? <p className="mt-1 text-xs text-danger">{fe.name}</p> : null}
          </div>
          <div>
            <label htmlFor="tpl-subject" className="mb-1 block text-sm font-medium">
              Subject
            </label>
            <input
              id="tpl-subject"
              name="subject"
              required
              maxLength={300}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={fe?.subject ? true : undefined}
              className={inputClass}
            />
            {fe?.subject ? <p className="mt-1 text-xs text-danger">{fe.subject}</p> : null}
          </div>
          <div>
            <label htmlFor="tpl-body" className="mb-1 block text-sm font-medium">
              Email text (plain text)
            </label>
            <Textarea
              id="tpl-body"
              name="body"
              required
              rows={12}
              maxLength={10_000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={fe?.body ? true : undefined}
              className="font-mono text-[13px]"
            />
            {fe?.body ? <p className="mt-1 text-xs text-danger">{fe.body}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              An opt-out line and the workspace postal address are added automatically to every
              email.
            </p>
          </div>
        </fieldset>
        <TokenHelp />
        {issues.length ? <InlineAlert tone="warning">{issues[0]!.message}</InlineAlert> : null}
        {state && !state.ok && !fe ? <InlineAlert tone="danger">{state.error}</InlineAlert> : null}
        {(state?.ok || saved) && !pending ? (
          <InlineAlert tone="success">Template saved.</InlineAlert>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || issues.length > 0}>
              {pending ? "Saving…" : "Save template"}
            </Button>
            {templateId ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => archiveTemplateAction(workspaceSlug, templateId)}
              >
                Archive
              </Button>
            ) : null}
          </div>
        ) : null}
      </form>
      <section aria-labelledby="tpl-preview" className="rounded-lg border bg-card">
        <h2 id="tpl-preview" className="border-b px-4 py-2.5 text-sm font-semibold">
          Preview with a fictional contact
        </h2>
        <div className="space-y-3 px-4 py-3 text-sm">
          <p>
            <span className="text-muted-foreground">Subject: </span>
            <span className="font-medium">{previewSubject || "—"}</span>
          </p>
          <pre className="font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {previewBody || "—"}
          </pre>
          <p className="border-t pt-2 text-xs text-muted-foreground">
            Sample: Avery Collins, Practice Manager at Lone Star Family Clinic, Austin TX.
          </p>
        </div>
      </section>
    </div>
  );
}
