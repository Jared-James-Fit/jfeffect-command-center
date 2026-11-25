/**
 * Recovery & Performance: the Workouts page's one section for "how recovered
 * am I" and "am I progressing" (it replaced the readiness row and the
 * Performance card, Nov 25 2026). On the page it's a summary: a small still
 * body coloured by recovery, today's score out of 100 for TODAY's workout
 * (today-recovery.ts), one status, this week's weight lifted in the athlete's
 * unit with the week's workouts, one short observation when there's
 * something to say and View all analytics. Tapping the body or the score
 * opens the full-screen recovery page (`RecoveryDetail`): the body to turn,
 * front / side / back, a tap on a muscle for its read, the factors and what
 * kind each is (a device, logged by you, estimated), pain always on top.
 *
 * This file is lazy: the Workouts page paints and Start works before any of
 * it (or the 3D body) loads.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getClientResults } from "@/lib/pl-programs";
import { useAnalyticsUnit } from "@/lib/analytics/use-analytics-unit";
import { formatWeightLifted } from "@/lib/weight-lifted";
import { InfoTip } from "@/components/analytics/info-tip";
import { BodyView, useDark } from "@/components/analytics/muscle-map";
import type { FineMuscle } from "@/lib/analytics/training-load";
import type { SleepBucket } from "@/lib/analytics/recovery-score";
import {
  buildTodayRecovery,
  weightLiftedKg,
  whenWords,
  type FactorKind,
  type RecentSet,
  type RecoveryState,
  type TodayRecovery,
} from "@/lib/analytics/today-recovery";

const sb = supabase as any;
const LB_PER_KG = 2.2046226;
const DAY = 86_400_000;
type Unit = "lb" | "kg";

/** green recovered, yellow moderate, red elevated (or pain), grey no data: concrete colours for the 3D body. */
export const RECOVERY_COLORS: Record<"light" | "dark", Record<RecoveryState | "pain", string>> = {
  light: { recovered: "#2fae74", moderate: "#e2b23a", elevated: "#d65450", pain: "#d65450", none: "#c4c8cf" },
  dark: { recovered: "#239a66", moderate: "#cfa12f", elevated: "#cc4d49", pain: "#cc4d49", none: "#4a4f58" },
};
export const STATE_WORD: Record<RecoveryState, string> = {
  recovered: "Recovered",
  moderate: "Moderate fatigue",
  elevated: "Elevated fatigue",
  none: "No data",
};
const KIND_WORD: Record<FactorKind, string> = { device: "Measured", logged: "You logged", estimated: "Estimated" };
const BAND_TEXT = {
  recovered: "text-emerald-600 dark:text-emerald-400",
  moderate: "text-amber-600 dark:text-amber-400",
  elevated: "text-rose-600 dark:text-rose-400",
} as const;

/** the muscle picked on the recovery page, kept for the visit */
let lastPicked: FineMuscle | null = null;

const localDay = (iso: string) => format(new Date(iso), "yyyy-MM-dd");

/** Everything today's recovery reads, from the queries the app already makes (the logged sets are analytics' own cache). */
export function useTodayRecovery(clientId: string, dayIds: string[]) {
  const today = format(new Date(), "yyyy-MM-dd");
  const results = useQuery({
    queryKey: ["pl-results", clientId, null],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: () => getClientResults(clientId),
  });
  const ids = useMemo(() => [...new Set(dayIds)].sort(), [dayIds]);
  const planned = useQuery({
    queryKey: ["today-planned-muscles", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await sb
        .from("pl_exercise_rows")
        .select("day_id, sets, exercises(muscle_group, primary_muscle_group, muscle_groups, secondary_muscle_groups, counts_toward_volume)")
        .in("day_id", ids);
      return ((data ?? []) as any[]).map((r) => ({
        sets: r.sets != null ? Number(r.sets) || null : null,
        primary: (r.exercises?.muscle_groups ?? []) as string[],
        secondary: (r.exercises?.secondary_muscle_groups ?? []) as string[],
        fallbackMuscle: r.exercises?.primary_muscle_group ?? r.exercises?.muscle_group ?? null,
        countsTowardVolume: r.exercises?.counts_toward_volume !== false,
      }));
    },
  });
  const signals = useQuery({
    queryKey: ["recovery-signals", clientId, today],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const since = (days: number) => new Date(Date.now() - days * DAY);
      const iso = (d: Date) => format(d, "yyyy-MM-dd");
      // each read on its own: one that fails (a table not there yet, RLS) only leaves its factor out
      const safe = async <T,>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> => {
        try {
          const { data, error } = await p;
          return error ? [] : (data ?? []);
        } catch {
          return [];
        }
      };
      const [checkouts, pain, cardio, sleep, energy] = await Promise.all([
        safe<any>(sb.from("pl_workout_feedback")
          .select("created_at, sleep_bucket, recovery_today, fatigue_feel, session_rpe, pain, pain_area, pain_level")
          .eq("client_id", clientId).gte("created_at", since(14).toISOString())),
        safe<any>(sb.from("pain_reports")
          .select("reported_on, region, side, site, score, severity")
          .eq("client_id", clientId).gte("reported_on", iso(since(21)))),
        safe<any>(sb.from("cardio_completions")
          .select("completed_date, duration_minutes, rpe, completed, skipped")
          .eq("client_id", clientId).gte("completed_date", iso(since(3)))),
        safe<any>(sb.from("progress_metrics")
          .select("entry_date, sleep_hours")
          .eq("client_id", clientId).gte("entry_date", iso(since(2))).not("sleep_hours", "is", null)),
        safe<any>(sb.from("nutrition_update_submissions")
          .select("submitted_at, energy_rating")
          .eq("client_id", clientId).gte("submitted_at", since(14).toISOString())),
      ]);
      return {
        checkouts: checkouts.map((c) => ({
          at: c.created_at,
          sleepBucket: (c.sleep_bucket ?? null) as SleepBucket | null,
          recovery: c.recovery_today != null ? Number(c.recovery_today) : null,
          fatigueFeel: c.fatigue_feel ?? null,
          sessionRpe: c.session_rpe != null ? Number(c.session_rpe) : null,
          pain: c.pain ?? null,
          painArea: c.pain_area ?? null,
          painLevel: c.pain_level != null ? Number(c.pain_level) : null,
        })),
        pain: pain.map((p) => ({ day: String(p.reported_on).slice(0, 10), region: p.region, side: p.side ?? null, site: p.site ?? null, score: p.score != null ? Number(p.score) : null, severity: p.severity ?? null })),
        cardio: cardio.filter((c) => c.completed && !c.skipped).map((c) => ({ day: String(c.completed_date).slice(0, 10), minutes: c.duration_minutes != null ? Number(c.duration_minutes) : null, rpe: c.rpe != null ? Number(c.rpe) : null })),
        sleep: sleep.map((s) => ({ day: String(s.entry_date).slice(0, 10), hours: Number(s.sleep_hours) || 0 })),
        energy: energy.filter((e) => e.energy_rating != null).map((e) => ({ day: localDay(e.submitted_at), rating: Number(e.energy_rating) })),
      };
    },
  });

  const read = useMemo(() => {
    const rs = (results.data ?? []) as any[];
    const cutoff = Date.now() - 43 * DAY;
    const sets: RecentSet[] = [];
    const weekSets: Array<{ day: string; loadKg: number; reps: number }> = [];
    for (const r of rs) {
      if (!r?.date) continue;
      const ms = Date.parse(r.date);
      if (!(ms >= cutoff)) continue;
      const rpe = r.rpe != null && r.rpe !== "" ? parseFloat(String(r.rpe)) : null;
      const loadKg = r.counts_load === false ? 0 : (Number(r.load) || 0) / LB_PER_KG;
      sets.push({
        at: r.date,
        reps: Number(r.reps) || 0,
        rpe: rpe != null && Number.isFinite(rpe) ? rpe : null,
        loadKg,
        exercise: r.exercise_name ?? null,
        primary: Array.isArray(r.primary_muscles) ? r.primary_muscles : [],
        secondary: Array.isArray(r.secondary_muscles) ? r.secondary_muscles : [],
        fallbackMuscle: r.muscle_group ?? null,
        countsTowardVolume: r.counts_toward_volume !== false,
      });
      weekSets.push({ day: localDay(r.date), loadKg, reps: Number(r.reps) || 0 });
    }
    const recovery = buildTodayRecovery({
      now: Date.now(),
      today,
      planned: planned.data ?? [],
      sets,
      ...(signals.data ?? {}),
    });
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
    return { recovery, weekKg: weightLiftedKg(weekSets, weekStart, today), everLogged: rs.length > 0 };
  }, [results.data, planned.data, signals.data, today]);

  return {
    ...read,
    loading: results.isLoading || (ids.length > 0 && planned.isLoading) || signals.isLoading,
  };
}

/** The colour a muscle is drawn in for recovery (pain always red, no data grey). */
export function useRecoveryColor(recovery: TodayRecovery | null) {
  const dark = useDark();
  const colorOf = useMemo(() => {
    const p = RECOVERY_COLORS[dark ? "dark" : "light"];
    return (m: FineMuscle) => {
      const r = recovery?.muscles[m];
      if (!r) return p.none;
      if (r.pain) return p.pain;
      return p[r.state];
    };
  }, [recovery, dark]);
  return { colorOf, dark };
}

function scoreWords(r: TodayRecovery): { big: ReactNode; status: string } {
  if (r.score == null) {
    return {
      big: <span className="text-muted-foreground">–</span>,
      status: r.reason === "break" ? "Rested: no training in 2+ weeks" : "Not enough data yet",
    };
  }
  return { big: r.score, status: r.status };
}

/** "Measured: your check-out and training" vs "Estimated from your training". */
function basisWords(r: TodayRecovery): string {
  if (r.score == null) return r.reason === "break" ? "Nothing to recover from" : "Log a few workouts and check-outs";
  return r.basis === "measured" ? "From your check-out and training" : "Estimated from your training";
}

export function RecoveryPerformanceSection({
  clientId,
  accountUnit,
  dayIds,
  week,
  onOpenRecovery,
  analyticsTo = "/portal/workouts/analytics",
}: {
  clientId: string;
  accountUnit: Unit;
  /** today's planned workouts (what the score is for) */
  dayIds: string[];
  /** this week's (Mon–Sun) planned workouts and how many are done */
  week: { planned: number; done: number } | null;
  onOpenRecovery: () => void;
  analyticsTo?: string;
}) {
  // lb / kg: the one remembered choice the analytics page uses too
  const [unit] = useAnalyticsUnit(accountUnit);
  const { recovery, weekKg, everLogged, loading } = useTodayRecovery(clientId, dayIds);
  const { colorOf, dark } = useRecoveryColor(recovery);

  if (loading) return <div className="h-[208px] rounded-2xl bg-muted/30 jf-skeleton" aria-hidden data-recovery-performance="loading" />;
  // nothing logged and nothing flagged: nothing to say yet (no "unlock it" card)
  if (!everLogged && !recovery.pain.length) return null;
  const { big, status } = scoreWords(recovery);
  const band = recovery.band;
  const lifted = formatWeightLifted(weekKg * LB_PER_KG, unit);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="recovery-performance-title" data-recovery-performance>
      <h2 id="recovery-performance-title" className="px-4 pt-3 text-[13px] font-semibold text-muted-foreground">
        Recovery &amp; performance
      </h2>
      <button
        type="button"
        onClick={onOpenRecovery}
        className="flex w-full items-center gap-3 px-3 pb-3 pt-1 text-left transition active:bg-muted/40"
        aria-label={`Recovery ${recovery.score != null ? `${recovery.score} out of 100, ${status}` : status}. Open your recovery`}
        data-recovery-open
      >
        {/* the page mounts this section only near the screen (DeferRender) and the body builds after idle */}
        <div className="h-[150px] w-[104px] shrink-0" aria-hidden>
          <BodyView colorOf={colorOf} picked={null} onPick={() => {}} dark={dark} preview heightClass="h-[150px]" ariaLabel="Your muscles coloured by recovery" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1 tabular-nums" data-recovery-score>
            <span className="text-[34px] font-bold leading-none tracking-tight">{big}</span>
            <span className="text-[13px] font-medium text-muted-foreground">/100</span>
          </div>
          <div className={cn("mt-1 text-[15px] font-semibold leading-snug", band ? BAND_TEXT[band] : "text-foreground")} data-recovery-status>
            {status}
          </div>
          <div className="text-[12px] text-muted-foreground" data-recovery-basis>{basisWords(recovery)}</div>
          {/* pain is always said, whatever the score */}
          {recovery.pain[0] && (
            <div className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[12px] font-medium text-rose-700 dark:text-rose-300" data-recovery-pain>
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{recovery.pain[0].label}{recovery.pain.length > 1 ? ` +${recovery.pain.length - 1}` : ""}</span>
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <div className="border-t border-border/60 px-4 py-2.5 text-[13.5px]" data-performance-week>
        <div className="flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
          <span className="font-semibold">{lifted}</span>
          <span className="text-muted-foreground">lifted this week</span>
          {week && week.planned > 0 && (
            <>
              <span className="text-muted-foreground" aria-hidden>·</span>
              <span className="text-muted-foreground"><span className="font-semibold text-foreground">{week.done} of {week.planned}</span> workouts</span>
            </>
          )}
        </div>
        {recovery.observation && !(recovery.pain[0] && recovery.observation.startsWith(recovery.pain[0].label)) && (
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground" data-recovery-observation>{recovery.observation}</p>
        )}
      </div>
      <Link
        to={analyticsTo as any}
        className="flex min-h-11 items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[14px] font-medium transition hover:bg-muted/40"
        data-view-analytics
      >
        View all analytics
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Link>
    </section>
  );
}

/** The full-screen recovery page's content: the body to work with, the score, pain, and what went into it. */
export function RecoveryDetail({
  clientId,
  dayIds,
  workoutTitle,
  analyticsTo = "/portal/workouts/analytics",
}: {
  clientId: string;
  dayIds: string[];
  workoutTitle: string | null;
  analyticsTo?: string;
}) {
  const { recovery, loading } = useTodayRecovery(clientId, dayIds);
  const { colorOf, dark } = useRecoveryColor(recovery);
  // the muscle picked stays picked for the visit (closing and reopening the page keeps it)
  const [picked, setPicked] = useState<FineMuscle | null>(() => lastPicked);
  const pick = (m: FineMuscle | null) => {
    lastPicked = m;
    setPicked(m);
  };
  if (loading) return <div className="h-[520px] rounded-2xl bg-muted/30 jf-skeleton" aria-hidden />;
  const { big, status } = scoreWords(recovery);
  const pm = picked ? recovery.muscles[picked] : null;
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <div className="space-y-5" data-recovery-detail>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1 tabular-nums">
            <span className="text-[44px] font-bold leading-none tracking-tight">{big}</span>
            <span className="text-[14px] font-medium text-muted-foreground">/100</span>
          </div>
          <div className={cn("mt-1 text-[17px] font-semibold", recovery.band ? BAND_TEXT[recovery.band] : "")}>{status}</div>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {recovery.scope === "workout" ? `For today's workout${workoutTitle ? `: ${workoutTitle}` : ""}` : "For training in general (no workout today)"}
            {" · "}
            {basisWords(recovery)}
          </p>
        </div>
        <InfoTip label="How recovery is worked out" title="How recovery is worked out">
          <p>Each muscle's fatigue comes from the sets you logged in the last week (how hard and how long ago), measured against your own usual workout for that muscle. The score weighs the muscles today's workout uses, then what you logged: sleep, how recovered you felt, cardio, energy and pain.</p>
          <p className="mt-2">It's an estimate from your logs, never a measurement of your body, and it never changes your program. Pain you flag always shows and keeps the score down.</p>
        </InfoTip>
      </div>

      {recovery.pain.length > 0 && (
        <ul className="space-y-1.5" data-recovery-pain-list>
          {recovery.pain.map((p) => (
            <li key={`${p.label}:${p.day}`} className="flex items-start gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-[13.5px] text-rose-800 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="font-semibold">{p.label}</span> flagged {whenWords(p.day, today)}
                {p.score != null ? ` (${p.score}/10)` : ""}
                {p.relevant ? " · counted in today's score" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <BodyView colorOf={colorOf} picked={picked} onPick={pick} dark={dark} heightClass="h-[380px] md:h-[460px]" ariaLabel="Your muscles coloured by recovery. Drag to turn, pinch to zoom, tap a muscle for its recovery." />
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted-foreground" aria-label="What the colours show" data-recovery-legend>
          {(["recovered", "moderate", "elevated", "none"] as const).map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: RECOVERY_COLORS[dark ? "dark" : "light"][s] }} aria-hidden />
              {s === "elevated" ? "Elevated fatigue or pain" : STATE_WORD[s]}
            </li>
          ))}
        </ul>
      </div>

      {pm ? (
        <div className="rounded-2xl border border-border p-4" data-recovery-muscle={pm.muscle}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[16px] font-semibold">{pm.muscle}</h3>
            <button type="button" onClick={() => pick(null)} className="h-9 rounded-lg px-2 text-[13px] text-muted-foreground hover:text-foreground">Close</button>
          </div>
          <p className="mt-0.5 text-[14px] font-medium">{pm.pain ? "Pain flagged" : STATE_WORD[pm.state]}</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
            <Fact label="Last trained" value={pm.lastTrained ? whenWords(pm.lastTrained, today) : "Not in 6 weeks"} />
            <Fact label="Sets, last 3 days" value={pm.sets72h ? String(pm.sets72h) : "None"} />
            <Fact label="Today's workout" value={pm.todayShare ? `${Math.round(pm.todayShare * 100)}% of its work` : "Doesn't use it"} />
            {pm.mainExercise && <Fact label="Most from" value={pm.mainExercise} />}
          </dl>
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">Tap a muscle to see how recovered it is.</p>
      )}

      {recovery.relevant.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">{recovery.scope === "workout" ? "Today's muscles" : "Your muscles"}</h3>
          <ul className="divide-y divide-border/60">
            {recovery.relevant.slice(0, 8).map((m) => {
              const r = recovery.muscles[m];
              return (
                <li key={m}>
                  <button type="button" onClick={() => pick(m)} className="flex min-h-11 w-full items-center gap-2 text-left text-[14px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(m) ?? undefined }} aria-hidden />
                    <span className="flex-1">{m}</span>
                    <span className="text-[13px] text-muted-foreground">{r.pain ? "Pain flagged" : STATE_WORD[r.state]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recovery.factors.length > 0 && (
        <section data-recovery-factors>
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">What went into it</h3>
          <ul className="divide-y divide-border/60">
            {recovery.factors.map((f) => (
              <li key={f.key} className="flex items-start gap-2 py-2 text-[14px]">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{f.label}</div>
                  <div className="text-[13px] text-muted-foreground">{f.detail}</div>
                </div>
                <div className="shrink-0 text-right">
                  {f.effect !== 0 && <div className="text-[13px] font-semibold tabular-nums">{f.effect > 0 ? `+${f.effect}` : f.effect}</div>}
                  <div className="text-[11px] text-muted-foreground" data-factor-kind={f.kind}>{KIND_WORD[f.kind]}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* recovery, workload and development are three different reads: the other two are analytics' muscle map */}
      <section className="rounded-2xl bg-muted/40 p-4 text-[13.5px]">
        <p className="text-muted-foreground">
          This is recovery: how fresh each muscle is today. How much each muscle has been trained (workload) and where it's progressing (development) are the muscle training map in analytics.
        </p>
        <Link to={analyticsTo as any} search={{ view: "training" } as any} className="mt-2 inline-flex min-h-10 items-center gap-1 font-semibold" data-recovery-muscle-map>
          Open the muscle training map <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      <Link
        to={analyticsTo as any}
        className="flex min-h-12 items-center justify-between rounded-2xl border border-border px-4 text-[15px] font-semibold"
        data-view-analytics
      >
        View all analytics <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}


function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
