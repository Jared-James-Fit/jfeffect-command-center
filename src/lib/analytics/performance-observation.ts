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
 *  - Plain words: "strength", "sets", "effort (RPE)", never "volume" or
 *    "e1RM"; and it says whether it's counted from the logs (measured) or
 *    worked out from them (an estimate).
 *  - Goal-aware: a muscle is never weak, undertrained or overtrained for
 *    having fewer or more sets than another; a change in a muscle's sets is
 *    said as a change, read against what the athlete's goal asks of it.
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
  /** counted straight from the logs, or worked out from them (an estimated max, a pattern) */
  basis: "measured" | "estimated";
};

/** A muscle's sets in the last six weeks against the six before (muscle-read.ts `muscleWindowChanges`). */
export type MuscleChange = {
  muscle: string;
  role: "prime" | "support" | "optional";
  total: number;
  before: number;
  changePct: number;
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
  /** what the athlete trains for (analytics-profile.ts): decides which kind of finding leads */
  profile?: "powerlifting" | "physique" | "general";
  /** each muscle's sets in the last six weeks against the six before */
  muscles?: MuscleChange[];
  /** the training-load read's top insight for the athlete (training-load.ts), so Cleo and the coach's analytics agree */
  insight?: {
    id: string;
    observation: string;
    action: string;
    evidence: string[];
    tone: "good" | "info" | "watch";
    athlete?: { observation: string; action: string };
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
      observation: drift.words.replace(/ Often tiredness.*$| A sign your body.*$/, ""),
      tip: harder
        ? light
          ? "You're in a lighter phase, which usually brings effort back down. See how the next workouts feel."
          : i.coached
            ? "Keep to the plan, note how the next workouts feel, and mention it at your check-in if it carries on."
            : "Watch the next couple of workouts. If it keeps climbing, a lighter week or more sleep usually helps."
        : "Your body is adapting to the training. Keep going the way you are.",
      evidence: [
        { label: "Compared", value: "the same weights and reps, last 3 weeks against the 3 before" },
      ],
      tone: harder ? "watch" : "good",
      basis: "measured",
      score: harder ? 90 : 55,
    });
  }

  // 2 · workload rising while effort holds: well tolerated
  for (const s of i.setShifts) {
    const r = i.rpeShifts.find((x) => x.lift === s.lift);
    if (s.pct != null && s.pct >= 15 && r && Math.abs(r.to - r.from) < 0.5) {
      cands.push({
        id: `tolerated:${s.lift}`,
        observation: `You're doing ${s.pct}% more ${lift(s.lift)} sets than three weeks ago, and they feel just as hard (RPE about ${r.to} out of 10).`,
        tip: i.coached
          ? "You're handling the extra work well. Keep following the plan and notice how you recover as it builds."
          : "You're handling the extra work well. Keep an eye on how workouts and recovery feel as it builds.",
        evidence: [
          { label: `${COMP_LIFT_LABEL[s.lift]} sets a week`, value: `${s.from} → ${s.to}` },
          { label: "Effort (RPE, out of 10)", value: `${r.from} → ${r.to}` },
        ],
        tone: "good",
        basis: "measured",
        score: 70,
      });
    }
    if (s.pct != null && s.pct <= -25 && light) {
      cands.push({
        id: `light:${s.lift}`,
        observation: `You're doing ${Math.abs(s.pct)}% fewer ${lift(s.lift)} sets, which matches the lighter phase you're in.`,
        tip: "Doing less here is planned. Strength often looks flat during a lighter phase and shows up after it.",
        evidence: [
          { label: `${COMP_LIFT_LABEL[s.lift]} sets a week`, value: `${s.from} → ${s.to}` },
        ],
        tone: "info",
        basis: "measured",
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
        observation: `Your ${lift(i.mainLift)} strength is up ${t.pct}% over the last six weeks (estimated max ${fmt(t.from.value)} → ${fmt(t.to.value)}).`,
        tip: i.coached
          ? "You're on track. Keep doing what's in your program."
          : "What you're doing is working. Keep adding weight gradually.",
        evidence: [
          { label: "Estimated max", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
          { label: "Worked out from", value: "your hard sets (easier sets count as a minimum)" },
        ],
        tone: "good",
        basis: "estimated",
        score: 65 + Math.min(10, t.pct),
      });
    } else if (t && t.kind === "down" && !light) {
      cands.push({
        id: "strength-down",
        observation: `Your ${lift(i.mainLift)} strength has come down ${Math.abs(t.pct)}% over the last six weeks (estimated max ${fmt(t.from.value)} → ${fmt(t.to.value)}).`,
        tip: i.coached
          ? "Worth raising at your check-in, along with how your sleep and recovery have been."
          : "Before changing your program, look at your sleep, recovery and whether the weights went up too fast.",
        evidence: [
          { label: "Estimated max", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
        ],
        tone: "watch",
        basis: "estimated",
        score: 80,
      });
    } else if (t && t.kind === "steady") {
      cands.push({
        id: "strength-steady",
        observation: `Your ${lift(i.mainLift)} strength has held steady for six weeks (estimated max about ${fmt(t.to.value)}).`,
        tip: light
          ? "Holding steady is the goal in a lighter phase."
          : i.coached
            ? "Steady is normal in the middle of a block. Your coach reads this alongside your plan."
            : "Steady is normal in the middle of a block. If it lasts another block, try changing one thing, like reps or sets.",
        evidence: [
          { label: "Estimated max", value: `${fmt(t.from.value)} → ${fmt(t.to.value)}` },
        ],
        tone: "info",
        basis: "estimated",
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
      tip: "This is what steady work looks like. Nothing to change.",
      evidence: i.recentRecords
        .slice(0, 3)
        .map((x) => ({ label: x.exercise, value: `${fmt(x.load)} × ${x.reps}` })),
      tone: "good",
      basis: "measured",
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
      basis: "measured",
      score: 75,
    });
  }

  // 6 · the other recovery patterns
  for (const p of i.patterns) {
    if (p.id === "drift") continue;
    cands.push({
      id: `pattern:${p.id}`,
      observation: p.words.replace(
        / A pattern in your logs, not proof\.| That's normal after hard work.*$/,
        "",
      ),
      tip:
        p.id === "sleep"
          ? "Sleep is the cheapest way to train better. Protect it before your heavy days."
          : p.id === "demanding"
            ? i.coached
              ? "That's expected. Keep the day after your biggest workouts as written."
              : "That's expected after hard work. Keep the day after your biggest workouts lighter."
            : "Your lighter weeks are doing their job.",
      evidence: p.compare
        ? [
            { label: p.compare.a.label, value: `${p.compare.a.value} ${p.compare.unit}` },
            { label: p.compare.b.label, value: `${p.compare.b.value} ${p.compare.unit}` },
          ]
        : [],
      tone: p.tone,
      basis: "estimated",
      score: 50,
    });
  }

  // 7 · the training-load read's own finding, in its words
  if (i.insight) {
    cands.push({
      id: `load:${i.insight.id}`,
      observation: i.insight.athlete?.observation ?? i.insight.observation,
      tip: i.coached
        ? `${i.insight.athlete?.action ?? i.insight.action} Mention it at your check-in so your coach can plan around it.`
        : (i.insight.athlete?.action ?? i.insight.action),
      evidence: i.insight.evidence.slice(0, 3).map((e) => ({ label: "", value: e })),
      tone: i.insight.tone,
      basis: "measured",
      score: i.insight.tone === "watch" ? 72 : 52,
    });
  }

  // 8 · a big change in where the sets go, said as a change, never as weak or overdone
  const muscleMove = (i.muscles ?? [])
    .filter((m) => m.role !== "optional" && m.before >= 6 && Math.abs(m.changePct) >= 30)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
  if (muscleMove) {
    const more = muscleMove.changePct > 0;
    const name = muscleMove.muscle.toLowerCase();
    const main = muscleMove.role === "prime";
    cands.push({
      id: `muscle:${muscleMove.muscle}`,
      observation: more
        ? `You've trained your ${name} more in the last six weeks: ${Math.round(muscleMove.total)} sets, up ${muscleMove.changePct}% from the six weeks before.`
        : `Your ${name} got ${Math.abs(muscleMove.changePct)}% fewer sets in the last six weeks than the six before (${Math.round(muscleMove.before)} → ${Math.round(muscleMove.total)}).`,
      tip: more
        ? main
          ? `That suits your goal, which leans on your ${name}. Notice how it recovers between workouts.`
          : "Fine if it's on purpose. Notice how it recovers between workouts."
        : light
          ? "That fits the lighter phase you're in."
          : i.coached
            ? "Often planned between blocks. Ask your coach if you're not sure why."
            : main
              ? `If that wasn't on purpose, a couple more sets a week would bring your ${name} back to where it was.`
              : "Fewer sets doesn't make a muscle weak. Fine if it's on purpose.",
      evidence: [
        { label: `${muscleMove.muscle} sets`, value: `${Math.round(muscleMove.before)} → ${Math.round(muscleMove.total)}` },
        { label: "Compared", value: "the last six weeks against the six before" },
      ],
      tone: "info",
      basis: "measured",
      score: (i.profile === "physique" ? 62 : 44) + (main ? 4 : 0),
    });
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  const { score: _s, ...best } = cands[0];
  return best;
}
