import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { SleepBucket } from "@/lib/analytics/recovery-score";
import {
  recoverySummary,
  sleepPatternInsight,
  type CheckoutRow,
  type RecoveryWeek,
} from "@/lib/analytics/recovery-trends";

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Recovery over the period from what was logged at check-out: sleep (hours,
 * from the range picked), how recovered they felt (1–5) and pain, week by
 * week. Observations only; the readiness score is an estimate and lives on
 * the Workouts page. A sleep pattern is said only when there is one.
 */
export function RecoveryTrendsCard({
  clientId,
  start,
  end,
}: {
  clientId: string;
  start: Date;
  end: Date;
}) {
  const startISO = format(start, "yyyy-MM-dd");
  const endISO = format(end, "yyyy-MM-dd");
  const { data, isLoading } = useQuery({
    queryKey: ["recovery-trends", clientId, startISO, endISO],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("pl_workout_feedback")
        .select(
          "created_at, sleep_bucket, recovery_today, pain, pl_day_completions!inner(completed_at, logging_percentage, session_rating, client_id)",
        )
        .eq("client_id", clientId)
        .gte("pl_day_completions.completed_at", `${startISO}T00:00:00`)
        .lte("pl_day_completions.completed_at", `${endISO}T23:59:59`);
      if (error) throw error;
      const out: CheckoutRow[] = ((rows ?? []) as any[])
        .filter((r) => r.pl_day_completions?.completed_at)
        // the period, on the athlete's own days (never trusting the embed filter alone)
        .filter((r) => {
          const d = localDay(r.pl_day_completions.completed_at);
          return d >= startISO && d <= endISO;
        })
        .map((r) => ({
          day: localDay(r.pl_day_completions.completed_at),
          sleepBucket: (r.sleep_bucket ?? null) as SleepBucket | null,
          recovery: r.recovery_today != null ? Number(r.recovery_today) : null,
          pain: r.pain ?? null,
          rating:
            r.pl_day_completions.session_rating != null
              ? Number(r.pl_day_completions.session_rating)
              : null,
          logging:
            r.pl_day_completions.logging_percentage != null
              ? Number(r.pl_day_completions.logging_percentage)
              : null,
        }));
      return out;
    },
  });

  const summary = useMemo(() => (data ? recoverySummary(data) : null), [data]);
  const pattern = useMemo(() => (data ? sleepPatternInsight(data) : null), [data]);

  if (isLoading) return <Card className="h-[180px] animate-pulse bg-muted/30" aria-hidden />;
  if (!summary || summary.checkouts === 0) {
    return (
      <Card className="p-4" data-recovery-trends-empty>
        <div className="text-sm font-medium text-foreground">No check-outs in this period</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Sleep, how recovered you felt and pain come from the quick check-out after a workout.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-4" data-recovery-trends>
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Sleep"
          value={summary.sleepAvg != null ? `${summary.sleepAvg}h` : "—"}
          sub={`${summary.sleepN} logged`}
        />
        <Stat
          label="Felt recovered"
          value={summary.recoveryAvg != null ? `${summary.recoveryAvg}/5` : "—"}
          sub={`${summary.recoveryN} logged`}
        />
        <Stat
          label="Pain flagged"
          value={String(summary.painSessions)}
          sub={`of ${summary.checkouts} check-outs`}
        />
      </div>

      {summary.weeks.length >= 2 && (
        <WeekBars
          title="Sleep before training, by week"
          weeks={summary.weeks}
          value={(w) => w.sleep}
          max={10}
          fmt={(v) => `${v}h`}
          refLine={{ value: 7, label: "7h" }}
        />
      )}
      {summary.weeks.length >= 2 && summary.recoveryN >= 2 && (
        <WeekBars
          title="How recovered you felt (1–5), by week"
          weeks={summary.weeks}
          value={(w) => w.recovery}
          max={5}
          fmt={(v) => `${v}`}
        />
      )}

      {(pattern || (summary.sleepChange != null && Math.abs(summary.sleepChange) >= 0.5)) && (
        <ul className="space-y-1.5 text-[13px] leading-snug text-foreground/85">
          {summary.sleepChange != null && Math.abs(summary.sleepChange) >= 0.5 && (
            <li>
              Sleep is {summary.sleepChange > 0 ? "up" : "down"} about{" "}
              {Math.abs(summary.sleepChange)}h in the second half of this period.
            </li>
          )}
          {pattern && <li>{pattern}</li>}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Sleep is logged as a range (7–8h reads as 7.5h). Only sessions with a check-out are counted.
      </p>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/** One measure, a thin bar a week, its value on tap / hover; pain weeks marked under the bar. */
function WeekBars({
  title,
  weeks,
  value,
  max,
  fmt,
  refLine,
}: {
  title: string;
  weeks: RecoveryWeek[];
  value: (w: RecoveryWeek) => number | null;
  max: number;
  fmt: (v: number) => string;
  refLine?: { value: number; label: string };
}) {
  const shown = weeks.slice(-16);
  return (
    <div>
      <div className="text-[12px] font-medium text-foreground">{title}</div>
      <div className="relative mt-2 flex h-20 items-end gap-[3px]" role="img" aria-label={title}>
        {refLine && (
          <span
            aria-hidden
            className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
            style={{ bottom: `${(refLine.value / max) * 100}%` }}
          >
            <span className="absolute -top-3.5 right-0 text-[10px] text-muted-foreground">
              {refLine.label}
            </span>
          </span>
        )}
        {shown.map((w) => {
          const v = value(w);
          return (
            <div
              key={w.week}
              className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`Week of ${format(new Date(`${w.week}T12:00:00`), "MMM d")}: ${v != null ? fmt(v) : "nothing logged"}${w.pain ? ` · pain flagged ${w.pain}×` : ""}`}
            >
              {v != null ? (
                <span
                  className="mx-[2px] block rounded-t-[3px] bg-foreground/70"
                  style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
                />
              ) : (
                <span className="mx-[2px] block h-[2px] bg-border" />
              )}
              <span
                className={cn(
                  "mx-auto mt-1 h-1 w-1 rounded-full",
                  w.pain ? "bg-amber-500" : "bg-transparent",
                )}
                aria-hidden
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{format(new Date(`${shown[0].week}T12:00:00`), "MMM d")}</span>
        {shown.some((w) => w.pain) && (
          <span className="inline-flex items-center gap-1">
            <span className="h-1 w-1 rounded-full bg-amber-500" /> pain flagged
          </span>
        )}
        <span>{format(new Date(`${shown[shown.length - 1].week}T12:00:00`), "MMM d")}</span>
      </div>
    </div>
  );
}
