/**
 * Turning what's on file into the engine's inputs: strength on the lower
 * lifts from sets that can show it (comparable e1RM: RPE 7+, ≤ 10 reps, the
 * same reading every athlete screen uses), how it moved during their earlier
 * cuts, which weekdays carry a heavy squat or deadlift, what they've actually
 * been doing on the treadmill, and their cardio adherence. Pure, tested; the
 * server reads the rows (load.server.ts).
 */
import { comparableE1rm, strengthTrend, type StrengthTrend } from "@/lib/analytics/strength-read";
import { bodyweightPhases } from "@/lib/program-intel/athlete-development";
import type { PastPhase } from "@/lib/weight-management/target";
import { isTreadmill } from "@/lib/weight-management/treadmill";
import { addDays, daysBetween, round, weekdayOf } from "@/lib/weight-management/units";

export type LiftSet = { lift: "squat" | "deadlift"; date: string; kg: number; reps: number; rpe: number | null; rir: number | null };

/** Each session's best comparable e1RM, per lift, oldest first. */
export function sessionBests(sets: LiftSet[]): Record<"squat" | "deadlift", Array<{ date: string; value: number }>> {
  const by: Record<"squat" | "deadlift", Map<string, number>> = { squat: new Map(), deadlift: new Map() };
  for (const s of sets) {
    const e = comparableE1rm({ load: s.kg, reps: s.reps, rpe: s.rpe, rir: s.rir });
    if (e == null) continue;
    const m = by[s.lift];
    m.set(s.date, Math.max(m.get(s.date) ?? 0, e));
  }
  const out = (m: Map<string, number>) => [...m.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  return { squat: out(by.squat), deadlift: out(by.deadlift) };
}

/** The squat and deadlift over the last 8 weeks: down if either is clearly down. */
export function lowerLiftPerformance(sets: LiftSet[], today: string): { lower: "up" | "steady" | "down" | null; detail: string | null } {
  const from = addDays(today, -56);
  const bests = sessionBests(sets.filter((s) => s.date >= from && s.date <= today));
  const trends: Array<[string, StrengthTrend]> = [
    ["Squat", strengthTrend(bests.squat)],
    ["Deadlift", strengthTrend(bests.deadlift)],
  ];
  const read = trends.filter(([, t]) => t.kind !== "unclear") as Array<[string, Extract<StrengthTrend, { pct: number }>]>;
  if (!read.length) return { lower: null, detail: null };
  const words = read.map(([n, t]) => `${n} ${t.kind === "steady" ? "steady" : `${t.kind} ${Math.abs(t.pct)}%`}`).join(", ");
  const lower = read.some(([, t]) => t.kind === "down") ? "down" : read.some(([, t]) => t.kind === "up") ? "up" : "steady";
  return { lower, detail: `${words} over the last 8 weeks (comparable sets).` };
}

/**
 * Their earlier cuts and what strength did in them: each finished cutting
 * phase from their weigh-ins, the lower lifts' best comparable e1RM in the 3
 * weeks around its start against its last 3 weeks (the average of the lifts
 * that have both).
 */
export function pastCutPhases(bw: Array<{ date: string; kg: number }>, sets: LiftSet[], today: string): PastPhase[] {
  const bests = sessionBests(sets);
  const best = (pts: Array<{ date: string; value: number }>, a: string, b: string) => {
    const xs = pts.filter((p) => p.date >= a && p.date <= b).map((p) => p.value);
    return xs.length ? Math.max(...xs) : null;
  };
  return bodyweightPhases(bw)
    .filter((p) => p.to <= addDays(today, -14) && daysBetween(p.from, p.to) >= 21)
    .map((p) => {
      const changes = (["squat", "deadlift"] as const)
        .map((l) => {
          const a = best(bests[l], addDays(p.from, -21), addDays(p.from, 7));
          const b = best(bests[l], addDays(p.to, -21), p.to);
          return a && b ? ((b - a) / a) * 100 : null;
        })
        .filter((x): x is number => x != null);
      return { phase: p.phase, from: p.from, to: p.to, pctPerWeek: p.pctPerWeek, strengthChangePct: changes.length ? round(changes.reduce((s, x) => s + x, 0) / changes.length, 1) : null };
    });
}

export type PlannedDay = { date: string; rows: Array<{ order: number; lift: string | null }> };

/** Weekdays with a squat or deadlift among a workout's first 3 exercises (its main lift), from the next two weeks. */
export function heavyLowerWeekdays(days: PlannedDay[]): string[] {
  const hits = new Map<string, number>();
  for (const d of days) {
    const main = [...d.rows].sort((a, b) => a.order - b.order).slice(0, 3);
    if (main.some((r) => r.lift === "squat" || r.lift === "deadlift")) {
      const w = weekdayOf(d.date);
      hits.set(w, (hits.get(w) ?? 0) + 1);
    }
  }
  return [...hits.keys()];
}

export type CardioDone = { date: string; type: string | null; completed: boolean; skipped: boolean; speed: number | null; incline: number | null; rpe: number | null; minutes: number | null };

/** What they've been doing on the treadmill in the last 4 weeks (speeds read as mph, the unit the app logs). */
export function treadmillHistory(done: CardioDone[], today: string): { speedMph: number | null; inclinePct: number | null; avgRpe: number | null; sessions: number } | null {
  const from = addDays(today, -28);
  const xs = done.filter((d) => d.completed && !d.skipped && d.date >= from && d.date <= today && (d.type == null || isTreadmill(d.type)));
  if (!xs.length) return null;
  const avg = (vs: Array<number | null>, lo: number, hi: number) => {
    const ok = vs.filter((v): v is number => v != null && v >= lo && v <= hi);
    return ok.length >= 3 ? round(ok.reduce((a, b) => a + b, 0) / ok.length, 1) : null;
  };
  return { speedMph: avg(xs.map((x) => x.speed), 1.5, 4.5), inclinePct: avg(xs.map((x) => x.incline), 0, 15), avgRpe: avg(xs.map((x) => x.rpe), 1, 10), sessions: xs.length };
}

/** Sessions done in the last 4 weeks against what the plan asked for. */
export function cardioAdherence(done: CardioDone[], perWeek: number, today: string): { done: number; planned: number } | null {
  if (!(perWeek > 0)) return null;
  const from = addDays(today, -28);
  return { done: done.filter((d) => d.completed && !d.skipped && d.date >= from && d.date < today).length, planned: perWeek * 4 };
}

/** A waist reading from a measurements row in cm ("in" rows converted). */
export function waistCm(fields: Record<string, unknown> | null | undefined, unit: string | null | undefined): number | null {
  const v = Number((fields ?? {}).waist);
  if (!Number.isFinite(v) || v <= 0) return null;
  return /^in/i.test(String(unit ?? "")) ? round(v * 2.54, 1) : v;
}

/** The meet's sport from its prep: a bodybuilding show or photoshoot, else a powerlifting meet when it has a class. */
export function prepSport(goalType: string | null | undefined, weightClass: string | null | undefined): "powerlifting" | "bodybuilding" | "other" {
  const g = String(goalType ?? "").toLowerCase();
  if (/bodybuild|physique|photoshoot|show|stage/.test(g)) return "bodybuilding";
  if (/powerlift|meet|competition/.test(g) || String(weightClass ?? "").trim()) return "powerlifting";
  return "other";
}
