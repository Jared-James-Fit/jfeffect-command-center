/**
 * Cleo's strategic calls, checked by code (pure, tested in
 * competition-proposals.test.ts).
 *
 * The engines (forecast.ts, competitor.ts, attempts.ts, warmups.ts) give a
 * baseline from formulas. Cleo reads the same evidence (evidence.ts) the way
 * an elite coach would and may challenge any of it: a lift's forecast, a
 * competitor's projection, an attempt, the last warm-up, the warm-up ladder,
 * the taper, the strategy, a risk. Each call is a structured proposal that
 * cites evidence by id. Code decides whether it stands:
 *
 *  - every cited id must exist, and a number must cite the kind of evidence
 *    that could justify it (training or meets for a forecast, the
 *    competitor's own record for a competitor);
 *  - a bigger move needs more evidence: more than 3% needs two items;
 *  - bounds: a lift's expected moves at most 8% from the engine (its
 *    conservative or high 10%), a competitor's 12%; scenarios stay ordered;
 *  - attempts: on the federation's increment, each at least one increment
 *    over the last, the opener no higher than the (adjusted) conservative
 *    day, the second no higher than the expected, the third no higher than
 *    the high; jumps of at most 10% then 7%;
 *  - warm-ups: rising, on the plate step, the last one 82–97% of the opener.
 *
 * What passes is applied and everything downstream is rebuilt by the same
 * engines (applyProposals): the totals, the field and placing, the attempt
 * pathways and their rules, the warm-ups. What fails is kept with its reason
 * so the coach sees what Cleo argued and why it was set aside. The coach can
 * still put any accepted call back to the engine's number before approving.
 */
import { attemptRules, climb, planAttempts, type AttemptPlan, type Triple3 } from "./attempts";
import type { Brief } from "./brief";
import type { EvidenceItem, EvidenceKind } from "./evidence";
import { buildLandscape, type Landscape } from "./landscape";
import { floorTo, roundTo } from "./rules";
import type { Lift, Range } from "./types";
import { planWarmups, type WarmupPlan } from "./warmups";

export type ProposalType =
  | "forecast"
  | "competitor"
  | "attempt"
  | "last_warmup"
  | "warmup_sets"
  | "taper"
  | "strategy"
  | "risk";

export type Proposal = {
  id: string;
  type: ProposalType;
  lift: Lift | null;
  scenario: "conservative" | "expected" | "high" | null;
  attempt: 1 | 2 | 3 | null;
  kg: number | null;
  sets: Array<{ kg: number; reps: number }> | null;
  /** a competitor's name as the brief has it */
  competitor: string | null;
  days_out: number | null;
  severity: "watch" | "concern" | "serious" | null;
  /** the call in one sentence */
  text: string;
  /** why, in a coach's words */
  reason: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
};

export type ProposalCheck = {
  proposal: Proposal;
  ok: boolean;
  reasons: string[];
  /** the engine's number the call changes, and the call's */
  before: number | null;
  after: number | null;
};

export const LIMITS = {
  forecastExpected: 0.08,
  forecastEdge: 0.1,
  competitor: 0.12,
  /** a move bigger than this needs two pieces of evidence */
  bigMove: 0.03,
  secondJump: 0.1,
  thirdJump: 0.07,
  lastWarmLow: 0.82,
  lastWarmHigh: 0.97,
  warmJump: 0.25,
} as const;

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const TYPES: ProposalType[] = [
  "forecast",
  "competitor",
  "attempt",
  "last_warmup",
  "warmup_sets",
  "taper",
  "strategy",
  "risk",
];
const NUMBER_KINDS: Partial<Record<ProposalType, EvidenceKind[]>> = {
  forecast: ["training", "meet", "conversion", "line", "pain", "recovery", "bodyweight", "program"],
  attempt: ["training", "meet", "attempt_history", "line", "conversion", "pain", "warmup", "intel"],
  last_warmup: ["warmup", "training", "meet", "attempt_history", "intel"],
  warmup_sets: ["warmup", "training", "meet", "attempt_history", "intel"],
};

const clip = (s: unknown, n: number) =>
  typeof s === "string"
    ? s
        .replace(/\s*—\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, n)
    : "";
const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : typeof x === "string" ? parseFloat(x) : NaN;
  return Number.isFinite(n) ? n : null;
};
const onStep = (kg: number, step: number) => Math.abs(kg / step - Math.round(kg / step)) < 1e-6;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

/** The model's proposals read tolerantly; anything that isn't a proposal is dropped. */
export function readProposals(raw: unknown): Proposal[] {
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const r of raw.slice(0, 16)) {
    if (!r || typeof r !== "object") continue;
    const type = TYPES.includes((r as any).type) ? ((r as any).type as ProposalType) : null;
    if (!type) continue;
    const lift = LIFTS.includes((r as any).lift) ? ((r as any).lift as Lift) : null;
    const scen = ["conservative", "expected", "high"].includes((r as any).scenario)
      ? ((r as any).scenario as Proposal["scenario"])
      : type === "forecast" || type === "competitor"
        ? "expected"
        : null;
    const att = num((r as any).attempt);
    const sets = Array.isArray((r as any).sets)
      ? (r as any).sets
          .slice(0, 12)
          .map((s: any) => ({ kg: num(s?.kg), reps: num(s?.reps) }))
          .filter((s: any) => s.kg != null && s.reps != null)
          .map((s: any) => ({ kg: s.kg as number, reps: Math.round(s.reps as number) }))
      : null;
    const sev = ["watch", "concern", "serious"].includes((r as any).severity)
      ? ((r as any).severity as Proposal["severity"])
      : null;
    out.push({
      id: `P${out.length + 1}`,
      type,
      lift,
      scenario: scen,
      attempt: att === 1 || att === 2 || att === 3 ? att : null,
      kg: num((r as any).kg),
      sets: sets && sets.length ? sets : null,
      competitor: clip((r as any).competitor, 120) || null,
      days_out: num((r as any).days_out),
      severity: sev,
      text: clip((r as any).text, 400),
      reason: clip((r as any).reason, 900),
      evidence: Array.isArray((r as any).evidence)
        ? [
            ...new Set(
              (r as any).evidence.map((e: unknown) => clip(e, 20).toUpperCase()).filter(Boolean),
            ),
          ].slice(0, 10) as string[]
        : [],
      confidence: ["high", "medium", "low"].includes((r as any).confidence)
        ? (r as any).confidence
        : "medium",
    });
  }
  return out;
}

function findCompetitor(b: Brief, name: string | null) {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return (
    b.competitors.find((c) => c.id === name || c.name.toLowerCase() === n) ??
    b.competitors.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase())) ??
    null
  );
}

/** Every proposal checked; numbers applied in order so later checks see earlier accepted ones. */
export function checkProposals(b: Brief, evidence: EvidenceItem[], ps: Proposal[]): ProposalCheck[] {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const step = b.competition.rules.incrementKg;
  const ranges = engineRanges(b);
  const out: ProposalCheck[] = [];
  // a proposal with its numbers checked against what earlier accepted ones changed
  for (const p of ps) {
    const reasons: string[] = [];
    let before: number | null = null;
    if (p.text.length < 6) reasons.push("Say the call in a sentence");
    if (p.reason.length < 12) reasons.push("Give the reasoning");
    if (!p.evidence.length) reasons.push("Cite the evidence it rests on");
    const unknown = p.evidence.filter((e) => !byId.has(e));
    if (unknown.length) reasons.push(`Cites ${unknown.join(", ")}, which isn't in the evidence`);
    const cited = p.evidence.map((e) => byId.get(e)).filter((e): e is EvidenceItem => !!e);
    const kinds = NUMBER_KINDS[p.type];
    if (kinds && cited.length && !cited.some((e) => kinds.includes(e.kind)))
      reasons.push(`A ${p.type.replace("_", " ")} call needs ${kinds.slice(0, 3).join(", ")} evidence`);

    if (p.type === "forecast") {
      const r = p.lift ? ranges[p.lift] : null;
      if (!p.lift || !r) reasons.push("Name a lift the engine has a forecast for");
      else if (p.kg == null) reasons.push("Give the number");
      else {
        const sc = p.scenario ?? "expected";
        before = r[sc];
        const move = Math.abs(p.kg - before) / before;
        const limit = sc === "expected" ? LIMITS.forecastExpected : LIMITS.forecastEdge;
        if (!onStep(p.kg, step)) reasons.push(`Use a multiple of ${step} kg`);
        if (move > limit)
          reasons.push(`${pct(move)} from the engine: the most a call can move it is ${pct(limit)}`);
        if (move > LIMITS.bigMove && cited.length < 2)
          reasons.push("A move this size needs at least two pieces of evidence");
        if (!cited.some((e) => !e.lift || e.lift === p.lift))
          reasons.push(`Cite evidence about the ${p.lift}`);
        const next = { ...r, [sc]: p.kg };
        if (!(next.conservative <= next.expected && next.expected <= next.high))
          reasons.push("Conservative, expected and high have to stay in order");
        if (!reasons.length) ranges[p.lift!] = next;
      }
    } else if (p.type === "competitor") {
      const c = findCompetitor(b, p.competitor);
      const proj = c?.read.projection ?? null;
      if (!c) reasons.push("Name a competitor in the brief");
      else if (!proj) reasons.push(`${c.name} has no projection to change`);
      else if (p.kg == null) reasons.push("Give their total");
      else {
        const sc = p.scenario ?? "expected";
        before = proj[sc];
        const move = Math.abs(p.kg - before) / before;
        if (!onStep(p.kg, step)) reasons.push(`Use a multiple of ${step} kg`);
        if (move > LIMITS.competitor)
          reasons.push(`${pct(move)} from the engine: the most a call can move it is ${pct(LIMITS.competitor)}`);
        const own = cited.filter((e) => e.competitorId === c.id);
        if (!own.length) reasons.push(`Cite ${c.name}'s own record`);
        if (move > LIMITS.bigMove && !own.some((e) => e.kind !== "competitor_read"))
          reasons.push(`A move this size needs ${c.name}'s meets or training, not only the engine's read`);
      }
    } else if (p.type === "attempt") {
      if (!p.lift || !ranges[p.lift]) reasons.push("Name a lift with a forecast");
      if (!p.attempt) reasons.push("Say which attempt (1, 2 or 3)");
      if (p.kg == null) reasons.push("Give the weight");
      else if (!onStep(p.kg, step)) reasons.push(`Attempts are multiples of ${step} kg`);
    } else if (p.type === "last_warmup") {
      if (!p.lift || !ranges[p.lift]) reasons.push("Name a lift with a forecast");
      if (p.kg == null) reasons.push("Give the weight");
      else if (!onStep(p.kg, 2.5)) reasons.push("Use a multiple of 2.5 kg");
    } else if (p.type === "warmup_sets") {
      if (!p.lift || !ranges[p.lift]) reasons.push("Name a lift with a forecast");
      const sets = p.sets ?? [];
      if (sets.length < 3 || sets.length > 9) reasons.push("A ladder of 3 to 9 sets");
      if (sets.some((s) => !onStep(s.kg, 2.5) || s.kg < 20)) reasons.push("Sets in 2.5 kg steps from the bar");
      if (sets.some((s) => s.reps < 1 || s.reps > 10)) reasons.push("1 to 10 reps a set");
      if (sets.some((s, i) => i > 0 && s.kg <= sets[i - 1].kg)) reasons.push("Every set heavier than the last");
    } else if (p.type === "taper") {
      if (p.days_out != null && (p.days_out < 1 || p.days_out > 35 || !Number.isInteger(p.days_out)))
        reasons.push("Days out: a whole number from 1 to 35");
    } else if (p.type === "risk") {
      if (!p.severity) reasons.push("Say how serious: watch, concern or serious");
    }
    out.push({ proposal: p, ok: !reasons.length, reasons, before, after: p.kg });
  }

  // attempts and warm-ups against the plan the accepted forecast calls give
  const attemptChecks = out.filter(
    (c) => c.ok && (c.proposal.type === "attempt" || c.proposal.type === "last_warmup" || c.proposal.type === "warmup_sets"),
  );
  if (attemptChecks.length) {
    const accepted = out.filter((c) => c.ok && c.proposal.type === "forecast").map((c) => c.proposal);
    const lifts = applyForecast(engineRanges(b), accepted);
    const base = planAttempts({
      lifts,
      rules: b.competition.rules,
      history: b.inputs.history,
      objective: b.competition.objective,
      recentTopSingles: b.inputs.topSingles,
    });
    for (const lift of LIFTS) {
      const r = lifts[lift];
      const a = base.lifts[lift];
      if (!r || !a) continue;
      const mine = attemptChecks.filter((c) => c.proposal.lift === lift && c.proposal.type === "attempt");
      const plan: Triple3 = [...a.pathways.balanced] as Triple3;
      for (const c of mine) {
        const i = c.proposal.attempt! - 1;
        c.before = plan[i];
        plan[i] = c.proposal.kg!;
      }
      const bad = (c: ProposalCheck, why: string) => {
        c.ok = false;
        c.reasons.push(why);
      };
      for (const c of mine) {
        const i = c.proposal.attempt! - 1;
        const kg = c.proposal.kg!;
        if (i === 0 && kg > r.conservative)
          bad(c, `An opener over the conservative day (${r.conservative} kg) risks the total`);
        if (i === 1 && kg > r.expected) bad(c, `A second over the expected max (${r.expected} kg)`);
        if (i === 2 && kg > r.high) bad(c, `A third over the high scenario (${r.high} kg)`);
        if (i > 0 && kg < plan[i - 1] + step)
          bad(c, `Has to be at least ${step} kg over attempt ${i} (${plan[i - 1]} kg)`);
        if (i < 2 && plan[i + 1] < kg + step)
          bad(c, `Leaves no room for attempt ${i + 2} (${plan[i + 1]} kg)`);
        if (i === 1 && (kg - plan[0]) / plan[0] > LIMITS.secondJump)
          bad(c, `A ${pct((kg - plan[0]) / plan[0])} jump from the opener: at most ${pct(LIMITS.secondJump)}`);
        if (i === 2 && (kg - plan[1]) / plan[1] > LIMITS.thirdJump)
          bad(c, `A ${pct((kg - plan[1]) / plan[1])} jump to the third: at most ${pct(LIMITS.thirdJump)}`);
      }
      // the opener the warm-ups lead to: Cleo's when it stood
      const opener = mine.find((c) => c.ok && c.proposal.attempt === 1)?.proposal.kg ?? a.opener;
      for (const c of attemptChecks.filter(
        (x) => x.proposal.lift === lift && x.proposal.type !== "attempt",
      )) {
        const last =
          c.proposal.type === "last_warmup"
            ? c.proposal.kg!
            : c.proposal.sets![c.proposal.sets!.length - 1].kg;
        c.before = planWarmups({ lift, openerKg: opener, history: b.inputs.warmups[lift] ?? null, step }).last.kg;
        if (last >= opener) bad(c, `The last warm-up has to be under the opener (${opener} kg)`);
        else if (last / opener < LIMITS.lastWarmLow || last / opener > LIMITS.lastWarmHigh)
          bad(
            c,
            `Last warm-up at ${pct(last / opener)} of the opener: keep it between ${pct(LIMITS.lastWarmLow)} and ${pct(LIMITS.lastWarmHigh)}`,
          );
        if (c.proposal.type === "warmup_sets") {
          const sets = c.proposal.sets!;
          if (sets.some((s, i) => i > 0 && (s.kg - sets[i - 1].kg) / opener > LIMITS.warmJump))
            bad(c, `A jump of more than ${pct(LIMITS.warmJump)} of the opener between warm-ups`);
        }
      }
    }
  }
  // a call that lands on the engine's own number changes nothing: that's an "agree"
  // in the review, never a call the coach has to keep or put back
  for (const c of out) {
    const numeric = c.proposal.type !== "warmup_sets" && c.proposal.kg != null;
    if (c.ok && numeric && c.before != null && c.proposal.kg === c.before) {
      c.ok = false;
      c.reasons.push(`Same as the engine's ${c.before} kg: nothing to change`);
    }
  }
  return out;
}

function engineRanges(b: Brief): Record<Lift, Range | null> {
  return Object.fromEntries(
    LIFTS.map((l) => [l, b.forecast.lifts[l] ? { ...b.forecast.lifts[l]!.range } : null]),
  ) as Record<Lift, Range | null>;
}

function applyForecast(ranges: Record<Lift, Range | null>, ps: Proposal[]) {
  const out = Object.fromEntries(
    LIFTS.map((l) => [l, ranges[l] ? { ...ranges[l]! } : null]),
  ) as Record<Lift, Range | null>;
  for (const p of ps) {
    if (p.type !== "forecast" || !p.lift || !out[p.lift] || p.kg == null) continue;
    out[p.lift]![p.scenario ?? "expected"] = p.kg;
  }
  return out;
}

export type PlanChange = {
  proposalId: string;
  area: "forecast" | "competitor" | "attempt" | "warmup";
  label: string;
  before: string;
  after: string;
};

export type AdjustedPlan = {
  lifts: Record<Lift, Range | null>;
  total: Range | null;
  landscape: Landscape;
  attempts: AttemptPlan;
  warmups: Record<Lift, WarmupPlan | null>;
  /** competitors whose projection a call changed */
  competitors: Array<{ id: string; name: string; range: Range }>;
  changes: PlanChange[];
};

/** The plan rebuilt by the engines with the accepted calls in it. */
export function applyProposals(b: Brief, accepted: Proposal[]): AdjustedPlan {
  const step = b.competition.rules.incrementKg;
  const changes: PlanChange[] = [];
  const engine = engineRanges(b);
  const lifts = applyForecast(engine, accepted);
  for (const p of accepted)
    if (p.type === "forecast" && p.lift && engine[p.lift] && p.kg != null)
      changes.push({
        proposalId: p.id,
        area: "forecast",
        label: `${cap(p.lift)} ${p.scenario ?? "expected"}`,
        before: `${engine[p.lift]![p.scenario ?? "expected"]} kg`,
        after: `${p.kg} kg`,
      });
  const total = LIFTS.every((l) => lifts[l])
    ? {
        conservative: LIFTS.reduce((s, l) => s + lifts[l]!.conservative, 0),
        expected: LIFTS.reduce((s, l) => s + lifts[l]!.expected, 0),
        high: LIFTS.reduce((s, l) => s + lifts[l]!.high, 0),
      }
    : b.forecast.total;

  // competitors
  const adjustedCompetitors: AdjustedPlan["competitors"] = [];
  const competitors = b.competitors.map((c) => {
    const calls = accepted.filter((p) => p.type === "competitor" && findCompetitor(b, p.competitor)?.id === c.id);
    if (!calls.length || !c.read.projection) return c;
    const proj = { ...c.read.projection };
    for (const p of calls) {
      const sc = p.scenario ?? "expected";
      const before = proj[sc];
      if (sc === "expected") {
        const d = p.kg! - proj.expected;
        proj.expected = p.kg!;
        proj.conservative = Math.min(proj.conservative + d, proj.expected);
        proj.high = Math.max(proj.high + d, proj.expected);
      } else if (sc === "high") proj.high = Math.max(p.kg!, proj.expected);
      else proj.conservative = Math.min(p.kg!, proj.expected);
      changes.push({
        proposalId: p.id,
        area: "competitor",
        label: `${c.name} ${sc}`,
        before: `${before} kg`,
        after: `${p.kg} kg`,
      });
    }
    const ratio = c.read.projection.expected ? proj.expected / c.read.projection.expected : 1;
    proj.lifts = Object.fromEntries(
      LIFTS.map((l) => {
        const r = c.read.projection!.lifts[l];
        return [
          l,
          r
            ? {
                conservative: roundTo(r.conservative * ratio, step),
                expected: roundTo(r.expected * ratio, step),
                high: roundTo(r.high * ratio, step),
              }
            : null,
        ];
      }),
    ) as Record<Lift, Range | null>;
    adjustedCompetitors.push({
      id: c.id,
      name: c.name,
      range: { conservative: proj.conservative, expected: proj.expected, high: proj.high },
    });
    return { ...c, read: { ...c.read, projection: proj } };
  });
  const landscape = buildLandscape({
    athlete: {
      total,
      lifts,
      bestMeetTotal: b.forecast.bestMeetTotal?.kg ?? null,
      confidence: b.forecast.confidence,
    },
    competitors,
    objective: b.competition.objective,
    qualificationTotal: b.competition.qualificationTotal,
    targetPlace: b.competition.targetPlace,
    increment: step,
  });

  // attempts: the engine's plan from the adjusted forecast, then Cleo's attempts in it
  const attempts = planAttempts({
    lifts,
    rules: b.competition.rules,
    history: b.inputs.history,
    objective: b.competition.objective,
    recentTopSingles: b.inputs.topSingles,
  });
  const baseAttempts = b.attempts;
  for (const lift of LIFTS) {
    const a = attempts.lifts[lift];
    if (!a) continue;
    const calls = accepted.filter((p) => p.type === "attempt" && p.lift === lift && p.attempt && p.kg != null);
    const engineBalanced = baseAttempts.lifts[lift]?.pathways.balanced ?? a.pathways.balanced;
    if (calls.length) {
      const bal = [...a.pathways.balanced] as number[];
      for (const p of calls) bal[p.attempt! - 1] = p.kg!;
      const balanced = climb(bal, step);
      const opener = balanced[0];
      const conservative = climb(
        [opener, Math.min(a.pathways.conservative[1], balanced[1]), Math.min(a.pathways.conservative[2], balanced[2])],
        step,
      );
      const aggressive = climb(
        [opener, Math.max(a.pathways.aggressive[1], balanced[1]), Math.max(a.pathways.aggressive[2], balanced[2])],
        step,
      );
      const r = lifts[lift]!;
      const openerConservative = Math.max(
        step,
        floorTo(opener - Math.max(step, r.expected * 0.02), step),
      );
      const rules = attemptRules({
        pathways: { conservative, balanced, aggressive },
        opener,
        openerConservative,
        noLower: b.competition.rules.noLowerAfterAttempt,
      });
      attempts.lifts[lift] = {
        ...a,
        opener,
        openerConservative,
        second: { low: conservative[1], high: aggressive[1] },
        third: { low: conservative[2], high: aggressive[2] },
        pathways: { conservative, balanced, aggressive },
        conditional: rules.conditional,
        contingencies: rules.contingencies,
        why: [`Cleo's attempts (${calls.map((p) => `${ordinalAttempt(p.attempt!)} ${p.kg} kg`).join(", ")})`, ...a.why],
      };
    }
    const now = attempts.lifts[lift]!.pathways.balanced;
    now.forEach((kg, i) => {
      if (kg !== engineBalanced[i])
        changes.push({
          proposalId: calls.find((p) => p.attempt === i + 1)?.id ?? "forecast",
          area: "attempt",
          label: `${cap(lift)} ${ordinalAttempt(i + 1)}`,
          before: `${engineBalanced[i]} kg`,
          after: `${kg} kg`,
        });
    });
  }
  const sum = (k: "conservative" | "balanced" | "aggressive") =>
    LIFTS.every((l) => attempts.lifts[l])
      ? LIFTS.reduce((s, l) => s + attempts.lifts[l]!.pathways[k][2], 0)
      : null;
  attempts.totals = { conservative: sum("conservative"), balanced: sum("balanced"), aggressive: sum("aggressive") };

  // warm-ups to the (possibly new) opener, with Cleo's last warm-up or ladder
  const warmups = Object.fromEntries(
    LIFTS.map((lift) => {
      const a = attempts.lifts[lift];
      if (!a) return [lift, null];
      const ladder = accepted.find((p) => p.type === "warmup_sets" && p.lift === lift);
      const last = accepted.find((p) => p.type === "last_warmup" && p.lift === lift);
      const w = planWarmups({
        lift,
        openerKg: a.opener,
        history: b.inputs.warmups[lift] ?? null,
        step,
        override: ladder ? { sets: ladder.sets } : last ? { lastKg: last.kg } : null,
      });
      const engineLast = b.warmups[lift]?.last.kg ?? null;
      if (engineLast != null && w.last.kg !== engineLast)
        changes.push({
          proposalId: (ladder ?? last)?.id ?? "attempt",
          area: "warmup",
          label: `${cap(lift)} last warm-up`,
          before: `${engineLast} kg`,
          after: `${w.last.kg} kg`,
        });
      return [lift, w];
    }),
  ) as Record<Lift, WarmupPlan | null>;
  return { lifts, total, landscape, attempts, warmups, competitors: adjustedCompetitors, changes };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const ordinalAttempt = (i: number) => (i === 1 ? "opener" : i === 2 ? "second" : "third");

/** The calls a coach sees: what stood, what didn't, and the plan with the ones they kept. */
export function strategyOf(b: Brief, evidence: EvidenceItem[], ps: Proposal[], declined: string[] = []) {
  const checks = checkProposals(b, evidence, ps);
  const accepted = checks.filter((c) => c.ok && !declined.includes(c.proposal.id)).map((c) => c.proposal);
  return { checks, adjusted: applyProposals(b, accepted) };
}

/** The plan an assessment ended up with: the engines' baseline with the calls the coach kept. */
export function confirmedPlan(internal: any): Pick<Brief, "forecast" | "attempts"> | null {
  const e = internal?.engine as Brief | undefined;
  if (!e?.forecast) return null;
  const adj = internal?.strategy?.adjusted as AdjustedPlan | undefined;
  if (!adj) return { forecast: e.forecast, attempts: e.attempts };
  return {
    forecast: {
      ...e.forecast,
      lifts: Object.fromEntries(
        LIFTS.map((l) => [
          l,
          e.forecast.lifts[l]
            ? { ...e.forecast.lifts[l]!, range: adj.lifts[l] ?? e.forecast.lifts[l]!.range }
            : null,
        ]),
      ) as Brief["forecast"]["lifts"],
      total: adj.total ?? e.forecast.total,
    },
    attempts: adj.attempts ?? e.attempts,
  };
}
