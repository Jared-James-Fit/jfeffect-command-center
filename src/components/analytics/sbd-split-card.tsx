import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Lightbulb, MessageCircle, Target, TrendingUp, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtNum, LIFT_COLORS } from "@/lib/analytics-format";
import { resultLoadLb } from "@/lib/pl-programs";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";
import {
  bestLoggedMaxes,
  compLiftFromName,
  LIFT_FOCUS,
  LIFT_LABEL,
  pickCurrentMaxes,
  SBD_LIFTS,
  sbdSplit,
  sessionsPerWeek,
  type NormSex,
  type SbdLift,
  type SbdMax,
} from "@/lib/analytics/sbd-split";

const LB_PER_KG = 2.2046226;
const WINDOW_WEEKS = 16;

type CompSet = { lift: SbdLift; load: number; reps: number; date: string; effort: boolean };
type Meet = { date: string; name: string | null; total: number; lifts: Record<SbdLift, number> };
type SbdData = {
  sets: CompSet[];
  coach: Partial<Record<SbdLift, SbdMax>>;
  meet: Meet | null;
  sex: NormSex | null;
};

function asSex(v: unknown): NormSex | null {
  const s = String(v ?? "").toLowerCase();
  return s.startsWith("f") ? "female" : s.startsWith("m") ? "male" : null;
}

async function loadSbd(clientId: string): Promise<SbdData> {
  const since = new Date(Date.now() - WINDOW_WEEKS * 7 * 86_400_000).toISOString();
  const [exRes, maxRes, athleteRes] = await Promise.all([
    supabase.from("exercises").select("id, competition_lift_type").eq("is_competition_lift", true),
    supabase
      .from("pl_client_maxes")
      .select("lift, one_rm, estimated_1rm, unit, tested_at, updated_at")
      .eq("client_id", clientId)
      .eq("active", true),
    supabase
      .from("powerlifting_athletes")
      .select("id, sex")
      .eq("client_id", clientId)
      .maybeSingle(),
  ]);

  const liftByExercise = new Map<string, SbdLift>();
  for (const e of exRes.data ?? []) {
    const t = (e.competition_lift_type ?? "").toLowerCase();
    const lift: SbdLift | null = t.includes("squat")
      ? "squat"
      : t.includes("bench")
        ? "bench"
        : t.includes("dead")
          ? "deadlift"
          : null;
    if (lift) liftByExercise.set(e.id, lift);
  }

  let sets: CompSet[] = [];
  if (liftByExercise.size) {
    const { data, error } = await supabase
      .from("pl_row_results")
      .select(
        "normalized_lb, normalized_kg, entered_value, entered_unit, actual_load, actual_load_unit, actual_reps, actual_rpe, actual_rir, load_type, is_bodyweight, completed_at, pl_exercise_rows!inner(exercise_id)",
      )
      .eq("client_id", clientId)
      .in("pl_exercise_rows.exercise_id", [...liftByExercise.keys()])
      .gte("completed_at", since)
      .not("actual_reps", "is", null)
      .not("completed_at", "is", null);
    if (error) throw error;
    const rows = (data ?? [])
      .filter(
        (r) =>
          r.load_type !== "assisted" && r.load_type !== "bodyweight" && r.is_bodyweight !== true,
      )
      .map((r) => {
        const lift = liftByExercise.get(r.pl_exercise_rows?.exercise_id ?? "")!;
        const load = resultLoadLb(r);
        return {
          exercise_id: lift,
          lift,
          load,
          reps: Number(r.actual_reps) || 0,
          est_1rm: load,
          date: r.completed_at as string,
          effort:
            (r.actual_rpe != null && r.actual_rpe !== "") ||
            (r.actual_rir != null && r.actual_rir !== ""),
        };
      });
    // Same conservative guard as the rest of analytics: an absurd imported
    // load spike never becomes someone's "max".
    sets = neutralizeObviousLoadOutliers(rows)
      .filter((r) => r.load > 0 && r.reps > 0)
      .map(({ lift, load, reps, date, effort }) => ({ lift, load, reps, date, effort }));
  }

  const coach: Partial<Record<SbdLift, SbdMax>> = {};
  for (const m of maxRes.data ?? []) {
    const lift = compLiftFromName(m.lift);
    const raw = Number(m.one_rm ?? m.estimated_1rm);
    if (!lift || !(raw > 0)) continue;
    const lb = m.unit === "kg" ? raw * LB_PER_KG : raw;
    if (!coach[lift] || lb > coach[lift]!.lb) {
      coach[lift] = { lift, lb, source: "coach", date: m.tested_at ?? m.updated_at ?? null };
    }
  }

  const athlete = athleteRes.data;
  const { data: meets } = await supabase
    .from("athlete_powerlifting_results")
    .select("squat_kg, bench_kg, deadlift_kg, total_kg, meet_date, meet_name, sex")
    .or(
      athlete ? `client_id.eq.${clientId},athlete_id.eq.${athlete.id}` : `client_id.eq.${clientId}`,
    )
    .not("meet_date", "is", null)
    .order("meet_date", { ascending: false })
    .limit(1);
  const m = meets?.[0];
  const meet: Meet | null =
    m?.meet_date && Number(m.squat_kg) > 0 && Number(m.bench_kg) > 0 && Number(m.deadlift_kg) > 0
      ? {
          date: m.meet_date,
          name: m.meet_name ?? null,
          total: (Number(m.squat_kg) + Number(m.bench_kg) + Number(m.deadlift_kg)) * LB_PER_KG,
          lifts: {
            squat: Number(m.squat_kg) * LB_PER_KG,
            bench: Number(m.bench_kg) * LB_PER_KG,
            deadlift: Number(m.deadlift_kg) * LB_PER_KG,
          },
        }
      : null;

  return { sets, coach, meet, sex: asSex(athlete?.sex) ?? asSex(m?.sex) };
}

/**
 * SBD Total — the powerlifting headline: estimated total, how it splits
 * across squat/bench/deadlift against a typical raw split, the lift
 * carrying it, the one with the most room, and focuses for that lift.
 * Reads current maxes (last 16 weeks), independent of the page's range.
 */
export function SbdSplitCard({
  clientId,
  displayUnit,
  conv,
  header,
}: {
  clientId: string;
  displayUnit: "lb" | "kg";
  conv: (lb: number) => number;
  /** Section heading, rendered only when there's comp-lift data to show. */
  header?: React.ReactNode;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["sbd-split", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: () => loadSbd(clientId),
  });

  // Sex isn't stored for most clients; the viewer can pick which norms to
  // compare against, remembered on this device only.
  const normKey = `sbd-norms:${clientId}`;
  const [pickedSex, setPickedSex] = useState<NormSex | null>(null);
  useEffect(() => {
    try {
      setPickedSex(asSex(localStorage.getItem(normKey)));
    } catch {
      /* storage unavailable */
    }
  }, [normKey]);
  const pickSex = (s: NormSex) => {
    setPickedSex(s);
    try {
      localStorage.setItem(normKey, s);
    } catch {
      /* storage unavailable */
    }
  };

  const model = useMemo(() => {
    if (!data) return null;
    const logged = bestLoggedMaxes(data.sets);
    const meetMaxes: Partial<Record<SbdLift, SbdMax>> = {};
    if (data.meet) {
      for (const lift of SBD_LIFTS) {
        meetMaxes[lift] = { lift, lb: data.meet.lifts[lift], source: "meet", date: data.meet.date };
      }
    }
    const maxes = pickCurrentMaxes(logged, data.coach, meetMaxes);
    const complete = SBD_LIFTS.every((l) => maxes[l]);
    const sex = data.sex ?? pickedSex;
    const split = complete
      ? sbdSplit(
          { squat: maxes.squat!.lb, bench: maxes.bench!.lb, deadlift: maxes.deadlift!.lb },
          sex,
        )
      : null;

    const notes: string[] = [];
    const withEffort = data.sets.filter((s) => s.effort).length;
    if (data.sets.length >= 6 && withEffort / data.sets.length < 0.6) {
      notes.push(
        `RPE is logged on ${Math.round((withEffort / data.sets.length) * 100)}% of your comp-lift sets. Log it on every top set: it's how load gets auto-regulated and how this page spots fatigue.`,
      );
    }
    if (split) {
      const now = new Date();
      const freq = Object.fromEntries(
        SBD_LIFTS.map((l) => [l, sessionsPerWeek(data.sets, l, now)]),
      ) as Record<SbdLift, number>;
      const busiest = SBD_LIFTS.reduce((a, b) => (freq[b] > freq[a] ? b : a));
      if (
        busiest !== split.focus &&
        freq[busiest] >= 1.5 &&
        freq[busiest] - freq[split.focus] >= 0.75
      ) {
        notes.push(
          `${LIFT_LABEL[split.focus]} got ${fmtNum(freq[split.focus])}× a week over the last 4 weeks vs ${fmtNum(freq[busiest])}× for ${LIFT_LABEL[busiest].toLowerCase()}. Frequency is usually the first lever for a lagging lift.`,
        );
      }
    }
    return { maxes, split, sex, notes, sexKnown: !!data.sex };
  }, [data, pickedSex]);

  if (isLoading || !model || !SBD_LIFTS.some((l) => model.maxes[l])) return null;

  const { maxes, split, sex, notes, sexKnown } = model;
  const fmtLb = (lb: number) => fmtNum(conv(lb));
  const fmtTotal = (lb: number) => Math.round(conv(lb)).toLocaleString();
  const meetDelta = split && data?.meet ? split.total - data.meet.total : null;
  const focus = split ? LIFT_FOCUS[split.focus] : null;
  const strongest = split?.lifts.find((l) => l.lift === split.strongest);
  const focusLift = split?.lifts.find((l) => l.lift === split.focus);

  // Nothing at all (not even an empty section) for athletes who don't
  // train the comp lifts, so the page spacing stays even.
  return (
    <section aria-label="SBD Total">
      {header}
      <Card className="space-y-4 border-border/80 bg-card p-4" data-testid="sbd-split">
        {split ? (
          <>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Estimated total
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-3xl font-black tabular-nums">{fmtTotal(split.total)}</span>
                <span className="text-sm font-semibold text-muted-foreground">{displayUnit}</span>
                {meetDelta != null && Math.abs(conv(meetDelta)) >= 0.5 && (
                  <span
                    className={cn(
                      "text-xs font-bold tabular-nums",
                      meetDelta > 0 ? "text-emerald-500" : "text-rose-500",
                    )}
                  >
                    {meetDelta > 0 ? "▲" : "▼"} {fmtTotal(Math.abs(meetDelta))} vs last meet
                  </span>
                )}
              </div>
              {data?.meet && (
                <div className="truncate text-[11px] text-muted-foreground">
                  Last meet: {fmtTotal(data.meet.total)} {displayUnit} ·{" "}
                  {format(new Date(data.meet.date), "MMM d, yyyy")}
                  {data.meet.name ? ` · ${data.meet.name}` : ""}
                </div>
              )}
            </div>

            <div
              className="flex h-9 overflow-hidden rounded-xl"
              role="img"
              aria-label="Share of total by lift"
            >
              {split.lifts.map((l) => (
                <div
                  key={l.lift}
                  className="flex min-w-0 items-center justify-center text-[11px] font-black text-white"
                  style={{ width: `${l.share * 100}%`, background: LIFT_COLORS[l.lift] }}
                >
                  <span className="truncate px-1">
                    {LIFT_LABEL[l.lift][0]} {fmtNum(l.share * 100)}%
                  </span>
                </div>
              ))}
            </div>

            <ul className="space-y-3">
              {split.lifts.map((l) => {
                const m = maxes[l.lift]!;
                // Track spans the typical range ±6 points so every share lands on it.
                const lo = Math.max(0, l.range[0] - 0.06);
                const hi = l.range[1] + 0.06;
                const pos = (v: number) =>
                  `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
                return (
                  <li key={l.lift}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
                          style={{ background: LIFT_COLORS[l.lift] }}
                        />
                        <span className="text-sm font-bold">{LIFT_LABEL[l.lift]}</span>
                        <span className="text-sm font-black tabular-nums">
                          {fmtLb(l.lb)} {displayUnit}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs font-bold tabular-nums",
                          l.status === "above"
                            ? "text-emerald-500"
                            : l.status === "below"
                              ? "text-amber-500"
                              : "text-muted-foreground",
                        )}
                      >
                        {fmtNum(l.share * 100)}% ·{" "}
                        {l.status === "above"
                          ? "Strength"
                          : l.status === "below"
                            ? "Room to grow"
                            : "Typical"}
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-2 rounded-full bg-muted">
                      <div
                        className="absolute inset-y-0 rounded-full bg-foreground/15"
                        style={{
                          left: pos(l.range[0]),
                          width: `calc(${pos(l.range[1])} - ${pos(l.range[0])})`,
                        }}
                      />
                      <div
                        className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
                        style={{ left: pos(l.share), background: LIFT_COLORS[l.lift] }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{sourceLabel(m, fmtLb, displayUnit)}</span>
                      <span className="shrink-0">
                        Typical {fmtNum(l.range[0] * 100)}–{fmtNum(l.range[1] * 100)}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {!sexKnown && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Compare to</span>
                <div
                  className="flex gap-1 rounded-lg bg-muted/50 p-0.5"
                  role="group"
                  aria-label="Typical split for"
                >
                  {(["male", "female"] as NormSex[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={sex === s}
                      onClick={() => pickSex(s)}
                      className={cn(
                        "h-8 rounded-md px-3 font-bold",
                        sex === s
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {s === "male" ? "Men" : "Women"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {strongest && focusLift && (
              <div className="space-y-2">
                <Callout icon={<Trophy className="h-4 w-4 text-emerald-500" />} tone="good">
                  {strongest.status === "above" ? (
                    <>
                      <b>{LIFT_LABEL[strongest.lift]} carries your total</b> at{" "}
                      {fmtNum(strongest.share * 100)}% vs {fmtNum(strongest.range[0] * 100)}–
                      {fmtNum(strongest.range[1] * 100)}% typical. Keep it strong; it's your edge on
                      the platform.
                    </>
                  ) : (
                    <>
                      <b>{LIFT_LABEL[strongest.lift]}</b> is your strongest lift relative to a
                      typical split.
                    </>
                  )}
                </Callout>
                <Callout icon={<Target className="h-4 w-4 text-amber-500" />} tone="focus">
                  {focusLift.status === "below" ? (
                    <>
                      <b>{LIFT_LABEL[focusLift.lift]} is your biggest opportunity</b> at{" "}
                      {fmtNum(focusLift.share * 100)}% vs {fmtNum(focusLift.range[0] * 100)}–
                      {fmtNum(focusLift.range[1] * 100)}% typical.
                      {split.gainToTypical != null && split.gainToTypical > 0
                        ? ` Bringing it to a typical share (${fmtNum(((focusLift.range[0] + focusLift.range[1]) / 2) * 100)}%) is worth about +${fmtTotal(split.gainToTypical)} ${displayUnit} on your total.`
                        : ""}
                    </>
                  ) : (
                    <>
                      Your split is balanced. <b>{LIFT_LABEL[focusLift.lift]}</b> sits lowest
                      against typical, so it's the best place to look for pounds.
                    </>
                  )}
                </Callout>
              </div>
            )}

            {focus && (
              <div className="rounded-xl border border-border bg-background p-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Lightbulb className="h-3.5 w-3.5 text-primary" />
                  {LIFT_LABEL[split.focus]} 1% wins · no extra sets
                </div>
                <ul className="space-y-2 text-[13px] leading-snug">
                  {focus.free.map((t) => (
                    <li key={t} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2 border-t border-border/70 pt-3 text-[13px] leading-snug">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-bold">Ask your coach: </span>
                    {focus.askCoach}
                  </span>
                </div>
              </div>
            )}

            {notes.length > 0 && (
              <div className="space-y-2">
                {notes.map((n) => (
                  <Callout
                    key={n}
                    icon={<TrendingUp className="h-4 w-4 text-sky-500" />}
                    tone="info"
                  >
                    {n}
                  </Callout>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2">
            <ul className="grid grid-cols-3 gap-2">
              {SBD_LIFTS.map((lift) => (
                <li
                  key={lift}
                  className="rounded-xl border border-border bg-background px-3 py-2.5"
                >
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {LIFT_LABEL[lift]}
                  </div>
                  <div className="text-lg font-black tabular-nums">
                    {maxes[lift] ? fmtLb(maxes[lift]!.lb) : "—"}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Log a{" "}
              {SBD_LIFTS.filter((l) => !maxes[l])
                .map((l) => LIFT_LABEL[l].toLowerCase())
                .join(" and ")}{" "}
              top set (or have your coach set a max) to see your full split.
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}

function sourceLabel(m: SbdMax, fmtLb: (lb: number) => string, unit: string) {
  const when = m.date ? format(new Date(m.date), "MMM d") : null;
  if (m.source === "logged" && m.set) {
    return `e1RM from ${fmtLb(m.set.load)} ${unit} × ${m.set.reps}${when ? ` · ${when}` : ""}`;
  }
  if (m.source === "coach") return `Coach max${when ? ` · ${when}` : ""}`;
  return `Meet${when ? ` · ${when}` : ""}`;
}

function Callout({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "good" | "focus" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border p-3 text-[13px] leading-snug",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/10",
        tone === "focus" && "border-amber-500/30 bg-amber-500/10",
        tone === "info" && "border-sky-500/30 bg-sky-500/10",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p>{children}</p>
    </div>
  );
}
