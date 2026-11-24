/**
 * What a competitor's training seen outside a meet says about their level
 * (pure, tested in competition-competitor-training.test.ts).
 *
 * A meet is the only thing that's ever a result; training is evidence, and
 * evidence is weighed, never counted or ignored wholesale. Each observation
 * is turned into a platform-equivalent estimate (its load and reps, the
 * effort when it's known (an RPE, or a bar speed read as one), less what
 * training usually overstates on a platform: depth, commands, a pause), and
 * weighed by how far it can be trusted:
 *
 *  - recency            half its weight every 60 days, nothing past 150
 *  - specificity        the competition lift as judged counts; an unclear
 *                       one counts half; a variation (block pull, a
 *                       pin squat) never sets a level
 *  - rep range          singles to triples full, fours and fives less,
 *                       up to eights less again, more than that nothing
 *  - the source         a video beats a post beats a caption beats a note,
 *                       and a rep the coach marked questionable counts half
 *  - their history      how their own training has turned into meet lifts
 *                       when it's on file (else a measured default)
 *
 * How much of the gap between their meet level and this estimate goes into
 * the expected projection depends on the pattern, not one number: an
 * isolated lift moves it a little (at most 12% of the gap: posts are
 * selected), two separate days more, three or more days that agree over
 * three weeks or more up to three quarters of the gap. It works in both
 * directions: a consistent run of lighter training (an injury, a cut) pulls
 * the expected down the same way.
 */
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";
import { daysBetween } from "./milestones";
import type { Lift, Observation } from "./types";

export type TrainingSignal = {
  lift: Lift;
  /** platform-equivalent estimate (kg) */
  estimateKg: number;
  /** separate days that count */
  exposures: number;
  /** days between the first and last day that counts */
  spanDays: number;
  /** 0..1, how closely the days agree */
  consistency: number;
  /** 0..1, how far the evidence can be trusted overall */
  strength: number;
  /** share of the gap (signal − meet level) moved into the expected projection */
  weight: number;
  /** platform ÷ training used, and where it's from */
  conversion: { ratio: number; own: boolean };
  used: Observation[];
  why: string[];
};

const MAX_AGE = 150;
const SOURCE_W: Record<Observation["source"], number> = {
  video: 1,
  instagram: 0.85,
  caption: 0.8,
  screenshot: 0.75,
  link: 0.7,
  manual: 0.6,
};
const CONF_W = { high: 1, medium: 0.8, low: 0.5 } as const;
/** Training overstates the platform a little: depth, commands, a paused bench. */
export const DEFAULT_CONVERSION: Record<Lift, number> = {
  squat: 0.975,
  bench: 0.975,
  deadlift: 0.985,
};

/** A bar speed read as an RPE (generic, single to triple): approximate, said as such. */
export function rpeFromVelocity(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 0.5) return 7;
  if (v >= 0.4) return 7.5;
  if (v >= 0.32) return 8.5;
  if (v >= 0.25) return 9;
  return 9.5;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** One observation's platform-equivalent estimate and its weight (0 when it doesn't count). */
export function observationWeight(
  o: Observation,
  today: string,
): { e1: number; w: number; effortFrom: "rpe" | "velocity" | "assumed" } | null {
  if (!o.lift || !(o.loadKg > 0) || !(o.reps >= 1)) return null;
  if (o.standard === "variation") return null;
  const age = daysBetween(o.date, today);
  if (age < 0 || age > MAX_AGE) return null;
  if (o.reps > 8) return null;
  const vRpe = o.reps <= 3 ? rpeFromVelocity(o.velocity) : null;
  // a posted set with no effort given: assume a hard set (people post their best)
  const rpe = o.rpe ?? vRpe ?? 9;
  const effortFrom = o.rpe != null ? "rpe" : vRpe != null ? "velocity" : "assumed";
  const e1 = estimate1RMWithRpe(o.loadKg, o.reps, rpe);
  const reps = o.reps <= 3 ? 1 : o.reps <= 5 ? 0.85 : 0.65;
  const std = o.standard === "competition" ? 1 : 0.5;
  const tech = o.technique === "questionable" ? 0.5 : 1;
  const w =
    Math.pow(0.5, age / 60) *
    (SOURCE_W[o.source] ?? 0.6) *
    (CONF_W[o.confidence] ?? 0.5) *
    reps *
    std *
    tech *
    (effortFrom === "assumed" && o.reps > 1 ? 0.8 : 1);
  return { e1, w, effortFrom };
}

export function trainingSignal(input: {
  lift: Lift;
  observations: Observation[];
  today: string;
  /** their own platform ÷ training from past meets, when the record has it */
  ownConversion?: number | null;
}): TrainingSignal | null {
  const { lift, today } = input;
  const scored = input.observations
    .filter((o) => o.lift === lift)
    .map((o) => ({ o, s: observationWeight(o, today) }))
    .filter((x): x is { o: Observation; s: NonNullable<ReturnType<typeof observationWeight>> } =>
      !!x.s && x.s.w > 0,
    );
  if (!scored.length) return null;
  // one day, one number: the day's heaviest estimate
  const byDay = new Map<string, { e1: number; w: number; o: Observation }>();
  for (const { o, s } of scored) {
    const had = byDay.get(o.date);
    if (!had || s.e1 > had.e1) byDay.set(o.date, { e1: s.e1, w: Math.max(s.w, had?.w ?? 0), o });
  }
  const days = [...byDay.entries()]
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const top = Math.max(...days.map((d) => d.e1));
  // a light day isn't a maximal expression: it says nothing about the level
  const counted = days.filter((d) => d.e1 >= top * 0.9 && d.w >= 0.15);
  if (!counted.length) return null;
  const sumW = counted.reduce((s, d) => s + d.w, 0);
  const raw = counted.reduce((s, d) => s + d.e1 * d.w, 0) / sumW;
  const own = input.ownConversion != null && Number.isFinite(input.ownConversion);
  const ratio = own
    ? Math.min(1.03, Math.max(0.92, input.ownConversion!))
    : DEFAULT_CONVERSION[lift];
  const estimateKg = r1(raw * ratio);
  const exposures = counted.length;
  const spanDays = exposures > 1 ? daysBetween(counted[0].day, counted[counted.length - 1].day) : 0;
  let consistency = 0.5;
  if (exposures > 1) {
    const mean = counted.reduce((s, d) => s + d.e1, 0) / exposures;
    const sd = Math.sqrt(counted.reduce((s, d) => s + (d.e1 - mean) ** 2, 0) / exposures);
    consistency = Math.max(0, 1 - sd / mean / 0.06);
  }
  const spanW = spanDays >= 21 ? 1 : spanDays >= 7 ? 0.8 : 0.6;
  const strength = Math.min(1, sumW / 2.5) * (0.5 + 0.5 * consistency) * spanW;
  let weight =
    exposures === 1
      ? Math.min(0.12, 0.3 * strength)
      : exposures === 2
        ? Math.min(0.35, 0.6 * strength)
        : Math.min(0.75, 0.85 * strength);
  if (own && exposures >= 2) weight = Math.min(0.8, weight + 0.05);
  weight = Math.round(weight * 100) / 100;
  const why: string[] = [];
  why.push(
    `${exposures} training day${exposures === 1 ? "" : "s"} over ${spanDays} days point to about ${estimateKg} kg on the platform`,
  );
  if (exposures === 1) why.push("One lift on its own: it moves the expected only a little");
  if (exposures >= 3 && consistency >= 0.6 && spanDays >= 21)
    why.push("A consistent pattern across weeks: weighed heavily");
  if (!own)
    why.push(`Training to platform assumed ${ratio} (no history pairing their training with a meet)`);
  else why.push(`Their own training to platform ${ratio}`);
  if (counted.some((d) => d.o.technique === "questionable"))
    why.push("A rep marked questionable counts half");
  if (counted.some((d) => d.o.rpe == null && d.o.velocity == null && d.o.reps > 1))
    why.push("No effort given on a rep set: read as a hard set");
  return {
    lift,
    estimateKg,
    exposures,
    spanDays,
    consistency: Math.round(consistency * 100) / 100,
    strength: Math.round(strength * 100) / 100,
    weight,
    conversion: { ratio, own },
    used: counted.map((d) => d.o),
    why,
  };
}

/** How their training turned into meet lifts before, from observations dated before past meets. */
export function ownConversionFor(
  lift: Lift,
  observations: Observation[],
  meets: Array<{ date: string; lift: number | null }>,
): number | null {
  const ratios: number[] = [];
  for (const m of meets) {
    if (!m.lift) continue;
    const before = observations
      .filter((o) => {
        if (o.lift !== lift || o.standard !== "competition") return false;
        const d = daysBetween(o.date, m.date);
        return d >= 3 && d <= 70;
      })
      .map((o) => observationWeight(o, m.date))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!before.length) continue;
    const best = Math.max(...before.map((s) => s.e1));
    if (best > 0) ratios.push(m.lift / best);
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return Math.round(ratios[Math.floor(ratios.length / 2)] * 1000) / 1000;
}
