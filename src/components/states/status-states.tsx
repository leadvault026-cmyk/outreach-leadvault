import { AlertTriangle, Lock, ServerCrash } from "lucide-react";
import type { ReactNode } from "react";

function StateFrame({
  icon,
  tone,
  title,
  children,
  footer,
}: {
  icon: ReactNode;
  tone: "danger" | "warning" | "neutral";
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const toneClass =
    tone === "danger"
      ? "bg-danger-soft text-danger"
      : tone === "warning"
        ? "bg-warning-soft text-warning"
        : "bg-muted text-muted-foreground";
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <span className={`mb-4 flex size-12 items-center justify-center rounded-full ${toneClass}`}>
        {icon}
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <div className="text-muted-foreground mt-2 text-sm leading-relaxed">{children}</div>
      {footer ? <div className="mt-6 flex flex-wrap justify-center gap-2">{footer}</div> : null}
    </div>
  );
}

/** Shown when the user lacks the role for a page or action. Reveals nothing about the data. */
export function PermissionDenied({
  requirement,
  footer,
}: {
  requirement?: string;
  footer?: ReactNode;
}) {
  return (
    <StateFrame
      icon={<Lock aria-hidden className="size-5" />}
      tone="warning"
      title="You don't have access to this page"
      footer={footer}
    >
      {requirement ? <p>{requirement}</p> : null}
      <p>If you need access, ask a workspace Owner or Admin to change your role.</p>
    </StateFrame>
  );
}

/** Generic system error. Never shows stack traces, SQL, or provider details. */
export function SystemError({
  reference,
  footer,
}: {
  reference?: string | null;
  footer?: ReactNode;
}) {
  return (
    <StateFrame
      icon={<ServerCrash aria-hidden className="size-5" />}
      tone="danger"
      title="Something went wrong"
      footer={footer}
    >
      <p>We couldn&apos;t load this page. The problem has been logged.</p>
      {reference ? (
        <p className="mt-2">
          Reference: <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{reference}</code>
        </p>
      ) : null}
    </StateFrame>
  );
}

export function WorkspaceUnavailable({ footer }: { footer?: ReactNode }) {
  return (
    <StateFrame
      icon={<AlertTriangle aria-hidden className="size-5" />}
      tone="neutral"
      title="Workspace not available"
      footer={footer}
    >
      <p>
        This workspace doesn&apos;t exist, or your account isn&apos;t a member of it. Check the link,
        or switch to one of your workspaces.
      </p>
    </StateFrame>
  );
}
