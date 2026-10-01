import { replySubject } from "./campaigns";
import { renderTemplate, type TokenName, type TokenValues } from "./personalization";

/**
 * Builds the exact subject and plain-text body of one sequence email (architecture §11, §19).
 * The same function feeds the campaign preview and the worker, so what the operator previews
 * is what is sent.
 */
export type ComposeStep = {
  stepNumber: number;
  subject: string | null; // null on a follow-up = reply in the same thread
  body: string;
};

export type ComposeInput = {
  step: ComposeStep;
  firstStep: ComposeStep;
  values: TokenValues;
  /** Footer text from the recipient's resolved jurisdiction policy, if any. */
  policyFooter: string | null;
  /** Workspace postal address, included when the policy requires it. */
  postalAddress: string | null;
  requiresPostalAddress: boolean;
  unsubscribeUrl: string;
};

export type Composed = {
  subject: string;
  body: string;
  /** Personalization fields with no value and no fallback: the message must not be sent. */
  missing: TokenName[];
  /** Compliance content that is required but not configured. */
  missingPostalAddress: boolean;
  isReply: boolean;
};

export function composeMessage(input: ComposeInput): Composed {
  const { step, firstStep, values } = input;
  const isReply = step.stepNumber > 1 && !step.subject;
  const subjectSource = isReply ? (firstStep.subject ?? "") : (step.subject ?? "");
  const subject = renderTemplate(subjectSource, values);
  const body = renderTemplate(step.body, values);

  const footer: string[] = [];
  if (input.policyFooter?.trim()) footer.push(input.policyFooter.trim());
  if (input.requiresPostalAddress && input.postalAddress?.trim())
    footer.push(input.postalAddress.trim());
  footer.push(`If you'd rather not hear from me again, opt out here: ${input.unsubscribeUrl}`);

  return {
    subject: isReply ? replySubject(subject.text) : subject.text.trim(),
    body: `${body.text.trim()}\n\n--\n${footer.join("\n")}\n`,
    missing: [...new Set([...subject.missing, ...body.missing])],
    missingPostalAddress: input.requiresPostalAddress && !input.postalAddress?.trim(),
    isReply,
  };
}
