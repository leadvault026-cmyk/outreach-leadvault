import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const STYLES = {
  info: { box: "bg-info-soft text-info border-info/20", Icon: Info },
  success: { box: "bg-success-soft text-success border-success/20", Icon: CheckCircle2 },
  warning: { box: "bg-warning-soft text-warning border-warning/25", Icon: AlertTriangle },
  danger: { box: "bg-danger-soft text-danger border-danger/20", Icon: XCircle },
} as const;

/**
 * Inline notice for validation, provider and system messages. Danger/warning alerts are
 * announced to assistive technology (role="alert"); info/success use role="status".
 */
export function InlineAlert({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof STYLES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { box, Icon } = STYLES[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-[13px]", box, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 leading-relaxed">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
    </div>
  );
}
