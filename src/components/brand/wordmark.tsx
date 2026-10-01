import { cn } from "@/lib/utils";

/**
 * Temporary text-only brand treatment. No logo is fabricated: replace with the approved
 * LeadVault logo asset when supplied (README → Brand).
 */
export function Wordmark({
  tone = "dark",
  className,
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-col leading-none select-none", className)}>
      <span
        className={cn(
          "text-[15px] font-extrabold tracking-[0.14em]",
          tone === "dark" ? "text-white" : "text-foreground",
        )}
      >
        LEADVAULT
      </span>
      <span
        className={cn(
          "mt-1 text-[10px] font-semibold tracking-[0.32em]",
          tone === "dark" ? "text-sidebar-primary" : "text-muted-foreground",
        )}
      >
        OUTREACH
      </span>
    </span>
  );
}
