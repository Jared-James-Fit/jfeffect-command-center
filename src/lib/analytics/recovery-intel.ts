/**
 * Patterns between this athlete's training and recovery (pure, tested in
 * analytics-redesign.test.ts). Each one compares two groups of THEIR OWN
 * sessions and is said only when both groups are big enough and the gap is
 * bigger than ordinary noise; otherwise nothing is said. A pattern is never a
 * cause, and a normal fluctuation is never an alert.
 *
 *  - sleep: how strong sessions were after longer vs shorter sleep (the
 *    session's best competition-lift estimate as a % of their estimated
 *    strength then, else the session's own rating);
 *  - demanding days: how recovered they felt at the next check-out after
 *    their most demanding sessions vs the rest;
 *  - effort drift: RPE at the SAME loads and reps, the last 3 weeks against
 *    the 3 before (harder = possible fatigue, easier = adaptation);
 *  - lighter weeks: strength the week after a clear volume cut vs before it.
 */
import { sleepBucketHours } from "@/lib/analytics/recovery-score";
import type { CheckoutRow } from "@/lib/analytics/recovery-trends";
import type { DaySummary } from "@/lib/analytics/performance-calendar";
import { envelopeAt } from "@/lib/analytics/strength-estimate";
import type { LiftStrength } from "@/lib/analytics/lift-strength";
import { COMP_LIFTS, COMP_LIFT_LABEL, type CompLift } from "@/lib/analytics/competition-strength";

export type RecoveryPattern = {
  id: "sleep" | "demanding" | "drift" | "lighter";
  title: string;
  words: string;
  /** two bars to draw: the groups compared */
  compare: {
    unit: string;
    a: { label: string; value: number; n: number };
    b: { label: string; value: number; n: number };
  } | null;
  tone: "good" | "watch" | "info";
};

export const MIN_EACH = 4;
const DAY = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A session's strength as a % of the athlete's estimated strength that day (best comp lift), or null. */
export function sessionStrengthIndex(
  day: string,
  strength: Record<CompLift, LiftStrength>,
): number | null {
  let best: number | null = null;
  for (const l of COMP_LIFTS) {
    const s = strength[l].sessions.find(
      (x) => x.day === day && x.confidence === "high" && !x.outlier,
    );
    if (!s) continue;
    // against the line before the day, so the day can't set its own reference
    const prior = envelopeAt(
      strength[l].envelope,
      new Date(dayMs(day) - DAY).toISOString().slice(0, 10),
    );
    if (!prior || !(prior.value > 0)) continue;
    const idx = (s.e1rm / prior.value) * 100;
    if (best == null || idx > best) best = idx;
  }
  return best;
}

export function recoveryPatterns(input: {
  checkouts: CheckoutRow[];
  days: DaySummary[];
  strength: Record<CompLift, LiftStrength>;
  /** every rated comp-lift set: day, lift, load (lb), reps, rpe */
  ratedSets: Array<{ day: string; lift: CompLift; load: number; reps: number; rpe: number }>;
  today: string;
}): RecoveryPattern[] {
  const out: RecoveryPattern[] = [];
  const byDay = new Map(input.days.map((d) => [d.day, d]));

  // ── sleep ─────────────────────────────────────────────────────────────
  {
    const rows = input.checkouts
      .map((c) => ({
        c,
        h: sleepBucketHours(c.sleepBucket),
        idx: sessionStrengthIndex(c.day, input.strength),
      }))
      .filter((x): x is { c: CheckoutRow; h: number; idx: number | null } => x.h != null);
    const useIdx = rows.filter((x) => x.idx != null).length >= MIN_EACH * 2;
    const scored = rows
      .map((x) => ({ h: x.h, v: useIdx ? x.idx : x.c.rating }))
      .filter((x): x is { h: number; v: number } => x.v != null);
    if (scored.length >= MIN_EACH * 2) {
      const hs = scored.map((x) => x.h).sort((a, b) => a - b);
      const cut = Math.max(7, hs[Math.floor(hs.length / 2)]);
      const long = scored.filter((x) => x.h >= cut);
      const short = scored.filter((x) => x.h < cut);
      const gap = avg(long.map((x) => x.v)) - avg(short.map((x) => x.v));
      const big = useIdx ? Math.abs(gap) >= 2 : Math.abs(gap) >= 0.5;
      if (long.length >= MIN_EACH && short.length >= MIN_EACH && big) {
        const unit = useIdx ? "Top set as a % of your estimated max" : "Workout rating out of 5";
        out.push({
          id: "sleep",
          title: gap > 0 ? "Better sessions after more sleep" : "Sleep and sessions don't line up",
          words:
            gap > 0
              ? `After ${cut} hours of sleep or more, your ${useIdx ? "top sets were stronger" : "workouts rated higher"} than after less (${long.length} and ${short.length} workouts). A pattern in your logs, not proof.`
              : `Your ${useIdx ? "top sets" : "workouts"} weren't better after longer sleep in these logs (${long.length} and ${short.length} workouts).`,
          compare: {
            unit,
            a: { label: `${cut}+ hours' sleep`, value: r1(avg(long.map((x) => x.v))), n: long.length },
            b: { label: `Under ${cut} hours`, value: r1(avg(short.map((x) => x.v))), n: short.length },
          },
          tone: gap > 0 ? "info" : "info",
        });
      }
    }
  }

  // ── demanding days → the next check-out's recovery ─────────────────────
  {
    const trained = input.days.filter((d) => d.sets > 0).sort((a, b) => a.day.localeCompare(b.day));
    const tons = trained.map((d) => d.tonnageLb).sort((a, b) => a - b);
    const q75 = tons.length ? tons[Math.floor(tons.length * 0.75)] : Infinity;
    const after = (day: string) =>
      input.checkouts
        .filter((c) => c.day > day && dayMs(c.day) - dayMs(day) <= 4 * DAY && c.recovery != null)
        .sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
    const hard: number[] = [];
    const rest: number[] = [];
    let deadliftHeavy = 0;
    for (const d of trained) {
      const nxt = after(d.day);
      if (!nxt || nxt.recovery == null) continue;
      const demanding = d.tonnageLb >= q75 || (d.avgRpe ?? 0) >= 8.5;
      (demanding ? hard : rest).push(nxt.recovery);
      if (demanding && d.topSets.some((t) => t.comp && /dead/i.test(t.exercise))) deadliftHeavy++;
    }
    const gap = avg(rest) - avg(hard);
    if (hard.length >= MIN_EACH && rest.length >= MIN_EACH && gap >= 0.5) {
      const dl = deadliftHeavy >= Math.ceil(hard.length / 2);
      out.push({
        id: "demanding",
        title: dl
          ? "Heavier deadlift days, slower recovery"
          : "Your biggest days take longer to recover from",
        words: `After your ${dl ? "heaviest deadlift days" : "hardest workouts"} you felt about ${r1(avg(hard))} out of 5 recovered next time, against ${r1(avg(rest))} after other days. That's normal after hard work, and worth knowing when you plan the next day.`,
        compare: {
          unit: "How recovered you felt, out of 5",
          a: { label: "After other days", value: r1(avg(rest)), n: rest.length },
          b: {
            label: dl ? "After heavy deadlifts" : "After hard days",
            value: r1(avg(hard)),
            n: hard.length,
          },
        },
        tone: "info",
      });
    }
  }

  // ── effort drift at the same loads ─────────────────────────────────────
  {
    const t = dayMs(input.today);
    const recent = input.ratedSets.filter(
      (s) => t - dayMs(s.day) <= 21 * DAY && s.day <= input.today,
    );
    const earlier = input.ratedSets.filter(
      (s) => t - dayMs(s.day) > 21 * DAY && t - dayMs(s.day) <= 42 * DAY,
    );
    let worst: { lift: CompLift; diff: number; n: number } | null = null;
    for (const lift of COMP_LIFTS) {
      const diffs: number[] = [];
      for (const r of recent.filter((s) => s.lift === lift)) {
        const match = earlier.filter(
          (e) =>
            e.lift === lift && e.reps === r.reps && Math.abs(e.load - r.load) / r.load <= 0.025,
        );
        if (match.length) diffs.push(r.rpe - avg(match.map((m) => m.rpe)));
      }
      if (diffs.length >= MIN_EACH) {
        const d = avg(diffs);
        if (Math.abs(d) >= 0.75 && (!worst || Math.abs(d) > Math.abs(worst.diff)))
          worst = { lift, diff: r1(d), n: diffs.length };
      }
    }
    if (worst) {
      const harder = worst.diff > 0;
      out.push({
        id: "drift",
        title: harder
          ? `Same ${COMP_LIFT_LABEL[worst.lift].toLowerCase()} loads feel harder`
          : `Same ${COMP_LIFT_LABEL[worst.lift].toLowerCase()} loads feel easier`,
        words: harder
          ? `The same ${COMP_LIFT_LABEL[worst.lift].toLowerCase()} weights and reps feel about ${worst.diff} points harder than 3 to 6 weeks ago (RPE, how hard a set feels out of 10; ${worst.n} sets). Often tiredness building up, so keep an eye on sleep and recovery.`
          : `The same ${COMP_LIFT_LABEL[worst.lift].toLowerCase()} weights and reps feel about ${Math.abs(worst.diff)} points easier than 3 to 6 weeks ago (RPE, how hard a set feels out of 10; ${worst.n} sets). A sign your body is adapting to the training.`,
        compare: null,
        tone: harder ? "watch" : "good",
      });
    }
  }

  // ── after a lighter week ───────────────────────────────────────────────
  {
    const weeks = new Map<string, { sets: number; idx: number[] }>();
    for (const d of input.days) {
      const m = new Date(dayMs(d.day) - ((new Date(dayMs(d.day)).getUTCDay() + 6) % 7) * DAY)
        .toISOString()
        .slice(0, 10);
      const w = weeks.get(m) ?? { sets: 0, idx: [] };
      w.sets += d.sets;
      const i = d.sets ? sessionStrengthIndex(d.day, input.strength) : null;
      if (i != null) w.idx.push(i);
      weeks.set(m, w);
    }
    const ws = [...weeks.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ k, ...v }));
    const afterCut: number[] = [];
    const normal: number[] = [];
    for (let i = 3; i < ws.length - 1; i++) {
      const base = avg(ws.slice(i - 3, i).map((w) => w.sets));
      if (!(base > 0) || !ws[i].sets) continue;
      const next = ws[i + 1];
      if (!next.idx.length) continue;
      const v = Math.max(...next.idx);
      if (ws[i].sets <= base * 0.7) afterCut.push(v);
      else normal.push(v);
    }
    if (afterCut.length >= 2 && normal.length >= MIN_EACH) {
      const gap = avg(afterCut) - avg(normal);
      if (gap >= 2) {
        out.push({
          id: "lighter",
          title: "Stronger after lighter weeks",
          words: `In the week after a lighter week (30% fewer sets or more), your top sets were ${r1(gap)} points closer to your estimated max than in other weeks (${afterCut.length} times). Lighter weeks seem to help your strength show.`,
          compare: {
            unit: "Top set as a % of your estimated max",
            a: { label: "After a lighter week", value: r1(avg(afterCut)), n: afterCut.length },
            b: { label: "Other weeks", value: r1(avg(normal)), n: normal.length },
          },
          tone: "good",
        });
      }
    }
  }
  void byDay;
  return out;
}
