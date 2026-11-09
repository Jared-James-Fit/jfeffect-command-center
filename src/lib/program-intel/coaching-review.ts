/**
 * The coaching review: after the deterministic audit has checked what code can
 * check (weeks, prescriptions, dates, equipment, the strategy's own targets), the
 * coaching brain reads the built program the way a head coach would before it
 * reaches an athlete: fatigue across the week and the weeks, recovery between
 * demanding sessions (in context, never by rule), exercise selection,
 * specificity for the goal and timeline, progression, and this athlete's needs.
 *
 * It reports only genuine problems. A "must fix" names its block and the smallest
 * change, and goes to a targeted repair of that block (never a rebuild); a
 * "consider" is shown to the coach. It runs once per program. Pure.
 */
import { z } from "zod";
import type { AuditResult, Criterion } from "./audit";
import { clip, clipReq, list, type BuiltProgram, type Strategy } from "./generator-schemas";
import { fmtRx, rxForWeek } from "./program-view";
import type { GenerationSetup } from "./recommend";
import { BRAIN_LABEL, type Brain } from "./types";

export const REVIEW_AREAS = ["fatigue", "recovery", "selection", "specificity", "progression", "individual", "other"] as const;
export type ReviewArea = (typeof REVIEW_AREAS)[number];

export const reviewReplySchema = z.object({
  verdict: z.enum(["sound", "needs_fixes"]).catch("sound"),
  summary: clip(2000),
  issues: list(
    z.object({
      block: z.coerce.number().int().min(1).max(6).nullish().catch(null),
      area: z.enum(REVIEW_AREAS).catch("other"),
      severity: z.enum(["must_fix", "consider"]).catch("consider"),
      problem: clipReq(1000),
      fix: clip(1000),
    }),
    10,
  ),
});
export type ReviewReply = z.infer<typeof reviewReplySchema>;
export type CoachingReview = ReviewReply & { model: string; at: string; repaired: number[] };

/** Where a review issue sits on the scorecard. */
const CRITERION: Record<ReviewArea, Criterion> = { fatigue: "fatigue", recovery: "fatigue", selection: "selection", specificity: "specificity", progression: "progression", individual: "individualization", other: "goal" };

export function reviewSystemPrompt(brain: Brain): string {
  return `You are the head coach at JF Effect, reviewing a ${BRAIN_LABEL[brain]} program built for one athlete before it reaches them. Read it the way an elite, evidence-informed powerlifting and bodybuilding coach would.

Judge, for THIS athlete (the brief: their development read, pain reports, adherence, recovery, session length, equipment, goal and timeline):
- fatigue across the week and across the weeks (where the hard sessions and the volume land; whether it builds sensibly and has a way to shed fatigue when it needs one);
- recovery between demanding sessions, in context: a heavy squat the day after a heavy deadlift can be fine or a problem depending on the loads, the volume, the athlete and the phase. Judge it; never flag it by rule;
- exercise selection (fit for the goal, the athlete's response history and equipment; no needless complexity);
- specificity for the goal and timeline (a meet or test: does it peak into it, or build what the next phase needs);
- progression (is each lift's progression appropriate for their training age and recent response; no fake progression);
- anything about this athlete the program ignores.

Report only genuine problems:
- "must_fix": would meaningfully hurt this athlete's progress, recovery or safety. Name the block (1-based) and the smallest change that fixes it (move a session, swap one exercise, change a prescription). Never ask for a rebuild, and keep the strategy unless something in it is wrong.
- "consider": a good coach might reasonably do it differently; say why briefly.
Don't restate what's fine, don't nitpick wording, don't repeat the automatic checks unless you disagree with them. If the program is sound, say so with no issues.

Reply with ONE JSON object and nothing else:
{ "verdict": "sound" | "needs_fixes", "summary": string (2-4 sentences: what it does well and the main risk, if any),
  "issues": [ { "block": int|null, "area": "fatigue"|"recovery"|"selection"|"specificity"|"progression"|"individual"|"other", "severity": "must_fix"|"consider", "problem": string, "fix": string } ] }`;
}

/** The program as a coach reads it: each block's days in order (their weekday), every exercise with its week-by-week prescription. */
export function programText(program: BuiltProgram, trainingDays: string[]): string {
  return program.blocks
    .map((b, bi) => {
      const head = `Block ${bi + 1} "${b.name}" (${b.weeks} weeks${b.week_phases?.length ? `; ${b.week_phases.map((p) => `W${p.week} ${p.phase}`).join(", ")}` : ""}${b.deload_rule ? `; deload rule: ${b.deload_rule}` : ""})${b.objective ? `\nObjective: ${b.objective}` : ""}`;
      const days = b.days.map((d, di) => {
        const ex = d.exercises.map((e) => {
          const weeks = Array.from({ length: b.weeks }, (_, i) => i + 1);
          const first = fmtRx(rxForWeek(e, 1));
          const changes = weeks.slice(1).map((w) => [w, fmtRx(rxForWeek(e, w))] as const).filter(([, rx], i, arr) => rx !== (i === 0 ? first : arr[i - 1][1]));
          return `  - ${e.exercise_name}${e.role ? ` [${e.role}]` : ""}: ${first}${e.rest_seconds ? `, rest ${e.rest_seconds}s` : ""}${changes.length ? `; ${changes.map(([w, rx]) => `W${w} ${rx}`).join(", ")}` : ""}${e.progression ? ` · progression: ${e.progression}` : ""}`;
        });
        return ` Day ${di + 1} ${d.title}${trainingDays[di] ? ` (${trainingDays[di]})` : ""}${d.focus ? `, ${d.focus}` : ""}\n${ex.join("\n")}`;
      });
      return `${head}\n${days.join("\n")}`;
    })
    .join("\n\n");
}

export function reviewUserPrompt(x: { brief: string; setup: GenerationSetup; strategy: Strategy; program: BuiltProgram; audit: Pick<AuditResult, "findings" | "sessions" | "weekly"> & { facts?: string[] } }): string {
  const w1 = x.audit.weekly[0];
  const minutes = x.audit.sessions.filter((s) => s.week === 1).map((s) => `${s.title} ~${s.minutes} min`);
  const open = x.audit.findings.filter((f) => f.status === "review" || f.status === "failed").map((f) => `- [${f.status}] ${f.text}`);
  return [
    `## The program to review (${x.setup.weeks} weeks, ${x.setup.daysPerWeek} days: ${x.setup.trainingDays.join(", ") || "days not set"})`,
    programText(x.program, x.setup.trainingDays),
    ``,
    `## Measured by the automatic checks`,
    w1 ? `Week 1: ${w1.sets} sets; per muscle (aimed at it): ${Object.entries(w1.direct ?? {}).map(([m, v]) => `${m} ${v.sets}`).join(", ") || "—"}; main lifts: ${Object.entries(w1.lifts).map(([l, v]) => `${l} ${v.sets} sets on ${v.days} days`).join(", ")}` : "",
    minutes.length ? `Session length estimates (week 1): ${minutes.join(", ")}${x.setup.maxSessionMinutes ? ` (maximum ${x.setup.maxSessionMinutes} min${x.setup.cardio?.trainingDay ? ` with ${x.setup.cardio.trainingDay.minutes} min cardio after` : ""})` : ""}` : "",
    x.audit.facts?.length ? `Facts to judge in context (not findings):\n${x.audit.facts.map((f) => `- ${f}`).join("\n")}` : "",
    open.length ? `Already flagged by the checks:\n${open.join("\n")}` : "Nothing flagged by the checks.",
    ``,
    `## The strategy it was built from`,
    JSON.stringify({ structure: x.strategy.structure, roadmap: x.strategy.roadmap ?? null, progression: x.strategy.progression, intensity: x.strategy.intensity, prioritize: x.strategy.prioritize, reduce: x.strategy.reduce, weekly_layout: x.strategy.weekly_layout }, null, 1),
    ``,
    `## The athlete`,
    x.brief,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** The "must fix" issues that name a block, as repair instructions per block (0-based). */
export function reviewRepairs(review: ReviewReply, blocks: number): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const i of review.issues) {
    if (i.severity !== "must_fix" || i.block == null || i.block > blocks) continue;
    const bi = i.block - 1;
    out[bi] = [...(out[bi] ?? []), `Coaching review (${i.area}): ${i.problem}${i.fix ? ` Fix: ${i.fix}` : ""}`];
  }
  return out;
}

/**
 * The scorecard with the review in it: what's left to consider shows as "review" on its row; a
 * must-fix that went to repair is noted on its row as fixed (the automatic checks re-ran after).
 */
export function withReview(audit: AuditResult, review: CoachingReview | null): AuditResult {
  if (!review) return audit;
  const findings = [...audit.findings];
  for (const i of review.issues) {
    const fixed = i.severity === "must_fix" && i.block != null && review.repaired.includes(i.block - 1);
    findings.push({ criterion: CRITERION[i.area], status: fixed ? "passed" : "review", text: `${fixed ? "Fixed after the coaching review: " : "Coaching review: "}${i.problem}${!fixed && i.fix ? ` (${i.fix})` : ""}`, block: i.block != null ? i.block - 1 : undefined });
  }
  const order = { passed: 0, skipped: 1, review: 2, failed: 3 } as const;
  const scorecard = audit.scorecard.map((row) => {
    const mine = findings.filter((f) => f.criterion === row.criterion);
    const status = mine.reduce((s, f) => (order[f.status] > order[s] ? f.status : s), "passed" as keyof typeof order);
    return { ...row, status, reasons: mine.map((f) => f.text) };
  });
  const overall = scorecard.some((r) => r.status === "failed") ? "failed" : scorecard.some((r) => r.status === "review" || r.status === "skipped") ? "review" : "passed";
  return { ...audit, findings, scorecard, overall };
}
