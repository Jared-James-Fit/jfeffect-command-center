/**
 * Cleo's one observation on the analytics page: what is happening and what
 * might help (pure, tested in analytics-redesign.test.ts). Worked out in code
 * from the same reads every chart draws, never by a model, so it's free,
 * instant and can't contradict the numbers beside it.
 *
 * Rules:
 *  - One observation, the most useful one, or none at all: nothing is said
 *    to fill space.
 *  - Specific: names the lift, the change and what it's measured against.
 *  - Phase-aware: a lower workload in a deload, taper or peak is the plan
 *    working, never a regression.
 *  - Supports the coach: a coached athlete's tip never changes prescribed
 *    training; at most it's something to mention at their check-in.
 *  - A pattern is said as a pattern, never a cause.
 */
import type { CompLift } from "@/lib/analytics/competition-strength";
import { COMP_LIFT_LABEL } from "@/lib/analytics/competition-strength";
import type { EnvelopeTrend } from "@/lib/analytics/strength-estimate";
import type { LiftShift } from "@/lib/analytics/sbd-workload";
import type { RecoveryPattern } from "@/lib/analytics/recovery-intel";

export type Observation = {
  id: string;
  observation: string;
  tip: string;
  evidence: Array<{ label: string; value: string }>;
  tone: "good" | "watch" | "info";
};

export type ObservationInput = {
  coached: boolean;
  /** the current block's type key (block-types.ts) or a week phase word, lowercased */
  phase: string | null;
  unit: "lb" | "kg";
  conv: (lb: number) => number;
  /** each competition lift's estimated-strength trend over the last 6 weeks */
  liftTrends: Partial<Record<CompLift, EnvelopeTrend>>;
  /** sets per week by lift, the last 3 full weeks against the 3 before */
  setShifts: LiftShift[];
  /** average RPE by lift, the same two windows */
  rpeShifts: LiftShift[];
  patterns: RecoveryPattern[];
  /** records in the last 14 days, headline ones first */
  recentRecords: Array<{ exercise: string; load: number; reps: number; day: string }>;
  consistency: { recentPct: number | null; beforePct: number | null; planned: number };
  /** the main lift the athlete trains most */
  mainLift: CompLift | null;
  /** the training-load read's top insight for the athlete (training-load.ts), so Cleo and the coach's analytics agree */
  insight?: {
    id: string;
    observation: string;
    action: string;
    evidence: string[];
    tone: "good" | "info" | "watch";
  } | null;
};

const LIGHT_PHASES = /deload|taper|peak|recovery|transition|rehab/;

function lift(l: CompLift) {
  return COMP_LIFT_LABEL[l].toLowerCase();
}

export function pickObservation(i: ObservationInput): Observation | null {
  const light = !!i.phase && LIGHT_PHASES.test(i.phase);
  const fmt = (lb: number) => `${Math.round(i.conv(lb))} ${i.unit}`;
  const cands: Array<Observation & { score: number }> = [];

  // 1 · effort drift at the same loads (the earliest honest sign of fatigue)
  const drift = i.patterns.find((p) => p.id === "drift");
  if (drift) {
    const harder = drift.tone === "watch";
    cands.push({
      id: "drift",
      observation: drift.words.replace(/ Often fatigue.*$| A sign the work.*$/, ""),
      tip: harder
        ? light
          ? "This is a lighter phase, which usually brings effort back down. Keep an eye on how the next sessions feel."
          : i.coached
            ? "Keep to the plan, note how the next sessions feel, and mention it at your check-in if it continues."
            : "Watch the next couple of sessions. If it keeps climbing, a lighter week or more sleep is the usual fix."
        : "The work is being absorbed. Keep progressing the way you are.",
      evidence: [
        { label: "Compared", value: "same weights and reps, last 3 weeks vs the 3 before" },
      ],
      tone: harder ? "watch" : "good",
      score: harder ? 90 : 55,
    });
  }

  // 2 · workload rising while effort holds: well tolerated
  for (const s of i.setShifts) {
    const r = i.rpeShifts.find((x) => x.lift === s.lift);
    if (s.pct != null && s.pct >= 15 && r && Math.abs(r.to - r.from) < 0.5) {
      cands.push({
        id: `tolerated:${s.lift}`,
        observation: `Your ${lift(s.lift)} volume is up ${s.pct}% over the last three weeks while average RPE has stayed around ${r.to}.`,
        tip: i.coached
          ? "The workload looks well tolerated. Keep following the plan and watch performance and recovery as the block builds."
          : "The extra work looks well tolerated. Keep monitoring how sessions and recovery feel as it builds.",
        evidence: [
          { label: `${COMP_LIFT_LABEL[s.lift]} sets a week`, value: `${s.from} → ${s.to}` },
          { label: "Average RPE", value: `${r.from} → ${r.to}` },
        ],
        tone: "good",
        score: 70,
      });
    }
    if (s.pct != null && s.pct <= -25 && light) {
      cands.push({
        id: `light:${s.lift}`,
        observation: `Your ${lift(s.lift)} volume is down ${Math.abs(s.pct)}%, which matches the lighter phase you're in.`,
        tip: "Lower workload here is planned. Strength often looks flat during it and shows up after.",
        evidence: [
          { label: `${COMP_LIFT_LABEL[s.lift]} sets a week`, value: `${s.from} → ${s.to}` },
        ],
        tone: "info",
        score: 60,
      });
    }
  }

  // 3 · the main lift's estimated strength
  if (i.mainLift) {
    const t = i.liftTrends[i.mainLift];
    if (t && t.kind === "up" && t.pct >= 2) {
      cands.push({
        id: "strength-up",
        observation: `Your ${lift(i.mainLift)} estimate is up ${t.pct}% over the last six weeks, from ${fmt(t.from.value)} to ${fmt(t.to.value)}.`,
        tip: i.coached
          ? "Progress is on track. Keep doing what's written."
          : "What you're doing is working. Keep progressing gradually.",
        evidence: [
          { label: "Estimated strength", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
          { label: "Read from", value: "hard sets, with lighter sets as lower bounds" },
        ],
        tone: "good",
        score: 65 + Math.min(10, t.pct),
      });
    } else if (t && t.kind === "down" && !light) {
      cands.push({
        id: "strength-down",
        observation: `Your ${lift(i.mainLift)} estimate has come down ${Math.abs(t.pct)}% over six weeks of hard sets.`,
        tip: i.coached
          ? "Worth raising at your check-in, along with how sleep and recovery have been."
          : "Before changing the program, check sleep, recovery and whether loads have been creeping too fast.",
        evidence: [
          { label: "Estimated strength", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
        ],
        tone: "watch",
        score: 80,
      });
    } else if (t && t.kind === "steady") {
      cands.push({
        id: "strength-steady",
        observation: `Your ${lift(i.mainLift)} estimate has held around ${fmt(t.to.value)} for six weeks.`,
        tip: light
          ? "Holding steady is the goal in a lighter phase."
          : i.coached
            ? "Steady is normal mid-block. Your coach reads these alongside the plan."
            : "Steady is normal mid-block. If it lasts another block, it's worth changing a variable.",
        evidence: [
          { label: "Estimated strength", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
        ],
        tone: "info",
        score: 35,
      });
    }
  }

  // 4 · records
  if (i.recentRecords.length) {
    const r = i.recentRecords[0];
    cands.push({
      id: "records",
      observation:
        i.recentRecords.length === 1
          ? `New record on ${r.exercise}: ${fmt(r.load)} × ${r.reps}.`
          : `${i.recentRecords.length} new records in the last two weeks, led by ${r.exercise} at ${fmt(r.load)} × ${r.reps}.`,
      tip: "Records like these are what consistent work looks like. Nothing to change.",
      evidence: i.recentRecords
        .slice(0, 3)
        .map((x) => ({ label: x.exercise, value: `${fmt(x.load)} × ${x.reps}` })),
      tone: "good",
      score: 58 + i.recentRecords.length * 2,
    });
  }

  // 5 · consistency
  const c = i.consistency;
  if (
    c.planned >= 6 &&
    c.recentPct != null &&
    c.beforePct != null &&
    c.recentPct <= c.beforePct - 20
  ) {
    cands.push({
      id: "consistency",
      observation: `You've done ${c.recentPct}% of planned workouts in the last four weeks, down from ${c.beforePct}% the four before.`,
      tip: i.coached
        ? "If your schedule has changed, tell your coach so the plan can fit it."
        : "If your week has changed, fewer training days you can keep beats more you can't.",
      evidence: [{ label: "Planned workouts done", value: `${c.beforePct}% → ${c.recentPct}%` }],
      tone: "watch",
      score: 75,
    });
  }

  // 6 · the other recovery patterns
  for (const p of i.patterns) {
    if (p.id === "drift") continue;
    cands.push({
      id: `pattern:${p.id}`,
      observation: p.words.replace(
        / A pattern in your logs, not proof\.| Normal after hard work;.*$/,
        "",
      ),
      tip:
        p.id === "sleep"
          ? "Sleep is the cheapest performance tool you have. Protect it before your heavy days."
          : p.id === "demanding"
            ? i.coached
              ? "That's expected. Keep the day after your big sessions as written."
              : "Expected after hard work. Keep the day after your biggest sessions lighter."
            : "Lighter weeks are doing their job.",
      evidence: p.compare
        ? [
            { label: p.compare.a.label, value: `${p.compare.a.value} ${p.compare.unit}` },
            { label: p.compare.b.label, value: `${p.compare.b.value} ${p.compare.unit}` },
          ]
        : [],
      tone: p.tone,
      score: 50,
    });
  }

  // 7 · the training-load read's own finding, in its words
  if (i.insight) {
    cands.push({
      id: `load:${i.insight.id}`,
      observation: i.insight.observation,
      tip: i.coached
        ? `${i.insight.action} Your coach plans around this; mention it at your check-in.`
        : i.insight.action,
      evidence: i.insight.evidence.slice(0, 3).map((e) => ({ label: "", value: e })),
      tone: i.insight.tone,
      score: i.insight.tone === "watch" ? 72 : 52,
    });
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const { score: _s, ...best } = cands[0];
  return best;
}
