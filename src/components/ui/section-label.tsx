import type { ReactNode } from "react";

/**
 * Quiet section label for stacked page sections (Cardio, Readiness, Your
 * month…): small muted caps so the numbers below carry the weight, not the
 * headings.
 */
export function SectionLabel({
  icon,
  children,
  action,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
      <h2 className="flex min-w-0 items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        {icon}
        <span className="truncate">{children}</span>
      </h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
