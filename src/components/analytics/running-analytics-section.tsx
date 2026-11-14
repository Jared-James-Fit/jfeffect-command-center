import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Footprints } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/analytics/info-tip";
import { fetchAllPages, chunk } from "@/lib/supabase-paginate";
import { formatClockSeconds } from "@/lib/duration";
import { formatDistance, formatPace, isRunningExercise, readDistanceUnit } from "@/lib/running/run-log";
import {
  paceByKind, paceIn, runReadiness, runSessions, runWeeks,
  type PlannedRun, type Readiness, type RunLogSet,
} from "@/lib/running/running-analytics";
import { cn } from "@/lib/utils";

interface Props {
  clientId: string;
  rangeStart: Date;
  rangeEnd: Date;
  rangeLabel: string;
}

const DAY = 86_400_000;
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const sb = supabase as any;

/**
 * Training Analytics → Running (the athlete's and the coach's alike): logged
 * runs from the workout logger (distance, time, effort), read whole, page by
 * page. Shown only once there's running to show. Math: running-analytics.ts.
 */
export function RunningAnalyticsSection({ clientId, rangeStart, rangeEnd, rangeLabel }: Props) {
  const unit = useMemo(() => readDistanceUnit(), []);
  const today = ymd(new Date());
  const startStr = ymd(rangeStart);
  const endStr = ymd(rangeEnd);
  // enough history for 8 weeks of bars and the last 14 days' readiness, whatever the range
  const loadFrom = ymd(new Date(Math.min(rangeStart.getTime(), rangeEnd.getTime() - 56 * DAY, Date.now() - 14 * DAY)));
  const loadTo = endStr > today ? endStr : today;

  const { data } = useQuery({
    queryKey: ["running-analytics", clientId, loadFrom, loadTo],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: exRows, error: exErr } = await sb.from("exercises").select("id, name").or("name.ilike.%run%,name.ilike.%jog%");
      if (exErr) throw exErr;
      const runIds: string[] = (exRows ?? []).filter((e: any) => isRunningExercise(e.name)).map((e: any) => e.id);
      if (!runIds.length) return { sets: [] as RunLogSet[], planned: [] as PlannedRun[] };

      const rows = await fetchAllPages<any>((f, t) =>
        sb.from("pl_row_results")
          .select("id, completed_at, scheduled_workout_id, completed_duration_seconds, actual_distance_m, actual_rpe_num, actual_rpe, pl_exercise_rows!inner(exercise_id, purpose_label, rpe, day_id)")
          .eq("client_id", clientId)
          .in("pl_exercise_rows.exercise_id", runIds)
          .not("completed_at", "is", null)
          .gte("completed_at", `${loadFrom}T00:00:00`)
          .lte("completed_at", `${loadTo}T23:59:59`)
          .order("completed_at", { ascending: true })
          .order("id", { ascending: true })
          .range(f, t),
      );
      const sets: RunLogSet[] = rows.map((r: any) => {
        const rpe = r.actual_rpe_num != null ? Number(r.actual_rpe_num) : r.actual_rpe ? Number(r.actual_rpe) : null;
        return {
          date: ymd(new Date(r.completed_at)),
          sessionKey: r.scheduled_workout_id ? `i:${r.scheduled_workout_id}` : `d:${r.pl_exercise_rows?.day_id ?? r.id}`,
          role: r.pl_exercise_rows?.purpose_label ?? null,
          seconds: r.completed_duration_seconds != null ? Number(r.completed_duration_seconds) : null,
          meters: r.actual_distance_m != null ? Number(r.actual_distance_m) : null,
          rpe: Number.isFinite(rpe) ? rpe : null,
          targetRpe: r.pl_exercise_rows?.rpe ?? null,
        };
      });

      // the last 14 days' planned runs, and which were done (readiness)
      const from14 = ymd(new Date(Date.now() - 13 * DAY));
      const { data: dayRows, error: dayErr } = await sb.from("pl_days")
        .select("id, scheduled_date, is_optional, pl_weeks!inner(pl_blocks!inner(client_id)), pl_exercise_rows!inner(exercise_id)")
        .eq("pl_weeks.pl_blocks.client_id", clientId)
        .in("pl_exercise_rows.exercise_id", runIds)
        .eq("archived", false)
        .is("deleted_at", null)
        .gte("scheduled_date", from14)
        .lte("scheduled_date", today);
      if (dayErr) throw dayErr;
      const days = (dayRows ?? []) as any[];
      const done = new Set<string>();
      for (const ids of chunk(days.map((d) => d.id))) {
        const { data: comps } = await sb.from("pl_day_completions").select("day_id, completed_at").in("day_id", ids);
        for (const c of comps ?? []) if (c.completed_at) done.add(c.day_id);
      }
      const planned: PlannedRun[] = days.map((d) => ({ date: d.scheduled_date, dayId: d.id, optional: !!d.is_optional, done: done.has(d.id) }));
      return { sets, planned };
    },
  });

  const view = useMemo(() => {
    if (!data) return null;
    const all = runSessions(data.sets);
    const inRange = all.filter((s) => s.date >= startStr && s.date <= endStr);
    const weeks = runWeeks(all.filter((s) => s.date <= endStr), endStr, 8);
    const spanWeeks = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / (7 * DAY)));
    const meters = inRange.reduce((t, s) => t + s.meters, 0);
    const longest = inRange.reduce<typeof inRange[number] | null>((best, s) => (!best || s.meters > best.meters || (s.meters === best.meters && s.seconds > best.seconds) ? s : best), null);
    return {
      inRange,
      weeks,
      meters,
      perWeek: meters / spanWeeks,
      longest,
      kinds: paceByKind(inRange),
      readiness: runReadiness(all, data.planned, today),
      hasPlanned: data.planned.length > 0,
    };
  }, [data, startStr, endStr, today, rangeStart, rangeEnd]);

  // nothing to do with running: no card at all
  if (!view || (view.inRange.length === 0 && !view.hasPlanned)) return null;

  const maxWeek = Math.max(1, ...view.weeks.map((w) => w.meters || w.seconds / 360));
  return (
    <section aria-label="Running" id="running" className="scroll-mt-24" data-running-analytics>
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-semibold text-foreground">
          <Footprints className="h-5 w-5 shrink-0" />
          <span className="truncate">Running</span>
          <InfoTip label="About running analytics" title="Running" align="start">
            From runs logged in workouts. A run is the whole session (warm-up, main set, cool-down) filed under its main set. Pace is only compared within one kind of run, from the main set alone: a faster average from more hard sessions isn't fitness, and hills, heat and wind change pace at the same effort.
          </InfoTip>
        </h2>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">{rangeLabel}</span>
      </div>
      <Card className="border-border/80 bg-card p-4">
        <ReadinessRow r={view.readiness} />

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Distance" value={formatDistance(view.meters, unit) || "—"} sub={`${view.inRange.length} run${view.inRange.length === 1 ? "" : "s"}`} />
          <Stat label="Per week" value={formatDistance(view.perWeek, unit) || "—"} sub="average" />
          <Stat
            label="Longest run"
            value={view.longest ? (formatDistance(view.longest.meters, unit) || formatClockSeconds(view.longest.seconds)) : "—"}
            sub={view.longest?.meters ? formatClockSeconds(view.longest.seconds) : undefined}
          />
          <Stat label="Time running" value={formatClockSeconds(view.inRange.reduce((t, s) => t + s.seconds, 0))} sub="h:mm:ss" />
        </div>

        <div className="mt-4" data-running-weeks>
          <div className="text-[11px] font-semibold text-muted-foreground">Last 8 weeks</div>
          <div className="mt-2 grid grid-cols-8 items-end gap-1.5" style={{ height: 72 }}>
            {view.weeks.map((w) => {
              const v = w.meters || w.seconds / 360;
              return (
                <div key={w.weekStart} className="flex h-full flex-col justify-end" title={`${format(new Date(`${w.weekStart}T12:00:00`), "MMM d")}: ${formatDistance(w.meters, unit) || "no distance"} · ${w.runs} run${w.runs === 1 ? "" : "s"}`}>
                  <div className="rounded-sm bg-foreground/70" style={{ height: `${Math.max(v ? 6 : 2, (v / maxWeek) * 100)}%`, opacity: v ? 1 : 0.25 }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 grid grid-cols-8 gap-1.5 text-center text-[10px] tabular-nums text-muted-foreground">
            {view.weeks.map((w) => <span key={w.weekStart}>{w.meters ? formatDistance(w.meters, unit).replace(/ (km|mi|m)$/, "") : w.runs ? w.runs : ""}</span>)}
          </div>
        </div>

        {view.kinds.length > 0 && (
          <div className="mt-4 border-t border-border pt-3" data-running-pace>
            <div className="text-[11px] font-semibold text-muted-foreground">Pace by kind of run (last 4 of each)</div>
            <ul className="mt-1.5 space-y-1">
              {view.kinds.map((k) => {
                const now = k.recent != null ? paceIn(k.recent, unit) : null;
                const was = k.before != null ? paceIn(k.before, unit) : null;
                return (
                  <li key={k.kind} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-foreground">{k.kind}<span className="ml-1.5 text-xs text-muted-foreground">{k.sessions}</span></span>
                    <span className="tabular-nums text-foreground">
                      {formatPace(now, unit)}
                      {was != null && <span className="ml-1.5 text-xs text-muted-foreground">was {formatPace(was, unit)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

function ReadinessRow({ r }: { r: Readiness }) {
  const tone =
    r.status === "progress" ? "text-success" : r.status === "unknown" ? "text-muted-foreground" : "text-warning";
  return (
    <div data-running-readiness={r.status}>
      <div className={cn("text-sm font-semibold", tone)}>{r.label}</div>
      <p className="mt-0.5 text-xs text-muted-foreground">{r.reasons.join(" ")}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="truncate text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
