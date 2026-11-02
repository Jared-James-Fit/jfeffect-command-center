/**
 * The programming frameworks ("brains") in words: how each one reads an
 * athlete's records and how it designs the next cycle. Shared by the report,
 * the copied AI prompt and every stage of Generate Next Program, so the coach
 * sees one method everywhere. These are methods, not conclusions: every
 * decision still has to come from this athlete's own records.
 */
import { BRAIN_LABEL, type Brain } from "./types";

export const BRAIN_SUMMARY: Record<Brain, string> = {
  powerlifting: `${BRAIN_LABEL.powerlifting}: squat, bench and deadlift read separately: competition specificity, top sets and back-offs, RPE accuracy, estimated strength, frequency, variation usefulness, fatigue, periodization and peaking.`,
  bodybuilding: `${BRAIN_LABEL.bodybuilding}: hard sets per muscle group, frequency, exercise selection and biomechanics, load and rep progression, proximity to failure, recovery, physique priorities and adherence.`,
  powerbuilding: `${BRAIN_LABEL.powerbuilding}: the main lifts for strength (each one separately) and every muscle group for size, with the fatigue between them managed.`,
  general_strength: `${BRAIN_LABEL.general_strength}: getting stronger on the main barbell (or dumbbell) patterns without a platform to peak for: lift-by-lift progression, sensible frequency and volume, accessories for weak links.`,
  general_fitness: `${BRAIN_LABEL.general_fitness}: consistency, balance and steady progression on the main exercises, with muscle volume as context.`,
  hybrid: `${BRAIN_LABEL.hybrid}: strength and conditioning (or sport) qualities together, with the interference between them managed and the session order planned.`,
  other: `${BRAIN_LABEL.other}: programmed to the coach's stated goal, with the same evidence rules.`,
};

/** How each brain reads the records (analysis). */
export const ANALYSIS_METHOD: Record<Brain, string> = {
  powerlifting: `Analyze squat, bench press and deadlift independently. For each: competition-lift frequency and the frequency of secondary / tertiary variations, weekly working sets, top-set performance, back-off volume and completion, RPE and intensity distribution, estimated 1RM trend, velocity when logged, which variations coincided with progress (an association, not proof of transfer), squat-deadlift fatigue interaction, bench exposure spacing, bodyweight change, consistency, recovery reports and the competition timeline.`,
  bodybuilding: `Analyze hypertrophy variables: direct and indirect hard sets per muscle group per week, muscle frequency, exercise-specific load / rep progression, rep-range distribution, proximity to failure (RPE / RIR where logged), session-level fatigue, exercise order, recovery and pain reports, equipment limits, preferences, time efficiency, adherence, bodyweight trend and the physique priorities in their goals.`,
  powerbuilding: `Read both ways: the main lifts lift by lift for strength (frequency, top sets, back-offs, RPE accuracy, e1RM trend, variations, fatigue) and every muscle group for hypertrophy (hard sets, frequency, exercise progression, proximity to failure). Watch the interference: where accessory volume coincided with the main lifts slowing, and the reverse.`,
  general_strength: `Analyze each main pattern (squat, hinge, press, pull) lift by lift: load and rep progression, frequency, weekly sets, effort, and which accessories coincided with progress; then adherence, session length and recovery.`,
  general_fitness: `Prioritize adherence, sustainable frequency and session length, balanced muscle volume (push / pull, upper / lower), steady load or rep progression on the main exercises, conditioning if it was programmed, recovery and enjoyment.`,
  hybrid: `Analyze strength progression on the main lifts and the conditioning / athletic work side by side: frequency and volume of each, whether strength stalled during heavy conditioning weeks (an association), session order, recovery reports and adherence.`,
  other: `Read the records against the coach's stated goal: adherence, progression on the exercises that serve it, effort, recovery and anything the goal depends on that the records don't hold.`,
};

/** How each brain designs the next cycle (programming). */
export const PROGRAMMING_METHOD: Record<Brain, string> = {
  powerlifting: `POWERLIFTING. Think like an elite powerlifting coach. Program squat, bench and deadlift independently from how each one actually responded; never impose a generic rule (e.g. "bench 3×/week") unless this athlete's history and schedule make it the most defensible choice. Decide each lift's frequency, its primary and secondary exposures, weekly working sets, top-set + back-off structure and intensity distribution from the evidence: a lift that progressed keeps its effective dose and progresses it; a lift that stalled changes the smallest variable that the evidence points to (frequency, volume, intensity or variation), not everything at once. Use variations only when they solve a specific problem (a sticking point, technique, tolerance). Manage fatigue between squat and deadlift exposures and space bench exposures. Use RPE targets, or % of a reliable estimated 1RM. Periodize to the timeline: accumulation → intensification → realization, with a peak and taper (heavy singles, reduced volume) only when a meet is on file.`,
  bodybuilding: `BODYBUILDING / HYPERTROPHY. Think like an evidence-based hypertrophy coach. Set weekly hard sets per muscle from what this athlete progressed on and recovered from; do not raise volume just because they progressed: first judge whether the previous effective dose can keep working. Give priority muscles more sets or frequency and hold the rest. Choose stable, loadable exercises with a good resistance profile and full range (lengthened loading where possible), keep the exercises that progressed, rotate ones that stalled or caused discomfort, order heavier compound work before isolation, keep most work in 5–30 reps with a double progression (reps, then load) at RPE 7–9 (1–3 RIR), and plan a deload or reassessment when fatigue, stalled lifts or pain reports build. Respect time and equipment.`,
  powerbuilding: `POWERBUILDING. Prioritize the main strength lifts (each one programmed independently from its own response, with top sets / back-offs at RPE targets) and distribute enough hypertrophy work across the relevant muscle groups (hard sets per muscle, frequency, exercise progression, proximity to failure). Put the strength work first in the session, avoid accessory volume that blunts the main lifts, and keep the total workload recoverable within the session-length limit.`,
  general_strength: `GENERAL STRENGTH. Build strength on the main patterns (squat, hinge, press, pull) without forcing competition specificity: a primary lift per session, double or load progression at RPE 6–8.5, 1–3 exposures a week per pattern based on what worked, accessories that address weak links, and a lighter week when fatigue accumulates.`,
  general_fitness: `GENERAL FITNESS. A program they will actually do: match their days and session length, balance push / pull / legs / core (and conditioning when it fits their goal), steady double progression on the main exercises, moderate effort (RPE 6–8), and keep exercises they did consistently.`,
  hybrid: `HYBRID / ATHLETIC. Program strength and conditioning (or sport) qualities together: decide which quality leads each session and each week, separate hard lower-body strength work from hard conditioning where possible, order power / speed before strength before conditioning within a session, keep strength volume moderate when conditioning volume is high, and progress each quality on its own terms.`,
  other: `GOAL-SPECIFIC. Program to the coach's stated goal and constraints, using the general rules: progress what worked, change what didn't for a reason the records support, respect the schedule, equipment and recovery, and explain every decision.`,
};

/** How the next cycle's blocks are usually organized by each brain (a starting point the strategy may change for a reason). */
export const BLOCK_GUIDE: Record<Brain, string> = {
  powerlifting: `Meet on file: accumulation → intensification → realization / peak and taper, the last 1–3 weeks reducing volume with heavy singles; no meet: accumulation → intensification, optionally a test or pivot week. Block lengths follow this athlete's previous block responses, not a fixed 4 weeks.`,
  bodybuilding: `One stable training structure (same exercises, progressive overload) for as long as the exercises keep progressing, usually 4–8 weeks, ending in a deload or reassessment week when fatigue or stalls build; no forced phase changes.`,
  powerbuilding: `A strength-emphasis structure with hypertrophy accessories that stay mostly stable; intensify the main lifts across the weeks while accessory exercises progress by double progression; deload when fatigue accumulates.`,
  general_strength: `One or two blocks: a volume-leaning block then an intensity-leaning block, or one block with weekly load progression and a lighter final week.`,
  general_fitness: `One block with the same sessions repeated and progressed, reassessed at the end.`,
  hybrid: `Blocks that set which quality leads (strength or conditioning) while the other is maintained; deload both together.`,
  other: `As the goal requires; explain the structure.`,
};
