import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Quiet section label for stacked page sections (Cardio, Readiness, Your
 * month, Home's Progress…): small muted caps so the numbers below carry the
 * weight, not the headings. The one section-label style: anything that names
 * a stack of cards uses this, not its own copy.
 */
export function SectionLabel({
  icon,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /** Spacing overrides (e.g. `mb-0` inside a `space-y-*` stack). */
  className?: string;
}) {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-3 px-0.5", className)}>
      <h2 className="flex min-w-0 items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon}
        <span className="truncate">{children}</span>
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
