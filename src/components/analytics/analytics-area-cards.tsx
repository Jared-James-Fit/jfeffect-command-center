/**
 * The analytics page's smaller shared pieces that outlived the Nov 23 2026
 * redesign: a block's weekly volume (the coach's programming detail), the
 * "More detail" fold, and each lift's trend for anyone who isn't a
 * powerlifter. Every number from analytics-areas.ts; nothing worked out here.
 */
import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/today";
import type { BlockVolumeRow, LiftsTrending } from "@/lib/analytics/analytics-areas";

const fmtDay = (iso: string, f = "MMM d") => {
  const d = parseLocalDate(iso);
  return d ? format(d, f) : iso;
};
/** Working sets a week in each block (its finished weeks), as bars on one scale. */
export function BlockVolumeList({ rows }: { rows: BlockVolumeRow[] }) {
  if (rows.length < 2)
    return (
      <p className="text-sm text-muted-foreground">
        Needs two or more blocks with finished weeks in this period.
      </p>
    );
  const shown = rows.slice(-8);
  const max = Math.max(1, ...shown.map((r) => r.setsPerWeek));
  return (
    <div data-load-blocks>
      <p className="mb-2 text-xs text-muted-foreground">
        Working sets a week, each block's finished weeks
      </p>
      <ul className="space-y-2.5">
        {shown.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                <span className="font-semibold text-foreground">{r.setsPerWeek}</span> a week
                {r.hardShare != null ? ` · ${r.hardShare}% hard` : ""}
              </span>
            </div>
            <div className="mt-1 h-2">
              <span
                className="block h-full rounded-[3px] bg-[var(--chart-4)]"
                style={{ width: `${(r.setsPerWeek / max) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {fmtDay(r.start, "MMM d, yyyy")} · {r.weeks} week{r.weeks === 1 ? "" : "s"} ·{" "}
              {r.sessionsPerWeek} workouts a week
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Advanced cards, mounted only once opened (they read their own data). */
export function MoreDetail({
  label = "More detail",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-more-detail>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-4 text-[14px] font-medium text-foreground transition hover:bg-muted/40"
      >
        {label}
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="mt-4 space-y-6">{children}</div>}
    </div>
  );
}

/**
 * For anyone who isn't a powerlifter, Strength's first answer: each lift with
 * enough hard sessions in the period and how far its estimated max moved,
 * from a stated day. The biggest gain first; nothing shown without a trend.
 */
export function LiftsMovingCard({
  data,
  unit,
  conv,
}: {
  data: LiftsTrending;
  unit: string;
  conv: (lb: number) => number;
}) {
  const [all, setAll] = useState(false);
  if (!data.tracked) {
    return (
      <Card className="p-4 text-sm text-muted-foreground" data-lifts-moving-empty>
        Not enough hard sets in this period to show a trend yet. It needs 4 or more workouts over 3
        or more weeks with sets at RPE 7 or harder (about 3 reps or fewer left in the tank).
      </Card>
    );
  }
  const shown = all ? data.lifts : data.lifts.slice(0, 6);
  return (
    <Card className="divide-y divide-border/60 p-0" data-lifts-moving>
      {shown.map(({ name, trend }) => {
        const diff = Math.round(conv(trend.last) - conv(trend.first));
        const up = trend.kind === "up";
        return (
          <div key={name} className="flex min-h-12 items-center gap-3 px-4 py-2.5 text-[13px]">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{name}</div>
              <div className="truncate text-[12px] text-muted-foreground">
                Estimated max {Math.round(conv(trend.last))} {unit} · {trend.sessions} hard workouts
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div
                className={cn(
                  "font-semibold tabular-nums",
                  up ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                )}
              >
                {trend.kind === "steady"
                  ? "About the same"
                  : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} ${unit}`}
              </div>
              <div className="text-[11px] text-muted-foreground">
                since {fmtDay(trend.firstDate)}
              </div>
            </div>
          </div>
        );
      })}
      {data.lifts.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="flex min-h-11 w-full items-center px-4 text-[13px] font-medium text-foreground"
        >
          Show all {data.lifts.length} lifts
        </button>
      )}
    </Card>
  );
}
