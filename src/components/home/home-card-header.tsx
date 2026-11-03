import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one header Home's Progress cards share (Bodyweight, Water, Progress,
 * Devices): a plain icon, a 16px title, and at most one small action on the
 * right. Neutral on purpose: colour on Home means a status, not a card.
 */
export function HomeCardHeader({
  icon: Icon,
  title,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-10 items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="truncate text-base font-semibold">{title}</h3>
      </div>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

/** The header's one action ("History"): quiet, 40px+ to tap. */
export const HOME_CARD_ACTION = "h-10 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground";
