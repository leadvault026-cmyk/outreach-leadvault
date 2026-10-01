import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "@/db/rls";
import { templates } from "@/db/schema";
import { tokensUsed, validateTemplateText } from "@/domain/personalization";

/**
 * Plain-text email templates (architecture §4.6). Templates are reusable starting points: a
 * campaign copies their content into its own sequence, so editing a template never changes a
 * campaign that already uses it.
 */
export class TemplateError extends Error {
  constructor(
    public readonly code: "DUPLICATE_NAME" | "NOT_FOUND" | "INVALID",
    message: string,
    public readonly field?: "name" | "subject" | "body",
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

export const templateInputSchema = z.object({
  name: z.string().trim().min(2, "Name the template (at least 2 characters).").max(120),
  subject: z.string().trim().min(1, "Write a subject.").max(300),
  body: z.string().trim().min(1, "Write the email text.").max(10_000),
});
export type TemplateInput = z.input<typeof templateInputSchema>;

const isUnique = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
};

function validate(input: z.output<typeof templateInputSchema>) {
  const s = validateTemplateText(input.subject);
  if (s.length) throw new TemplateError("INVALID", s[0]!.message, "subject");
  const b = validateTemplateText(input.body);
  if (b.length) throw new TemplateError("INVALID", b[0]!.message, "body");
}

export async function listTemplates(db: AppDatabase, workspaceId: string) {
  return db
    .select()
    .from(templates)
    .where(and(eq(templates.workspaceId, workspaceId), isNull(templates.archivedAt)))
    .orderBy(asc(templates.name));
}

export async function getTemplate(db: AppDatabase, workspaceId: string, id: string) {
  const [t] = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.workspaceId, workspaceId),
        eq(templates.id, id),
        isNull(templates.archivedAt),
      ),
    );
  return t ?? null;
}

export async function createTemplate(
  tx: AppDatabase,
  actor: { workspaceId: string; userId: string },
  input: unknown,
): Promise<string> {
  const v = templateInputSchema.parse(input);
  validate(v);
  try {
    const [row] = await tx
      .insert(templates)
      .values({
        workspaceId: actor.workspaceId,
        ...v,
        variablesUsed: tokensUsed(v.subject, v.body),
        createdBy: actor.userId,
      })
      .returning({ id: templates.id });
    return row!.id;
  } catch (e) {
    if (isUnique(e))
      throw new TemplateError(
        "DUPLICATE_NAME",
        "A template with this name already exists.",
        "name",
      );
    throw e;
  }
}

export async function updateTemplate(
  tx: AppDatabase,
  actor: { workspaceId: string },
  id: string,
  input: unknown,
): Promise<void> {
  const v = templateInputSchema.parse(input);
  validate(v);
  try {
    const rows = await tx
      .update(templates)
      .set({ ...v, variablesUsed: tokensUsed(v.subject, v.body), updatedAt: new Date() })
      .where(
        and(
          eq(templates.workspaceId, actor.workspaceId),
          eq(templates.id, id),
          isNull(templates.archivedAt),
        ),
      )
      .returning({ id: templates.id });
    if (!rows.length) throw new TemplateError("NOT_FOUND", "Template not found.");
  } catch (e) {
    if (isUnique(e))
      throw new TemplateError(
        "DUPLICATE_NAME",
        "A template with this name already exists.",
        "name",
      );
    throw e;
  }
}

export async function archiveTemplate(tx: AppDatabase, actor: { workspaceId: string }, id: string) {
  const rows = await tx
    .update(templates)
    .set({ archivedAt: new Date() })
    .where(
      and(
        eq(templates.workspaceId, actor.workspaceId),
        eq(templates.id, id),
        isNull(templates.archivedAt),
      ),
    )
    .returning({ id: templates.id });
  if (!rows.length) throw new TemplateError("NOT_FOUND", "Template not found.");
}
