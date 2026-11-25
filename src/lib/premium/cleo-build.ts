/**
 * Build with Cleo (Premium, T01): a program drafted from the member's own
 * profile (goal, experience, the days they train), put in the program builder
 * as an unsaved draft, so every exercise, set and week can be changed before
 * they save or start it. Deterministic and pure (tested in premium.test.ts):
 * the same answers always give the same program, every exercise is one found
 * in the library by name (never invented), and anything it can't find is
 * said, not guessed.
 */
import type { ProgramDraft, ProgramGoal, ProgramLevel } from "@/lib/athlete-programs";
import { makeKey, type PlanDay, type PlanExercise, type ProgramPlan } from "@/lib/program-plan";

export type CleoBrief = { goal: ProgramGoal; level: ProgramLevel; days: number; weeks: number };

/** The profile the member gave at setup (app_members), read into a brief. */
export function briefFromProfile(p: {
  goals_tags?: string[] | null;
  experience_level?: string | null;
  committed_training_days?: string[] | null;
}): CleoBrief {
  const tags = (p.goals_tags ?? []).map((t) => t.toLowerCase());
  const goal: ProgramGoal = tags.some((t) => t.includes("powerlifting"))
    ? "powerlifting"
    : tags.some((t) => t.includes("stronger"))
      ? "strength"
      : tags.some((t) => t.includes("muscle") || t.includes("bodybuilding"))
        ? "muscle"
        : tags.some((t) => t.includes("fat") || t.includes("back in shape"))
          ? "fat_loss"
          : tags.some((t) => t.includes("athletic"))
            ? "athletic"
            : "general";
  const xp = String(p.experience_level ?? "");
  const level: ProgramLevel = xp === "advanced" ? "advanced" : xp === "intermediate" ? "intermediate" : "beginner";
  const n = (p.committed_training_days ?? []).length;
  const days = Math.min(5, Math.max(2, n || 3));
  return { goal, level, days, weeks: 8 };
}

type Slot = { names: string[]; sets: number; reps: string; main?: boolean };
type DayPlan = { title: string; focus: string; slots: Slot[] };

const SQUAT: Slot = { names: ["Back Squat", "Barbell Back Squat", "Squat"], sets: 4, reps: "5", main: true };
const BENCH: Slot = { names: ["Bench Press", "Barbell Bench Press"], sets: 4, reps: "5", main: true };
const DEAD: Slot = { names: ["Deadlift", "Conventional Deadlift", "Barbell Deadlift"], sets: 3, reps: "4", main: true };
const OHP: Slot = { names: ["Overhead Press", "Barbell Overhead Press"], sets: 3, reps: "6-8" };
const ROW: Slot = { names: ["Barbell Row", "Seated Cable Row", "Dumbbell Row"], sets: 3, reps: "8-10" };
const PULL: Slot = { names: ["Lat Pulldown", "Pull-Up"], sets: 3, reps: "8-12" };
const RDL: Slot = { names: ["Romanian Deadlift", "Barbell Romanian Deadlift"], sets: 3, reps: "8-10" };
const LEGPRESS: Slot = { names: ["Leg Press"], sets: 3, reps: "10-12" };
const DBBENCH: Slot = { names: ["Dumbbell Bench Press", "Incline Dumbbell Press"], sets: 3, reps: "8-12" };
const CURL: Slot = { names: ["Leg Curl", "Lying Leg Curl", "Seated Leg Curl"], sets: 3, reps: "10-12" };
const LATERAL: Slot = { names: ["Lateral Raise", "Dumbbell Lateral Raise"], sets: 3, reps: "12-15" };
const PLANK: Slot = { names: ["Plank"], sets: 3, reps: "30-45 s" };

const hyp = (s: Slot): Slot => ({ ...s, sets: 3, reps: s.main ? "6-8" : s.reps, main: s.main });

function template(goal: ProgramGoal, days: number): DayPlan[] {
  const strength = goal === "strength" || goal === "powerlifting";
  if (strength) {
    const a: DayPlan = { title: "Squat + Bench", focus: "Strength", slots: [SQUAT, BENCH, ROW, PLANK] };
    const b: DayPlan = { title: "Deadlift + Press", focus: "Strength", slots: [DEAD, OHP, PULL, CURL] };
    const c: DayPlan = { title: "Bench + Squat volume", focus: "Strength", slots: [{ ...BENCH, sets: 3, reps: "6-8" }, { ...SQUAT, sets: 3, reps: "6-8" }, RDL, LATERAL] };
    return [a, b, c, a, b].slice(0, days).map((d, i) => ({ ...d, title: i >= 3 ? `${d.title} (2)` : d.title }));
  }
  if (goal === "muscle") {
    const upper: DayPlan = { title: "Upper", focus: "Hypertrophy", slots: [hyp(BENCH), ROW, OHP, PULL, LATERAL] };
    const lower: DayPlan = { title: "Lower", focus: "Hypertrophy", slots: [hyp(SQUAT), RDL, LEGPRESS, CURL, PLANK] };
    const full: DayPlan = { title: "Full body", focus: "Hypertrophy", slots: [hyp(SQUAT), DBBENCH, PULL, RDL, LATERAL] };
    const order = days === 3 ? [full, upper, lower] : [upper, lower, upper, lower, full];
    return order.slice(0, days).map((d, i, all) => ({ ...d, title: all.slice(0, i).some((x) => x.title === d.title) ? `${d.title} (2)` : d.title }));
  }
  // fat loss, general, athletic: full-body days, moderate reps
  const a: DayPlan = { title: "Full body A", focus: "General", slots: [hyp(SQUAT), DBBENCH, ROW, PLANK] };
  const b: DayPlan = { title: "Full body B", focus: "General", slots: [RDL, OHP, PULL, LEGPRESS] };
  return [a, b, a, b, a].slice(0, days).map((d, i) => ({ ...d, title: i >= 2 ? `${d.title} (${Math.floor(i / 2) + 1})` : d.title }));
}

export type LibraryExercise = { id: string; name: string; muscle_group?: string | null; equipment?: string | null };

/** The library exercise for a slot: an exact name first, then the shortest name containing it. */
export function findExercise(library: readonly LibraryExercise[], names: readonly string[]): LibraryExercise | null {
  const norm = (s: string) => s.trim().toLowerCase();
  for (const n of names) {
    const hit = library.find((e) => norm(e.name) === norm(n));
    if (hit) return hit;
  }
  for (const n of names) {
    const hits = library.filter((e) => norm(e.name).includes(norm(n))).sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    if (hits[0]) return hits[0];
  }
  return null;
}

/** The effort for a week: builds through each 4-week wave, the 4th lighter. */
export function weekEffort(week: number, main: boolean, level: ProgramLevel): { rpe: string; setsDelta: number } {
  const inWave = week % 4; // 0,1,2 build; 3 lighter
  if (inWave === 3) return { rpe: "6", setsDelta: -1 };
  const base = level === "beginner" ? 6.5 : 7;
  const rpe = Math.min(main ? 9 : 8.5, base + inWave * 0.5 + (main ? 0.5 : 0));
  return { rpe: String(rpe), setsDelta: 0 };
}

const GOAL_WORDS: Record<ProgramGoal, string> = {
  strength: "getting stronger",
  powerlifting: "powerlifting",
  muscle: "building muscle",
  fat_loss: "losing fat",
  general: "general fitness",
  athletic: "athletic performance",
};

/** The draft, and the exercises it couldn't find in the library (said to the member). */
export function buildCleoDraft(brief: CleoBrief, library: readonly LibraryExercise[]): { draft: ProgramDraft; missing: string[] } {
  const days = template(brief.goal, Math.min(5, Math.max(2, brief.days)));
  const weeks = Math.min(16, Math.max(4, brief.weeks));
  const missing = new Set<string>();
  // one key per day and exercise across every week, so the builder keeps the weeks in step
  const skeleton = days.map((d) => ({
    key: makeKey(),
    title: d.title,
    focus: d.focus,
    rows: d.slots
      .map((s) => {
        const ex = findExercise(library, s.names);
        if (!ex) missing.add(s.names[0]!);
        return ex ? { key: makeKey(), slot: s, ex } : null;
      })
      .filter((r): r is { key: string; slot: Slot; ex: LibraryExercise } => !!r),
  }));
  const plan: ProgramPlan = {
    v: 1,
    blocks: [
      {
        key: makeKey(),
        name: "Block 1",
        weeks: Array.from({ length: weeks }, (_, w) => ({
          key: makeKey(),
          days: skeleton.map(
            (d): PlanDay => ({
              key: d.key,
              title: d.title,
              focus: d.focus,
              exercises: d.rows.map((r): PlanExercise => {
                const e = weekEffort(w, !!r.slot.main, brief.level);
                return {
                  key: r.key,
                  exercise_id: r.ex.id,
                  name: r.ex.name,
                  muscle_group: r.ex.muscle_group ?? null,
                  equipment: r.ex.equipment ?? null,
                  sets: Math.max(1, r.slot.sets + e.setsDelta),
                  reps: r.slot.reps,
                  rpe: r.slot.reps.endsWith("s") ? null : e.rpe,
                  rir: null,
                  load: null,
                  unit: null,
                  pct: null,
                  pct_of: null,
                  rest_seconds: r.slot.main ? 180 : 90,
                  tempo: null,
                  notes: null,
                };
              }),
            }),
          ),
        })),
      },
    ],
  };
  const draft: ProgramDraft = {
    id: null,
    title: `${brief.days}-day ${GOAL_WORDS[brief.goal]} plan`.replace(/^./, (c) => c.toUpperCase()),
    description: `Drafted with Cleo from your goal (${GOAL_WORDS[brief.goal]}), experience (${brief.level}) and ${brief.days} training days a week. Every 4th week is lighter. Change anything before you start it.`,
    goal: brief.goal,
    level: brief.level,
    plan,
  };
  return { draft, missing: [...missing] };
}
