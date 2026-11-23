/**
 * What a squat + bench + deadlift total is made of (pure, tested in
 * analytics-redesign.test.ts). Three kinds of total, never mixed:
 *  - "estimate": each lift's estimated strength today (lift-strength.ts'
 *    line), only when all three are current (a hard set in the last 42 days,
 *    or raised by a lighter set since): an old squat estimate is never added
 *    to this month's bench;
 *  - "meet": what was lifted at one competition, tested;
 *  - the meet history, one composition per meet.
 * Shares are descriptive. Whether a share means anything is read against the
 * athlete's OWN earlier compositions (`shareContext`), never a population
 * "ideal split": leverages, weight class and history move them.
 */
import { COMP_LIFTS, type CompLift, type MeetResult } from "@/lib/analytics/competition-strength";
import { envelopeAt } from "@/lib/analytics/strength-estimate";
import type { LiftStrength } from "@/lib/analytics/lift-strength";

export type CompositionKind = "estimate" | "meet";
export type Composition = {
  id: string;
  kind: CompositionKind;
  label: string;
  /** yyyy-mm-dd: the meet's day, or today for an estimate */
  day: string;
  lifts: Record<CompLift, { lb: number; share: number; basisDay: string }>;
  totalLb: number;
  bodyweightLb: number | null;
};

const DAY = 86_400_000;
export const CURRENT_WINDOW_DAYS = 42;

function compose(
  id: string,
  kind: CompositionKind,
  label: string,
  day: string,
  lbs: Record<CompLift, { lb: number; basisDay: string }>,
  bw: number | null,
): Composition {
  const total = COMP_LIFTS.reduce((a, l) => a + lbs[l].lb, 0);
  const lifts = {} as Composition["lifts"];
  for (const l of COMP_LIFTS)
    lifts[l] = {
      lb: Math.round(lbs[l].lb * 10) / 10,
      share: Math.round((lbs[l].lb / total) * 1000) / 10,
      basisDay: lbs[l].basisDay,
    };
  return { id, kind, label, day, lifts, totalLb: Math.round(total * 10) / 10, bodyweightLb: bw };
}

/** Why there's no current estimated total, in words ("no recent hard bench set"), or null when there is one. */
export function estimatedComposition(
  strength: Record<CompLift, LiftStrength>,
  today: string,
): { composition: Composition | null; missing: CompLift[] } {
  const t = Date.parse(`${today}T12:00:00Z`);
  const lbs = {} as Record<CompLift, { lb: number; basisDay: string }>;
  const missing: CompLift[] = [];
  for (const l of COMP_LIFTS) {
    const at = envelopeAt(strength[l].envelope, today);
    const basisAge = at ? (t - Date.parse(`${at.basis}T12:00:00Z`)) / DAY : Infinity;
    if (!at || at.state === "stale" || basisAge > CURRENT_WINDOW_DAYS) {
      missing.push(l);
      continue;
    }
    lbs[l] = { lb: at.value, basisDay: at.basis };
  }
  if (missing.length) return { composition: null, missing };
  return {
    composition: compose("estimate", "estimate", "Estimated now", today, lbs, null),
    missing,
  };
}

export function meetCompositions(meets: MeetResult[]): Composition[] {
  return meets.map((m) =>
    compose(
      `meet:${m.date}`,
      "meet",
      m.name ?? "Competition",
      m.date,
      {
        squat: { lb: m.lifts.squat, basisDay: m.date },
        bench: { lb: m.lifts.bench, basisDay: m.date },
        deadlift: { lb: m.lifts.deadlift, basisDay: m.date },
      },
      m.bodyweightLb,
    ),
  );
}

export type ShareContext = {
  lift: CompLift;
  share: number;
  vs: { label: string; share: number } | null;
  words: string;
};

/**
 * One line per lift: its share here against the athlete's own previous
 * composition (the meet before this one, or the last meet for an estimate).
 * "About the same" within 1.5 points: normal variation, not a weakness.
 */
export function shareContext(c: Composition, all: Composition[]): Record<CompLift, ShareContext> {
  const earlier =
    all
      .filter((x) => x.kind === "meet" && x.day < c.day && x.id !== c.id)
      .sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  const out = {} as Record<CompLift, ShareContext>;
  for (const l of COMP_LIFTS) {
    const share = c.lifts[l].share;
    if (!earlier) {
      out[l] = { lift: l, share, vs: null, words: `${share}% of this total.` };
      continue;
    }
    const prev = earlier.lifts[l].share;
    const d = Math.round((share - prev) * 10) / 10;
    const words =
      Math.abs(d) < 1.5
        ? `${share}% of the total, about the same as ${earlier.label} (${prev}%).`
        : `${share}% of the total, ${d > 0 ? "up" : "down"} from ${prev}% at ${earlier.label}.`;
    out[l] = { lift: l, share, vs: { label: earlier.label, share: prev }, words };
  }
  return out;
}

/** Donut geometry: each lift's arc (degrees, clockwise from 12 o'clock) with a gap between. */
export function donutArcs(
  c: Composition,
  gapDeg = 3,
): Array<{ lift: CompLift; start: number; end: number }> {
  let at = 0;
  return COMP_LIFTS.map((l) => {
    const sweep = (c.lifts[l].share / 100) * 360;
    const arc = { lift: l, start: at + gapDeg / 2, end: at + sweep - gapDeg / 2 };
    at += sweep;
    return arc;
  });
}
