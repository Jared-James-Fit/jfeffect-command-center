/**
 * Cleo's written assessment around the engines' numbers (server only).
 *
 * The brief (brief.ts) decides every number; Cleo writes the read a head
 * coach would: what matters most, what's wrong, what to challenge, what to do
 * and the athlete's version, in the background on the OpenAI key's strongest
 * models (route `competition`, staged calls, never Lovable credits). Every
 * number in the answer is checked against the brief (grounding.ts): a number
 * that isn't there sends it back once with what was wrong, and a second miss
 * fails this attempt (the worker tries again, three times at most). Provider
 * failures (no credits, a refused key, an outage) never use an attempt: the
 * milestone waits for AI to come back.
 */
import type { CallState } from "@/lib/ai/staged-call.server";
import type { Brief } from "./brief";
import { MILESTONE_BY_KIND } from "./milestones";
import { bannedPhrases, numbersIn, ungroundedNumbers } from "./grounding";
import { LIFT_LABEL, OBJECTIVE_LABEL, type Lift, type MilestoneKind } from "./types";
import { attemptPatternWords } from "./competitor";

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

const SYSTEM = `You are Cleo, the competition intelligence system inside JF Effect, writing for the coach like an elite competitive powerlifting coach, performance analyst and meet handler.

How you think:
- Evidence over hope. Separate what the numbers show from interpretation, and say which is which.
- Gym strength isn't platform performance. A forecast is a range, never a promise. Never give a probability.
- Challenge unrealistic expectations, unnecessary attempt risks and programming that doesn't serve the meet. If a competitor is clearly stronger, say it. If the preparation isn't adequate, say what's wrong and a realistic fix.
- Prioritize the objective (winning, placing, qualifying, a clean first meet) over maximum individual lifts. Don't take a risk a smaller attempt makes unnecessary.
- Fatigue, a deload or a taper is not strength loss. One great or bad session is a fluctuation.
- Competitors: describe observable attempt patterns, never their intentions. Gym posts are selective and often variations; they never count as meet results.
- Never recommend dehydration, water loading, sodium manipulation, diuretics, saunas or a crash cut. Caffeine only in amounts the athlete already uses.
- Nothing you write changes a program, a plan or an attempt: you recommend, the coach decides.

Numbers: use ONLY numbers that appear in the brief (kg, totals, dates, percentages, counts). Never compute a new total, attempt or projection. If a number you'd want isn't there, say it qualitatively.

Coach-facing writing: direct, specific, technically sophisticated, short. No hype, no filler, no headings inside fields, no em dashes. Athlete-facing writing: plain, constructive, actionable, warm but not gushing, in the coach's voice ("I", "we"), never mentions competitors' research, internal concerns about them or Cleo.

Answer ONLY with JSON:
{
  "coach_summary": "3-6 sentences: the read",
  "key_finding": "the single most important thing, one sentence",
  "concerns": ["significant concerns, most important first (0-5)"],
  "challenges": ["where the plan or expectations should be challenged (0-4)"],
  "recommendations": [{"text": "what to do", "area": "programming|attempts|bodyweight|recovery|competitors|logistics|nutrition|cardio|communication", "needs_approval": true}],
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
      threats: b.landscape.ranked
        .slice(0, 8)
        .map((t) => ({
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
  };
}

/** Problems with an answer: numbers the brief doesn't have, phrases the app never says. */
export function narrativeProblems(n: Narrative, allowed: Set<number>): string[] {
  const all = [
    n.coach_summary,
    n.key_finding,
    ...n.concerns,
    ...n.challenges,
    ...n.recommendations.map((r) => r.text),
    ...Object.values(n.sections),
    n.call_note,
    n.athlete.summary,
    ...n.athlete.focus,
    ...n.athlete.expectations,
    n.athlete.message,
    n.coach_notification,
  ].join("\n");
  const out: string[] = [];
  const bad = ungroundedNumbers(all, allowed);
  if (bad.length)
    out.push(
      `These numbers aren't in the brief: ${bad.slice(0, 8).join(", ")}. Use only the brief's numbers.`,
    );
  const banned = bannedPhrases(all);
  if (banned.length)
    out.push("Never give probabilities, guarantees or water / sodium / sauna weight cutting.");
  return out;
}

export class NarrativeRejected extends Error {}

/** Writes (or keeps polling for) the narrative; throws WaitingForModel while a model is still thinking. */
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
): Promise<{ narrative: Narrative; model: string }> {
  const { stagedCall, ModelsExhausted, OPENAI_CREDITS_HINT } =
    await import("@/lib/ai/staged-call.server");
  const { resolveRoute } = await import("@/lib/ai/routing");
  const { readRouteOverride } = await import("@/lib/ai/route-call.server");
  const route = resolveRoute("competition", await readRouteOverride(sb), { openaiOnly: true });
  const forModel = briefForModel(b, extra);
  const allowed = numbersIn(forModel);
  const kind = b.milestone ?? "update";
  const prompt = `${FOCUS[kind]}\n\nBRIEF (the engines' numbers, JSON):\n${JSON.stringify(forModel)}`;
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
        backgroundLimitMs: 20 * 60_000,
        hedgeAfterMs: 12 * 60_000,
        finalLimitMs: 30 * 60_000,
        syncTimeoutMs: 200_000,
      });
    } catch (e) {
      if (!(e instanceof ModelsExhausted)) throw e;
      throw new Error(
        `The competition model didn't answer (tried ${e.tried.join(", ")}). Assessments aren't handed to a weaker model.${e.noOpenAiCredits ? OPENAI_CREDITS_HINT : ""}`,
      );
    }
  };
  const first = await call("write", prompt);
  let n = readNarrative(first.text);
  let problems = n ? narrativeProblems(n, allowed) : ["The answer wasn't the JSON asked for."];
  if (!problems.length && n) return { narrative: n, model: first.model };
  const second = await call(
    "write2",
    `${prompt}\n\nYOUR LAST ANSWER HAD PROBLEMS, fix them and answer again with the whole JSON:\n- ${problems.join("\n- ")}`,
  );
  n = readNarrative(second.text);
  problems = n ? narrativeProblems(n, allowed) : ["The answer wasn't the JSON asked for."];
  if (n && !problems.length) return { narrative: n, model: second.model };
  throw new NarrativeRejected(
    `The write-up didn't hold to the engines' numbers: ${problems.join(" ")}`,
  );
}

/** The athlete-facing version: Cleo's words plus, for a game plan, the plan itself from the engines. */
export function athleteVersion(b: Brief, n: Narrative, kind: MilestoneKind) {
  const c = b.competition;
  const plan =
    kind === "game_plan" || kind === "confirm"
      ? {
          attempts: Object.fromEntries(
            (Object.entries(b.attempts.lifts) as [Lift, (typeof b.attempts.lifts)[Lift]][]).map(
              ([l, a]) => [
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
              ],
            ),
          ),
          warmups: Object.fromEntries(
            (Object.entries(b.warmups) as [Lift, (typeof b.warmups)[Lift]][]).map(([l, w]) => [
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
