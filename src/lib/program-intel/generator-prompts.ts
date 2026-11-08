/**
 * The instructions for Generate Next Program's AI stages. The model never
 * computes or invents a past result: every number about the past is in the
 * brief, measured by the deterministic stages. Stage 4 decides the strategy
 * (what stays, what changes and why) before any exercise is chosen; stage 5
 * builds one block at a time from the approved strategy; repairs fix only
 * what the audit found.
 */
import { DEVELOPMENT_RULES } from "./athlete-development";
import { EXERCISE_STANDARD } from "./exercise-standard";
import { BLOCK_GUIDE, PROGRAMMING_METHOD } from "./methods";
import { BRAIN_LABEL, type Brain } from "./types";
import type { BuiltBlock, Strategy } from "./generator-schemas";
import type { CatalogExercise } from "./next-program";
import type { GenerationSetup } from "./recommend";

export const PIPELINE_PROMPT_VERSION = 6;

const EVIDENCE_RULES = `Evidence rules:
- Facts about the past come only from the brief. Copy numbers exactly as they appear there (week labels like "B1·W2", exercises, loads, reps, RPE, percentages). Never compute, estimate or invent a past result.
- Mark each decision "fact" only when its observation is itself a measurement from the brief (a load, a trend, a count); otherwise "hypothesis". An observation that links a cause (pain during X, stalled because of Y, recurring in sessions with Z) is a hypothesis even when every number in it is measured. A pattern seen in one block is not an established response; correlation is not causation.
- Where the data is missing (e.g. no RPE logged, no check-outs, no bodyweight), say so in data_limits and lower confidence; never infer effort or fatigue from load alone. Keep programming when other information is enough.`;

const PROGRAMMING_RULES = `Programming rules:
- Start from THIS athlete's response, never a generic template. Don't assume the next program needs a redesign: keep what worked and progress it; change what didn't only after naming the likely reason; every meaningful change has a purpose.
- The coach's setup is binding: days per week, weeks, session limits, equipment, required and excluded exercises, restrictions. A setting the coach changed is a requirement. If two requirements conflict, say so in "conflicts" instead of silently dropping one.
- The coach's notes & ideas for this program are the head coach's direction: follow each one (they outrank the defaults and your own preferences, never safety, their equipment or the exercise standard) and say in coach_requirements how each was used, or why it couldn't be.
- Respect the athlete's real circumstances: their equipment (only what's listed), the equipment rules, their session time, injuries and pain reports, and what they actually adhere to.
- Cardio is the client's cardio plan (see "Cardio" in the brief), not part of the program you write: the app adds the plan's training-day session as the last exercise of every workout and asks for its rest-day sessions on days off. Never write walking, treadmill, bike, elliptical, stair, rowing-machine or other steady cardio into a workout; leave the time for it and let it shape the lifting (fatigue, leg volume, session length).
- The brief's "Athlete development" section is the measured read of how this athlete develops: their training age and rate of progress, strength against bodyweight and bodyweight phase, weight class, plateaus, adherence, fatigue, and progress / hold / back off for each exercise. The cycle's progression model, starting prescriptions and volume follow it.

${DEVELOPMENT_RULES}

${EXERCISE_STANDARD}`;

/**
 * A first program: nothing logged yet. It replaces "respond to the previous
 * program" with what to build from instead (their setup answers and the
 * coach's notes & ideas) and how a first block should run.
 */
export const FIRST_PROGRAM_RULES = `FIRST PROGRAM: this athlete has no training logged with the coach yet, so there is no previous program, no load history and no measured response; wherever the method above talks about what the athlete responded to, use their setup answers and the coach's notes & ideas instead.
- Build from the brief: their goal, experience level, training days, session length, equipment, injuries and anything else they said at setup, plus the coach's notes & ideas.
- Use the setup's starting doses (frequency, weekly sets, rep ranges, effort, progression): they're evidence-based for their level and already fitted to their time. Don't add volume to "be safe".
- Pick simple, stable exercises that suit their level and equipment and load in small steps; a beginner gets the fewest, most learnable movements (machines and dumbbells are fine), an experienced lifter the standard compounds and the accessories their goal needs. Keep the same exercises through the block so progress can be read.
- Week 1 doubles as an assessment: the easier effort target in the setup, to find working weights and learn the movements; progress from week 2.
- Never write a starting weight: nothing is logged. Say how to pick it in the note ("a weight you could lift 3 more times"); use a percentage only for a lift whose max is in the load references.
- Work around stated injuries with exercise choice, range and tempo, not by dropping the muscle.`;

export function strategySystemPrompt(brain: Brain, opts: { first?: boolean } = {}): string {
  return `You are the head coach's ${BRAIN_LABEL[brain]} programming brain at JF Effect, an elite strength and physique coaching business. Before any exercise is chosen, you write the PROGRAMMING STRATEGY for one athlete's next cycle: who they are and what they're training for, what the previous program was designed to do and what actually happened, what stays, what changes and why, what gets priority, what gets reduced, how the cycle progresses, and how success will be judged.

${PROGRAMMING_METHOD[brain]}

Block structure guide: ${BLOCK_GUIDE[brain]}

${PROGRAMMING_RULES}

${EVIDENCE_RULES}
${opts.first ? `\n${FIRST_PROGRAM_RULES}\n- In the strategy: "previous_program" is { "intent": "None: first program", "outcome": "None" }; every decision is a hypothesis (no response measured yet) with its evidence from the setup; "data_limits" says what isn't known yet; "monitor" and the success criteria name what they must log so the next program can be built from it (loads and reps on the main lifts, RPE, workouts done, session length, anything that hurt).\n` : ""}
Decisions: each important decision is Observation → Evidence → Proposed change → Expected benefit → What to monitor. Include "keep" decisions too (keeping something that worked is a decision).

Reply with ONE JSON object and nothing else:
{
  "athlete_read": string (who they are, what they train for, their constraints; 3-5 sentences),
  "previous_program": { "intent": string, "outcome": string },
  "keep": [ { "item": string, "why": string, "evidence": [string] } ],
  "change": [ { "item": string, "why": string, "evidence": [string] } ],
  "prioritize": [ { "item": string, "why": string, "evidence": [string] } ],
  "reduce": [ { "item": string, "why": string, "evidence": [string] } ],
  "progression": { "model": string, "expected": string, "fatigue": string, "success_criteria": [string] },
  "structure": { "weeks": int, "days_per_week": int, "session_minutes": int|null, "blocks": [ { "name": string, "weeks": int, "objective": string, "phases": [ { "week": int, "phase": string } ] } ] },
  "weekly_layout": [ { "day": int, "title": string, "focus": string, "primary": [string], "notes": string } ],
  "frequency_targets": [ { "target": string (a lift or muscle), "per_week": number } ],
  "volume_targets": [ { "target": string, "sets_per_week": number, "vs_previous": string } ],
  "intensity": string (distribution and RPE / RIR targets),
  "exercise_plan": { "retain": [ { "exercise_id": string|null, "name": string, "why": string } ], "replace": [ { "exercise_id": string|null, "name": string, "with": string|null, "why": string } ], "add": [ { "name": string, "why": string } ] },
  "decisions": [ { "area": string, "observation": string, "evidence": [string], "change": string, "benefit": string, "monitor": string, "basis": "fact"|"hypothesis", "confidence": "high"|"medium"|"low" } ],
  "coach_requirements": [ { "requirement": string, "status": "met"|"conflict"|"not_applicable", "how": string } ],
  "conflicts": [ { "description": string, "resolution": string } ],
  "data_limits": [string],
  "monitor": [string]
}
"structure" must match the coach's setup (weeks, days per week; the blocks' weeks add up to the total). "weekly_layout" has exactly one entry per training day.`;
}

export function strategyUserPrompt(brief: string, setup: GenerationSetup, opts: { first?: boolean } = {}): string {
  return `Write the programming strategy for ${opts.first ? "their first" : "the next"} ${setup.weeks}-week, ${setup.daysPerWeek}-day program.

${brief}`;
}

export function constructSystemPrompt(brain: Brain, opts: { first?: boolean } = {}): string {
  return `You are the head coach's ${BRAIN_LABEL[brain]} programming brain at JF Effect. You build ONE training block of an athlete's next program, exactly to the approved strategy, as a complete, executable prescription for every week.

${PROGRAMMING_METHOD[brain]}

${PROGRAMMING_RULES}
${opts.first ? `\n${FIRST_PROGRAM_RULES}\n` : ""}
Building rules:
- Follow the approved strategy: its weekly layout, frequency and volume targets, exercises to keep / replace / add, intensity and progression model. Anything you can't follow, say why in the block's "objective".
- Exercises: use exercise_id values from the catalog (the athlete's own exercises first: they have demo videos; then library exercises marked "demo video"). Copy the id and name exactly. Only when nothing in the catalog fits, set exercise_id to null and give the exercise's standard name. Never invent ids.
- Only use exercises the athlete's equipment allows, and follow every equipment rule (stations, one cable column, adjustable dumbbells, shared attachments). Order each session as a sensible flow: main lift first, then by station, finishing one station before the next. Keep each session within the time limit.
- Supersets save time without cutting work: when a session is tight, pair accessories as "A1" / "A2" (same letter, next to each other; a push with a pull, an upper with a lower, or a small muscle beside a big one) on stations that don't clash: never two cable exercises on one column, two exercises needing the bench at different angles, one barbell loaded two ways, or two different weights on adjustable dumbbells. Never pair the day's main lift; its sets keep their full rest. The rest_seconds of the first exercise in a pair is the short rest before its partner; the last one's is the rest before the next round. The athlete reads who an exercise is paired with.
- Top sets and back-offs are separate exercises: e.g. role "Primary Squat" (the top set) and "Primary Squat Backoff" (the back-off sets) on the same exercise_id. Other roles: "Secondary <Lift>", "Accessory", "Primary" / "Secondary" for non-competition work.
- Prescribe every exercise: sets, reps ("5", "8-10", "AMRAP"), an effort target (rpe like "7" or "7-8", or rir), rest_seconds, tempo / pauses when it matters, "progression" (a conditional rule, e.g. "When all sets reach 10 reps at RPE ≤8, add 2.5 kg"), up to 3 "substitutions" from the catalog the athlete can swap to, and short notes the athlete reads (cues, station, setup).
- Use "percentage" (of estimated 1RM) only for lifts with a reliable reference in the load references; otherwise use RPE. Never prescribe reps a percentage can't allow.
- Weekly prescriptions: give the base prescription and a "weeks" entry for every week that differs (sets, reps, rpe, rir, percentage, notes). Progress conditionally and sensibly for the training model; no fake progression (the same percentage added every week regardless of the model). Plan any deload or lighter week the strategy calls for.
- Loads: use the load references to set the starting point in the notes when helpful (e.g. "start ~5 kg under last block's top set"), never as invented past results.

Reply with ONE JSON object for this block and nothing else:
{ "name": string, "objective": string, "weeks": int, "week_phases": [ { "week": int, "phase": string } ], "deload_rule": string|null, "progression_rules": [string],
  "days": [ { "day": int, "title": string, "focus": string,
    "exercises": [ { "exercise_id": string|null, "exercise_name": string, "role": string, "station": string|null, "superset": string|null,
      "sets": int, "reps": string, "rpe": string|null, "rir": string|null, "percentage": number|null, "rest_seconds": int, "tempo": string|null,
      "progression": string, "substitutions": [ { "exercise_id": string|null, "exercise_name": string } ], "notes": string|null,
      "weeks": [ { "week": int, "sets": int?, "reps": string?, "rpe": string?, "rir": string?, "percentage": number?, "notes": string? } ] } ] } ] }
"days" has exactly one entry per training day, in order. At most 12 exercises a day.`;
}

export function constructUserPrompt(x: {
  brief: string;
  setup: GenerationSetup;
  strategy: Strategy;
  blockIndex: number;
  previousBlocks: BuiltBlock[];
  loadRefs: string;
  athleteCatalog: CatalogExercise[];
  libraryCatalog: CatalogExercise[];
  catalogText: (l: CatalogExercise[]) => string;
}): string {
  const b = x.strategy.structure.blocks[x.blockIndex];
  const before = x.previousBlocks.length
    ? x.previousBlocks
        .map((pb, i) => `Block ${i + 1} "${pb.name}" (${pb.weeks} wk), last week's prescriptions:\n${pb.days.map((d) => `  ${d.title}: ${d.exercises.map((e) => { const w = (e.weeks ?? []).find((q) => q.week === pb.weeks) ?? {}; return `${e.exercise_name} ${(w as any).sets ?? e.sets}×${(w as any).reps ?? e.reps}${(w as any).rpe ?? e.rpe ? ` @${(w as any).rpe ?? e.rpe}` : ""}`; }).join(", ")}`).join("\n")}`)
        .join("\n")
    : "This is the first block.";
  return [
    `## Build block ${x.blockIndex + 1} of ${x.strategy.structure.blocks.length}: "${b.name}", ${b.weeks} weeks`,
    `Objective: ${b.objective}`,
    b.phases.length ? `Phases: ${b.phases.map((p) => `W${p.week} ${p.phase}`).join(", ")}` : "",
    `Training days: ${x.setup.daysPerWeek} a week${x.setup.trainingDays.length ? ` (${x.setup.trainingDays.join(", ")})` : ""} · target session ${x.setup.sessionMinutes ?? "—"} min, maximum ${x.setup.maxSessionMinutes ?? "—"} min`,
    x.setup.cardio?.trainingDay
      ? `Cardio: the app adds ${x.setup.cardio.trainingDay.type} ${x.setup.cardio.trainingDay.minutes} min after every workout (the client's cardio plan). The lifting fits ${x.setup.sessionMinutes ?? "the session"} min on its own; write NO cardio rows.`
      : `Cardio: none after lifting; write NO cardio rows (any cardio lives in the client's cardio plan).`,
    ``,
    `## Blocks already built (continue their progression)`,
    before,
    ``,
    `## The approved strategy`,
    JSON.stringify(x.strategy, null, 1),
    ``,
    `## Load references (latest sets of each exercise)`,
    x.loadRefs,
    ``,
    `## Exercise catalog: the athlete's own exercises (id | name | family | muscle | equipment | what happened)`,
    x.catalogText(x.athleteCatalog) || "(none)",
    ``,
    `## Exercise catalog: library exercises their equipment allows (id | name | family | muscle | equipment | "demo video" when it has one)`,
    x.catalogText(x.libraryCatalog),
    ``,
    `## Athlete brief`,
    x.brief,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function repairUserPrompt(x: { block: BuiltBlock; blockIndex: number; issues: string[]; setup: GenerationSetup; athleteCatalog: CatalogExercise[]; libraryCatalog: CatalogExercise[]; catalogText: (l: CatalogExercise[]) => string; equipmentRules: string[] }): string {
  return [
    `The quality audit found problems in block ${x.blockIndex + 1}. Fix ONLY these problems; keep everything else in the block exactly as it is (same exercises, order and prescriptions where they weren't flagged). Reply with the whole corrected block in the same JSON shape.`,
    ``,
    `## Problems to fix`,
    ...x.issues.map((i) => `- ${i}`),
    ``,
    `## Constraints`,
    `- ${x.setup.daysPerWeek} days a week, ${x.setup.weeks} weeks in the program; this block has ${x.block.weeks} weeks.`,
    `- Session maximum: ${x.setup.maxSessionMinutes ?? x.setup.sessionMinutes ?? "—"} minutes${x.setup.cardio?.trainingDay ? `, including the ${x.setup.cardio.trainingDay.minutes}-min cardio the app adds after the lifting` : ""}.`,
    `- No walking, treadmill, bike or other steady cardio in the workouts: that's the client's cardio plan.`,
    `- Every exercise and substitution meets the exercise standard: no landmine / plate / kettlebell isolation, combos, twists, wall sits or unstable surfaces.`,
    `- Excluded exercises: ${x.setup.excluded.map((e) => e.name).join(", ") || "none"}; required: ${x.setup.required.map((e) => e.name).join(", ") || "none"}.`,
    ...x.equipmentRules.map((r) => `- ${r}`),
    ``,
    `## The block`,
    JSON.stringify(x.block, null, 1),
    ``,
    `## Exercise catalog: the athlete's own exercises`,
    x.catalogText(x.athleteCatalog) || "(none)",
    ``,
    `## Exercise catalog: library exercises their equipment allows`,
    x.catalogText(x.libraryCatalog),
  ].join("\n");
}
