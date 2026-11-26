/**
 * The small pieces competition preparation reads with (coach and athlete):
 * what a time or a number is (confirmed, estimated, recommended, unconfirmed)
 * as a quiet word, never a colour alone, and a readiness line.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { TimingStatus } from "@/lib/competition/event-timeline";
import type { ReadinessVerdict } from "@/lib/competition/prep-checklist";
import { READINESS_WORD } from "@/lib/competition/prep-checklist";

const STATUS_STYLE: Record<TimingStatus, string> = {
  confirmed: "text-success",
  estimated: "text-muted-foreground",
  recommended: "text-muted-foreground",
  unconfirmed: "text-warning",
};
const STATUS_SHORT: Record<TimingStatus, string> = {
  confirmed: "Confirmed",
  estimated: "Est.",
  recommended: "Suggested",
  unconfirmed: "Unconfirmed",
};

/** "Confirmed" / "Est." / "Suggested" / "Unconfirmed", small and quiet. */
export function StatusWord({ status, className }: { status: TimingStatus; className?: string }) {
  return (
    <span className={cn("text-[11px] font-medium", STATUS_STYLE[status], className)} data-status={status}>
      {STATUS_SHORT[status]}
    </span>
  );
}

const VERDICT_TONE: Record<ReadinessVerdict, string> = {
  ready: "text-success",
  on_track: "text-foreground",
  needs_attention: "text-warning",
  at_risk: "text-destructive",
};

export function ReadinessWord({ verdict, className }: { verdict: ReadinessVerdict; className?: string }) {
  return (
    <span className={cn("font-semibold", VERDICT_TONE[verdict], className)} data-readiness={verdict}>
      {READINESS_WORD[verdict]}
    </span>
  );
}

export function SectionCard({
  title,
  sub,
  right,
  children,
  className,
  ...rest
}: {
  title?: string;
  sub?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
} & Record<`data-${string}`, unknown>) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-4", className)} {...rest}>
      {title || right ? (
        <header className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? <h3 className="text-[15px] font-semibold">{title}</h3> : null}
            {sub ? <p className="text-[12.5px] text-muted-foreground">{sub}</p> : null}
          </div>
          {right}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** "Sat, Dec 5" */
export function dayWords(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function countdown(today: string, meetDate: string): string {
  const d = Math.round(
    (new Date(`${meetDate.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${today.slice(0, 10)}T12:00:00Z`).getTime()) / 864e5,
  );
  if (d < 0) return d === -1 ? "Yesterday" : `${-d} days ago`;
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `${d} days`;
}
