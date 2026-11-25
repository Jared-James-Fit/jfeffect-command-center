/**
 * Cleo's strategic assessment (server only).
 *
 * The engines (brief.ts) give a baseline from formulas: the forecast, the
 * field, attempts, warm-ups. Cleo reads the same evidence, numbered
 * (evidence.ts), as an elite powerlifting coach would and decides whether
 * each baseline holds for this athlete. Where the evidence justifies a
 * different number or a specific action, it says so as a structured proposal
 * citing evidence ids; code checks every one (proposals.ts) and the engines
 * rebuild the plan from the ones that stand. Then the read: what matters
 * most, what's wrong, what to challenge, what to do, and the athlete's
 * version. In the background on the OpenAI key's strongest models (route
 * `competition`, high effort, staged calls, never Lovable credits).
 *
 * Numbers in the written read must come from the brief, the evidence or the
 * rebuilt plan (grounding.ts; small gaps and jumps under 50 kg are fine), and
 * the athlete's words carry no weights at all (the app attaches the plan). A
 * proposal that fails its checks or a number that isn't grounded sends the
 * answer back once with what was wrong; a second miss sets the failing
 * proposals aside (kept, with why) and fails the attempt only if the words
 * still lean on numbers that don't exist. Provider failures (no credits, a
 * refused key, an outage) never use an attempt: the milestone waits for AI.
 */
import type { CallState } from "@/lib/ai/staged-call.server";
import type { Brief } from "./brief";
import { MILESTONE_BY_KIND } from "./milestones";
import { bannedPhrases, numbersIn, ungroundedNumbers } from "./grounding";
import { LIFT_LABEL, OBJECTIVE_LABEL, type Lift, type MilestoneKind } from "./types";
import { attemptPatternWords } from "./competitor";
import { buildEvidence, type EvidenceItem } from "./evidence";
import {
  applyProposals,
  checkProposals,
  readProposals,
  type AdjustedPlan,
  type Proposal,
  type ProposalCheck,
} from "./proposals";

export type Narrative = {
  coach_summary: string;
  key_finding: string;
  concerns: string[];
  challenges: string[];
  recommendations: Array<{ text: string; area: string; needs_approval: boolean }>;
  sections: Partial<
    Record<
      | "projection"
      | "field"
      | "attempts"
      | "warmups"
      | "game_day"
      | "bodyweight"
      | "programming"
      | "learning"
      | "debrief",
      string
    >
  >;
  call_note: string;
  athlete: {
    title: string;
    summary: string;
    focus: string[];
    expectations: string[];
    message: string;
  };
  coach_notification: string;
  /** Cleo's verdict on each part of the engines' baseline */
  engine_review: Array<{
    area: string;
    verdict: "agree" | "challenge" | "insufficient";
    note: string;
  }>;
  /** the calls Cleo made, as it made them (checked separately: Strategy) */
  proposals: Proposal[];
};

/** Cleo's calls after the checks, and the plan rebuilt with the ones that stood. */
export type Strategy = {
  checks: ProposalCheck[];
  adjusted: AdjustedPlan;
  evidence: EvidenceItem[];
};

/** What each milestone asks Cleo to focus on. */
const FOCUS: Record<MilestoneKind, string> = {
  recon:
    "Reconnaissance. Research the meet, the athlete's history and early threats; set preliminary objectives and targets; say what's missing. Athlete version: a simple overview of what this preparation is about.",
  foundation:
    "Strategic foundation (12 weeks out). Realistic target totals, what each lift needs, the bodyweight path, whether the current programming supports the objective, the early landscape and the limits on preparation. Athlete version: what the preparation focuses on and what's expected of them.",
  intel:
    "Competitive intelligence (8 weeks out). Is progress on track against the projection? Updated field, fatigue / adherence / injury signs, whether priorities or the objective should change. Athlete version: a short progress update.",
  forecast:
    "Performance forecasting (4 weeks out). Refined lift and total projections, preliminary attempt ranges and openers, readiness, bodyweight readiness, taper needs, competitor projections, scenarios and last-minute mistakes to avoid. Athlete version: a concise preparation update.",
  game_plan:
    "Game plan (2 weeks out). The complete preliminary plan: openers, second and third ranges, conditional pathways, warm-ups, weigh-in, meet-day fuelling, placing / qualification / record scenarios, risk and contingencies, technical cues. Athlete version: the plan in simple, followable words (the attempts and warm-ups are attached by the app, don't restate every number).",
  confirm:
    "Game plan confirmation (1 week out). The final read: what the last meaningful sessions say, readiness, bodyweight, opener check, warm-ups, competitor updates, the taper, logistics. Say exactly what changed since the game plan and why. Athlete version: the confirmed plan in simple words.",
  update:
    "Interim update. Something meaningful changed between milestones (a forecast that moved, a new concern). Say what changed, why it matters and what to do. Athlete version: only if they need to act on something; otherwise a brief reassurance.",
  debrief:
    "Debrief. Projected against actual, planned against actual attempts, attempt selection, warm-ups, taper, execution, decisions, placing, missed-attempt patterns and lessons for next time. Athlete version: a constructive competition review.",
};

const SYSTEM = `You are Cleo, the head strategist inside JF Effect's competition intelligence: an elite international-level powerlifting coach, performance analyst and meet handler writing a strategic second opinion for the coach.

THE ENGINES AND YOU
The brief's numbers come from deterministic engines: formulas that know the athlete only through generic rules (a strength line from hard sets, a default platform conversion, an opener at a fixed share of the expected max, a standard warm-up ramp, competitors projected from their meet trend). They are a baseline, not the answer. Your job is to read the EVIDENCE the way a world-class coach would and decide, area by area, whether each baseline holds for THIS athlete. Challenge it when the athlete's own history and recent training justify it, in either direction. Agree when it holds. Say "insufficient" when the evidence can't decide. Never rubber-stamp and never change a number for the sake of changing it.

How an elite coach reads the evidence:
- Forecast, first: put each lift's expected (L- items) beside what they actually made at their recent meets in this class (M items). A lifter who made 240 at three meets this year doesn't become a 220 lifter because an off-season block is at RPE 6. If the engine sits clearly under (or over) their recent platform form and nothing in the evidence explains it (pain, a bigger cut than they've made before (BWH), meets trending down, a program with no peak), that's a challenge with a forecast proposal. If something does explain it, say what.
- Forecast: compare recent top sets (load, reps, RPE, bar speed) with what the athlete has done on a platform; their own training-to-platform history (CV- items); where they are in the season (off-season RPE 6 volume is not a max, and a deload or taper is not strength lost); how many weeks remain and what a lifter of their training age and level realistically gains in that time; bodyweight and the class (making weight costs strength, the bench most); pain and recovery; whether the program reaches a peak.
- Attempts: their own attempt history (where they open, which lift they miss, how often thirds are made, misses that cost a total); the objective (placing and qualifying beat individual PRs); the field; rules (never lower after an attempt). An opener is made on a bad day; a third serves the objective.
- Warm-ups: their own last-warm-up habit from training (W- items) against the standard ramp; flight timing.
- Taper: what preceded their best meets; the last heavy single and volume drop; recommend to the coach, never rewrite the program.
- Bodyweight and the class: compare how far from the class they are today with how far they were at the same distance before meets they made in it (BWH). A cut they've made before is evidence they can make it; a much bigger one costs strength and needs a decision now, not in meet week, with the adjacent class's field (ALT- items) as the alternative.
- Competitors: their recent level, not lifetime bests; someone with no meet in nine months or more may not be competing at that level any more, so say it rather than assume; a run of competition-standard training over weeks can move their expected (in either direction), one posted PR can't; class changes, equipment, consistency, how they attempt.
- Strategy and risk: the two or three decisions that will actually decide this meet, and what to do when it goes wrong.

PROPOSALS (structured calls, checked by code)
Make a proposal only where the evidence justifies a different number or a specific action. Each cites evidence ids from EVIDENCE. Code checks them: cited ids must exist; numbers need training or meet evidence (a competitor needs their own record); a move over 3% needs two items; a lift's expected moves at most 8% (conservative or high 10%), a competitor's 12%; attempts are multiples of the increment, each at least one increment over the last, the opener no higher than the conservative scenario, the second no higher than the expected, the third no higher than the high, jumps at most 10% then 7%; the last warm-up 82–97% of the opener; a warm-up ladder 3–9 rising sets on 2.5 kg plates. What passes is applied and the engines rebuild the totals, the field, the attempt pathways and the warm-ups from it.
Proposal shape (use the fields that apply):
{"type":"forecast|competitor|attempt|last_warmup|warmup_sets|taper|strategy|risk","lift":"squat|bench|deadlift|null","scenario":"conservative|expected|high","attempt":1|2|3,"kg":number,"sets":[{"kg":number,"reps":number}],"competitor":"name as in the brief","days_out":number,"severity":"watch|concern|serious","text":"the call in one sentence","reason":"why, from the evidence, in a coach's words","evidence":["T-SQ1","M2"],"confidence":"high|medium|low"}
Attempt proposals change the planned (balanced) pathway; the conservative and aggressive pathways follow.

NUMBERS
In everything you write, use only numbers that are in the brief, the evidence, or your proposals that pass the checks. Small gaps and jumps under 50 kg you can work out. Never give a probability. A forecast is a range, never a promise.

VOICE
Coach-facing: direct, specific, technically sophisticated, short. Separate evidence from interpretation and say which is which. If a competitor is clearly stronger, say it. If the preparation isn't adequate, say what's wrong and a realistic fix. No hype, filler or em dashes.
Athlete-facing: plain, constructive, actionable, in the coach's voice ("I", "we"). NO weights or totals at all (the app attaches the plan with every number); never mentions competitors' research, private concerns about competitors, or Cleo.
Never recommend dehydration, water loading, sodium manipulation, diuretics, saunas or a crash cut. Caffeine only in amounts the athlete already uses. Nothing you write changes a program, a plan or an attempt by itself: the coach decides.

Answer ONLY with JSON:
{
  "coach_summary": "4-8 sentences: the strategic read, what you agree with and what you'd change",
  "key_finding": "the single most important thing, one sentence",
  "engine_review": [{"area": "forecast|attempts|warmups|taper|field|bodyweight|programming|strategy", "verdict": "agree|challenge|insufficient", "note": "one or two sentences: why, from which evidence"}],
  "proposals": [ ...proposal objects, 0-10... ],
  "concerns": ["significant concerns, most important first (0-5)"],
  "challenges": ["where the plan or expectations should be challenged (0-4)"],
  "recommendations": [{"text": "what to do", "area": "programming|attempts|bodyweight|recovery|competitors|logistics|nutrition|cardio|communication|taper", "needs_approval": true}],
  "sections": {"projection": "...", "field": "...", "attempts": "...", "warmups": "...", "game_day": "...", "bodyweight": "...", "programming": "...", "learning": "...", "debrief": "..."},
  "call_note": "one or two sentences to the coach: why a strategy call is or isn't worth it now",
  "athlete": {"title": "short title", "summary": "2-4 sentences", "focus": ["what to focus on (1-4)"], "expectations": ["what's expected of them (0-4)"], "message": "a chat message under 280 characters in the coach's voice introducing this update"},
  "coach_notification": "one line under 180 characters for the coach's inbox"
}
Leave a section out when it doesn't apply to this milestone.`;

/** The brief as the model reads it: everything that decides, nothing it doesn't need. */
export function briefForModel(
  b: Brief,
  extra: {
    athleteName: string;
    instructions: string | null;
    previousHeadline: string | null;
    debrief?: unknown;
  },
) {
  const c = b.competition;
  return {
    milestone: b.milestone ? MILESTONE_BY_KIND[b.milestone].title : "Update",
    phase: b.phase,
    days_out: b.daysOut,
    athlete: extra.athleteName,
    competition: {
      name: c.name,
      date: c.meetDate,
      federation: c.federation,
      division: c.division,
      weight_class: c.weightClass,
      level: c.level,
      objective: c.objective ? OBJECTIVE_LABEL[c.objective] : null,
      target_total: c.targetTotal,
      target_place: c.targetPlace,
      qualification_total: c.qualificationTotal,
      athlete_goal_total: c.athleteGoalTotal,
      records: c.recordsNote,
      registration: c.registration,
      rules: {
        increment_kg: c.rules.incrementKg,
        tie_break: c.rules.tieBreak,
        weigh_in_hours: c.rules.weighInHours,
        confirmed: c.rules.confirmed,
      },
    },
    forecast: {
      confidence: b.forecast.confidence,
      total: b.forecast.total,
      best_meet_total: b.forecast.bestMeetTotal,
      vs_best: b.forecast.vsBest,
      lifts: Object.fromEntries(
        (Object.entries(b.forecast.lifts) as [Lift, (typeof b.forecast.lifts)[Lift]][]).map(
          ([l, f]) => [l, f ? { range: f.range, confidence: f.confidence, basis: f.basis } : null],
        ),
      ),
      factors: b.forecast.factors,
      limitations: b.forecast.limitations,
      projection_shift_since_last: b.projectionShift,
    },
    field: {
      threats: b.landscape.ranked.slice(0, 8).map((t) => ({
        name: t.name,
        expected: t.expected,
        range: t.range,
        overlaps_ours: t.overlaps,
        level: t.level,
        why: t.why,
      })),
      biggest_threat: b.landscape.biggest?.name ?? null,
      to_win: b.landscape.toWin,
      to_podium: b.landscape.toPodium,
      projected_place: b.landscape.place,
      qualification: b.landscape.qualification,
      subtotal_vs_threat: b.landscape.subtotal,
      answers: b.landscape.answers,
      overestimate_warning: b.landscape.overestimate,
      competitors: b.competitors.slice(0, 10).map((x) => ({
        name: x.name,
        identity: x.identity,
        recent_total: x.read.recentTotal,
        best_total: x.read.bestTotal,
        trend_kg_per_year: x.read.trendPerYear,
        meets_per_year: x.read.perYear,
        attempt_patterns: attemptPatternWords(x.read.stats),
        style: x.read.stats.style,
        projection: x.read.projection
          ? {
              conservative: x.read.projection.conservative,
              expected: x.read.projection.expected,
              high: x.read.projection.high,
            }
          : null,
        confidence: x.read.confidence,
        basis: x.read.basis,
        entry: x.status,
        training_read: Object.values(x.read.training)
          .filter(Boolean)
          .map((t) => ({
            lift: t!.lift,
            platform_estimate: t!.estimateKg,
            days: t!.exposures,
            span_days: t!.spanDays,
            share_of_gap_taken: t!.weight,
          })),
      })),
    },
    attempts: Object.fromEntries(
      (Object.entries(b.attempts.lifts) as [Lift, (typeof b.attempts.lifts)[Lift]][]).map(
        ([l, a]) => [
          LIFT_LABEL[l],
          a
            ? {
                opener: a.opener,
                opener_conservative: a.openerConservative,
                second: a.second,
                third: a.third,
                pathways: a.pathways,
                why: a.why,
              }
            : null,
        ],
      ),
    ),
    attempt_totals: b.attempts.totals,
    warmups: Object.fromEntries(
      (Object.entries(b.warmups) as [Lift, (typeof b.warmups)[Lift]][]).map(([l, w]) => [
        LIFT_LABEL[l],
        w
          ? {
              sets: w.sets.map((s) => `${s.kg}x${s.reps}`),
              last: w.last.kg,
              individual: w.individual,
              why: w.why,
            }
          : null,
      ]),
    ),
    watch: b.watch.map((w) => ({ severity: w.severity, area: w.area, text: w.text })),
    class_options: (b.classOptions ?? []).map((c) => ({
      weight_class: c.weightClass,
      why_considered: c.reason,
      field: c.lifters,
      // what they'd total there: their own meets at that class, and today's expected scaled to it
      our_totals_at_this_class: c.ours?.own ?? [],
      our_totals_since: c.ours?.ownSince ?? null,
      our_expected_scaled_to_this_class: c.ours?.scaled ?? null,
      our_estimate_here: c.ours?.kg ?? null,
      we_would_place_about: c.ourPlace,
    })),
    bodyweight: {
      seven_day_avg: b.inputs.bodyweightAvg,
      trend_per_week: b.inputs.bodyweightTrendPerWeek,
      class_limit: b.inputs.classLimit,
    },
    strategy_call: {
      recommended: b.call.recommend,
      minutes: b.call.minutes,
      reasons: b.call.reasons,
      skip: b.call.skipReason,
      coverage: b.call.coverage.text,
    },
    learned_about_athlete: b.profile.patterns.map((p) => `${p.text} (${p.evidence})`),
    missing_information: b.missing,
    previous_headline: extra.previousHeadline,
    coach_instructions: extra.instructions,
    debrief: extra.debrief ?? undefined,
  };
}

const clip = (s: unknown, n: number) =>
  typeof s === "string"
    ? s
        .replace(/\s*—\s*/g, ", ")
        .trim()
        .slice(0, n)
    : "";
const list = (v: unknown, n: number, len: number) =>
  Array.isArray(v)
    ? v
        .map((x) => clip(x, len))
        .filter(Boolean)
        .slice(0, n)
    : [];

/** The model's answer read tolerantly; null when it isn't the JSON asked for. */
export function readNarrative(text: string): Narrative | null {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || !clip(j.coach_summary, 10) || !j.athlete) return null;
  const sections: Narrative["sections"] = {};
  for (const k of [
    "projection",
    "field",
    "attempts",
    "warmups",
    "game_day",
    "bodyweight",
    "programming",
    "learning",
    "debrief",
  ] as const) {
    const v = clip(j.sections?.[k], 2500);
    if (v) sections[k] = v;
  }
  return {
    coach_summary: clip(j.coach_summary, 2000),
    key_finding: clip(j.key_finding, 400),
    concerns: list(j.concerns, 5, 400),
    challenges: list(j.challenges, 4, 400),
    recommendations: (Array.isArray(j.recommendations) ? j.recommendations : [])
      .slice(0, 6)
      .map((r: any) => ({
        text: clip(r?.text, 400),
        area: clip(r?.area, 30) || "general",
        needs_approval: r?.needs_approval !== false,
      }))
      .filter((r: any) => r.text),
    sections,
    call_note: clip(j.call_note, 500),
    athlete: {
      title: clip(j.athlete?.title, 120) || "Competition update",
      summary: clip(j.athlete?.summary, 1200),
      focus: list(j.athlete?.focus, 4, 300),
      expectations: list(j.athlete?.expectations, 4, 300),
      message: clip(j.athlete?.message, 300),
    },
    coach_notification: clip(j.coach_notification, 180) || clip(j.key_finding, 180),
    engine_review: (Array.isArray(j.engine_review) ? j.engine_review : [])
      .slice(0, 10)
      .map((r: any) => ({
        area: clip(r?.area, 30) || "general",
        verdict: (["agree", "challenge", "insufficient"].includes(r?.verdict)
          ? r.verdict
          : "insufficient") as "agree" | "challenge" | "insufficient",
        note: clip(r?.note, 600),
      }))
      .filter((r: any) => r.note),
    proposals: readProposals(j.proposals),
  };
}

/** Every written field Cleo gave, coach-facing and athlete-facing. */
function writtenText(n: Narrative) {
  const coach = [
    n.coach_summary,
    n.key_finding,
    ...n.concerns,
    ...n.challenges,
    ...n.recommendations.map((r) => r.text),
    ...Object.values(n.sections),
    n.call_note,
    n.coach_notification,
    ...n.engine_review.map((r) => r.note),
  ].join("\n");
  const athlete = [
    n.athlete.title,
    n.athlete.summary,
    ...n.athlete.focus,
    ...n.athlete.expectations,
    n.athlete.message,
  ].join("\n");
  return { coach, athlete };
}

/** Numbers over 12 in the athlete's words (years aside): the plan carries the weights. */
export function athleteNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w.])(\d{1,4}(?:[.,]\d{1,2})?)(?![\d])/g)) {
    const n = Number(m[1].replace(",", "."));
    if (n > 12 && !(n >= 1900 && n <= 2100)) out.push(n);
  }
  return [...new Set(out)];
}

/** Problems with an answer: numbers that aren't grounded, weights in the athlete's words, phrases the app never says. */
export function narrativeProblems(n: Narrative, allowed: Set<number>): string[] {
  const { coach, athlete } = writtenText(n);
  const out: string[] = [];
  const bad = ungroundedNumbers(`${coach}\n${athlete}`, allowed).filter(
    // small gaps and jumps are worked out, not invented
    (x) => !(x < 50 && Math.abs(x * 2 - Math.round(x * 2)) < 1e-9),
  );
  if (bad.length)
    out.push(
      `These numbers aren't in the brief, the evidence or a proposal that passed: ${bad.slice(0, 8).join(", ")}. Use only those numbers.`,
    );
  const nums = athleteNumbers(athlete);
  if (nums.length)
    out.push(
      `The athlete's words have weights or totals in them (${nums.slice(0, 5).join(", ")}): the app attaches the plan, keep numbers out of them.`,
    );
  const banned = bannedPhrases(`${coach}\n${athlete}`);
  if (banned.length)
    out.push("Never give probabilities, guarantees or water / sodium / sauna weight cutting.");
  return out;
}

/** What the checks said about the calls that didn't stand, for the second round. */
export function proposalProblems(checks: ProposalCheck[]): string[] {
  return checks
    .filter((c) => !c.ok)
    .map(
      (c) =>
        `Proposal "${c.proposal.text || c.proposal.type}" (${c.proposal.type}${c.proposal.lift ? ` ${c.proposal.lift}` : ""}${c.proposal.kg != null ? ` ${c.proposal.kg} kg` : ""}) was set aside: ${c.reasons.join("; ")}. Fix it or drop it, and don't lean on it in the read.`,
    );
}

/** The numbers Cleo may use: the brief, the evidence, and the plan rebuilt with the calls that stood. */
export function allowedNumbers(
  forModel: unknown,
  evidence: EvidenceItem[],
  adjusted: AdjustedPlan,
) {
  const set = numbersIn(forModel);
  numbersIn(
    evidence.map((e) => e.text),
    set,
  );
  numbersIn(
    {
      lifts: adjusted.lifts,
      total: adjusted.total,
      attempts: adjusted.attempts,
      warmups: Object.values(adjusted.warmups).map(
        (w) => w && { sets: w.sets.map((s) => s.kg), last: w.last.kg },
      ),
      landscape: {
        toWin: adjusted.landscape.toWin,
        toPodium: adjusted.landscape.toPodium,
        subtotal: adjusted.landscape.subtotal,
        qualification: adjusted.landscape.qualification,
        ranked: adjusted.landscape.ranked.map((t) => t.range),
      },
    },
    set,
  );
  return set;
}

export class NarrativeRejected extends Error {}

/** The evidence as the model reads it: one line an item. */
export function evidenceForModel(evidence: EvidenceItem[]): string {
  return evidence.map((e) => `${e.id}: ${e.text}`).join("\n");
}

/** Writes (or keeps polling for) the assessment; throws WaitingForModel while a model is still thinking. */
export async function writeNarrative(
  sb: any,
  b: Brief,
  extra: {
    athleteName: string;
    instructions: string | null;
    previousHeadline: string | null;
    debrief?: unknown;
  },
  state: CallState,
  save: () => Promise<void>,
): Promise<{ narrative: Narrative; model: string; strategy: Strategy }> {
  const { stagedCall, ModelsExhausted, OPENAI_CREDITS_HINT } =
    await import("@/lib/ai/staged-call.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const route = resolveRoute("competition", await readRouteOverride(sb), { openaiOnly: true });
  const forModel = briefForModel(b, extra);
  const evidence = buildEvidence(b);
  const kind = b.milestone ?? "update";
  const prompt = `${FOCUS[kind]}\n\nBRIEF (the engines' baseline, JSON):\n${JSON.stringify(forModel)}\n\nEVIDENCE (cite these ids in proposals):\n${evidenceForModel(evidence)}`;
  const call = async (key: string, p: string) => {
    try {
      return await stagedCall({
        state,
        key,
        route,
        req: {
          system: SYSTEM,
          prompt: p,
          effort: route.effort,
          maxOutputTokens: route.maxOutputTokens,
        },
        save,
        tag: `competition:${kind}`,
        poll: { ms: 40_000, every: 3000 },
        backgroundLimitMs: 25 * 60_000,
        hedgeAfterMs: 15 * 60_000,
        finalLimitMs: 40 * 60_000,
        syncTimeoutMs: 200_000,
      });
    } catch (e) {
      if (!(e instanceof ModelsExhausted)) throw e;
      throw new Error(
        `The competition model didn't answer (tried ${e.tried.join(", ")}). Assessments aren't handed to a weaker model.${e.noOpenAiCredits ? OPENAI_CREDITS_HINT : ""}`,
      );
    }
  };
  const judge = (text: string) => {
    const n = readNarrative(text);
    if (!n)
      return {
        n: null,
        checks: [] as ProposalCheck[],
        problems: ["The answer wasn't the JSON asked for."],
        adjusted: null as AdjustedPlan | null,
      };
    const checks = checkProposals(b, evidence, n.proposals);
    const adjusted = applyProposals(
      b,
      checks.filter((c) => c.ok).map((c) => c.proposal),
    );
    const allowed = allowedNumbers(forModel, evidence, adjusted);
    const problems = [...proposalProblems(checks), ...narrativeProblems(n, allowed)];
    return { n, checks, problems, adjusted };
  };
  const first = await call("write", prompt);
  let r = judge(first.text);
  if (r.n && !r.problems.length)
    return {
      narrative: r.n,
      model: first.model,
      strategy: { checks: r.checks, adjusted: r.adjusted!, evidence },
    };
  const second = await call(
    "write2",
    `${prompt}\n\nYOUR LAST ANSWER HAD PROBLEMS. Fix them and answer again with the whole JSON:\n- ${r.problems.join("\n- ")}`,
  );
  r = judge(second.text);
  if (!r.n) throw new NarrativeRejected("The assessment wasn't readable twice.");
  // calls still failing their checks are set aside (kept, with why); the words must still hold
  const wordProblems = narrativeProblems(r.n, allowedNumbers(forModel, evidence, r.adjusted!));
  if (wordProblems.length)
    throw new NarrativeRejected(
      `The write-up didn't hold to the numbers: ${wordProblems.join(" ")}`,
    );
  return {
    narrative: r.n,
    model: second.model,
    strategy: { checks: r.checks, adjusted: r.adjusted!, evidence },
  };
}

/** The athlete-facing version: Cleo's words plus, for a game plan, the plan itself from the engines. */
export function athleteVersion(
  b: Brief,
  n: Narrative,
  kind: MilestoneKind,
  adjusted?: AdjustedPlan | null,
) {
  const c = b.competition;
  const att = adjusted?.attempts ?? b.attempts;
  const warm = adjusted?.warmups ?? b.warmups;
  const plan =
    kind === "game_plan" || kind === "confirm"
      ? {
          attempts: Object.fromEntries(
            (Object.entries(att.lifts) as [Lift, (typeof att.lifts)[Lift]][]).map(([l, a]) => [
              l,
              a
                ? {
                    opener: a.opener,
                    second: a.second,
                    third: a.third,
                    conditional: a.conditional,
                    contingencies: a.contingencies.slice(0, 3),
                  }
                : null,
            ]),
          ),
          warmups: Object.fromEntries(
            (Object.entries(warm) as [Lift, (typeof warm)[Lift]][]).map(([l, w]) => [
              l,
              w
                ? {
                    sets: w.sets.map((s) => ({
                      kg: s.kg,
                      lb: s.lb,
                      reps: s.reps,
                      minutesBefore: s.minutesBefore,
                    })),
                    general: w.general,
                    equipment: w.equipment,
                    timing: w.timing,
                    delays: w.delays,
                  }
                : null,
            ]),
          ),
          gameDay: b.gameDay,
        }
      : null;
  return {
    title: n.athlete.title,
    summary: n.athlete.summary,
    focus: n.athlete.focus,
    expectations: n.athlete.expectations,
    message: n.athlete.message,
    meet: {
      name: c.name,
      date: c.meetDate,
      endDate: c.meetEndDate,
      location: c.location,
      federation: c.federation,
      weightClass: c.weightClass,
      division: c.division,
    },
    plan,
  };
}
