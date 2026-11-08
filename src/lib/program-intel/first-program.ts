/**
 * A first program: no training logged yet, so everything comes from what the
 * client told you when they set up their account (Goals & Setup): how long
 * they've trained, the goal and training styles they picked, their days,
 * session length, equipment and injuries. From those, the framework their
 * goal points to and an evidence-based starting dose for that framework and
 * level (hard sets per muscle, lift sets, frequency, rep ranges, effort,
 * progression), fitted to the time they have. Every number is a starting
 * point the next program corrects from what they log. Deterministic.
 */
import { levelFromYears, trainingYears } from "./athlete-development";
import type { Brain } from "./types";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced";
export const LEVEL_LABEL: Record<ExperienceLevel, string> = { beginner: "beginner", intermediate: "intermediate", advanced: "advanced" };

/**
 * Goals & Setup's answer read as a level: under a year is a beginner, 1–5 years
 * an intermediate, more than 5 an advanced lifter (older free-text answers too).
 */
export function experienceLevel(raw: string | null | undefined): ExperienceLevel | null {
  const t = String(raw ?? "").toLowerCase().replace(/[–—]/g, "-").trim();
  if (!t) return null;
  if (/beginner|novice|less than (1|one)|under (a|1|one) year|never|brand new|just start|few months|<\s*1|\b0\s*-\s*1\b/.test(t)) return "beginner";
  if (/more than 5|over 5|5\+|advanced|elite|\b(6|7|8|9|10)\+?\s*years?/.test(t)) return "advanced";
  if (/intermediate|1\s*-\s*3|3\s*-\s*5|\b[1-5]\+?\s*years?/.test(t)) return "intermediate";
  // a number the patterns above don't cover ("14 years", "8 months")
  return levelFromYears(trainingYears(raw));
}

/** What they said in Goals & Setup's last question ("anything else?"), unless it says nothing. */
export function setupNotes(raw: string | null | undefined): string | null {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (/^(none|no|nope|na|n\/a|nah|nothing|no( other)? (concerns?|questions?|comments?)|not really|all good|-+|\.)[.!]*$/i.test(t)) return null;
  return t.slice(0, 600);
}

/**
 * The framework a stated goal points to, for an athlete with no training on
 * file (with training on file the program itself is read instead). The main
 * goal leads; the training styles they picked settle what it leaves open
 * ("Coach can decide" and "At-home workouts" say nothing about it).
 */
export function goalBrain(g: { main: string | null; other?: string | null; target?: string | null; styles?: string[] }, level: ExperienceLevel | null): { brain: Brain; why: string } | null {
  const styles = new Set((g.styles ?? []).map((s) => s.toLowerCase().trim()));
  const text = [g.main, g.other, g.target].filter(Boolean).join(" ").toLowerCase();
  const pl = styles.has("powerlifting") || /powerlift|\bmeet\b|\bipf\b|\bcpu\b|\bnapf\b|\bcpf\b|\bsbd\b/.test(text);
  const bb = styles.has("bodybuilding") || styles.has("glute-focused") || /bodybuild|physique|bikini|\bstage\b|\bshow\b/.test(text);
  const st = styles.has("strength");
  const trained = level != null && level !== "beginner";
  const main = String(g.main ?? "").toLowerCase().trim();
  const said = g.main ? `their goal is "${g.main}"` : "no main goal";
  const pickedStyles = [...styles].filter((s) => s !== "coach can decide" && s !== "at-home workouts");
  const andStyles = pickedStyles.length ? ` with ${pickedStyles.join(", ")} as their styles` : "";
  if (main === "powerlifting") return { brain: "powerlifting", why: `${said}` };
  if (main === "prepare for a competition") {
    if (pl) return { brain: "powerlifting", why: `${said} and it's a powerlifting meet${andStyles}` };
    if (bb) return { brain: "bodybuilding", why: `${said}, a physique show${andStyles}` };
    return null;
  }
  if (main === "build muscle" || main === "build glutes" || main === "body recomposition") {
    if (trained && (st || pl)) return { brain: "powerbuilding", why: `${said}${andStyles}, after more than a year of training` };
    return { brain: "bodybuilding", why: said };
  }
  if (main === "get stronger") return bb ? { brain: "powerbuilding", why: `${said}${andStyles}` } : { brain: "general_strength", why: said };
  if (main === "lose body fat" || main === "improve general fitness") {
    // fat loss for someone who's trained a while is muscle kept with strength / hypertrophy work
    if (!trained) return { brain: "general_fitness", why: `${said} and they're ${level ? "new to training" : "not on file as experienced"}` };
    if (bb && (st || pl)) return { brain: "powerbuilding", why: `${said}${andStyles}: keep their strength and muscle while they lean out` };
    if (bb) return { brain: "bodybuilding", why: `${said}${andStyles}: keep their muscle while they lean out` };
    if (st || pl) return { brain: "general_strength", why: `${said}${andStyles}: keep their strength while they lean out` };
    return { brain: "general_fitness", why: said };
  }
  // "Other", or no goal: the styles they picked
  if (bb && (st || pl)) return { brain: "powerbuilding", why: `their styles: ${pickedStyles.join(", ")}` };
  if (bb) return { brain: "bodybuilding", why: `their styles: ${pickedStyles.join(", ")}` };
  if (pl) return { brain: "powerlifting", why: `their styles: ${pickedStyles.join(", ")}` };
  if (st) return { brain: "general_strength", why: `their styles: ${pickedStyles.join(", ")}` };
  if (styles.has("general fitness")) return { brain: "general_fitness", why: "their styles: general fitness" };
  return null;
}

/** Muscle groups a first program sets weekly hard sets for (the audit's own names). */
const MAJOR = ["Chest", "Quads", "Hamstrings", "Glutes"] as const;
const PULL = ["Back", "Lats"] as const;
const MINOR = ["Shoulders", "Biceps", "Triceps", "Calves"] as const;
/** Weekly hard sets per muscle to start from (secondary muscles count half), by level. */
export const MUSCLE_DOSE: Record<ExperienceLevel, { major: number; pull: number; minor: number }> = {
  beginner: { major: 8, pull: 6, minor: 6 },
  intermediate: { major: 12, pull: 9, minor: 8 },
  advanced: { major: 14, pull: 11, minor: 10 },
};
/** Weekly working sets on the main lifts to start from, by level. */
export const LIFT_DOSE: Record<ExperienceLevel, { Squat: number; Bench: number; Deadlift: number }> = {
  beginner: { Squat: 6, Bench: 6, Deadlift: 3 },
  intermediate: { Squat: 9, Bench: 10, Deadlift: 5 },
  advanced: { Squat: 12, Bench: 14, Deadlift: 6 },
};
const MUSCLE_SHARE: Partial<Record<Brain, number>> = { bodybuilding: 1, powerbuilding: 0.85, general_strength: 0.75, general_fitness: 0.75, hybrid: 0.7, other: 0.75 };
const LIFT_SHARE: Partial<Record<Brain, number>> = { powerlifting: 1, powerbuilding: 0.8, general_strength: 0.8 };
/** Words a goal uses for a body part, as the muscle groups the program counts. */
export const PRIORITY_GROUPS: Record<string, string[]> = {
  arms: ["Biceps", "Triceps"],
  legs: ["Quads", "Hamstrings", "Glutes"],
  back: ["Back", "Lats"],
  chest: ["Chest"],
  shoulders: ["Shoulders"],
  glutes: ["Glutes"],
  biceps: ["Biceps"],
  triceps: ["Triceps"],
  calves: ["Calves"],
  quads: ["Quads"],
  hamstrings: ["Hamstrings"],
};
/** About how long a working set takes with its rest and moving between exercises, in a session that pairs its accessories. */
const MINUTES_PER_SET = 2.6;
/** One working set of a compound counts toward about this many muscle targets (its secondary muscles at half). */
const CREDITS_PER_SET = 1.4;

export type StartingDose = {
  frequency: Array<{ target: string; perWeek: number }>;
  volume: Array<{ target: string; setsPerWeek: number }>;
  intensity: string;
  effort: string;
  progression: string;
  /** How many working sets the week needs, and how many fit their days and minutes. */
  fit: { needed: number; fits: number; scaled: number | null };
};

/**
 * Where a first program starts: hard sets per muscle and lift sets for the
 * framework and level (priorities a little more), each major muscle and the
 * squat and bench twice a week (the deadlift once) when the days allow it,
 * rep ranges, effort and progression for their level, and the week scaled
 * down when it wouldn't fit their days and lifting minutes.
 */
export function startingDose(x: {
  brain: Brain;
  level: ExperienceLevel | null;
  days: number;
  liftingMinutes: number | null;
  priorities: string[];
  maxesOnFile: boolean;
}): StartingDose {
  const level = x.level ?? "beginner";
  const days = Math.max(1, x.days);
  const prio = new Set(x.priorities.flatMap((p) => PRIORITY_GROUPS[p.toLowerCase()] ?? [p]).map((p) => p.toLowerCase()));
  const bump = level === "beginner" ? 2 : 4;
  const volume: StartingDose["volume"] = [];
  const frequency: StartingDose["frequency"] = [];
  const share = MUSCLE_SHARE[x.brain];
  if (share) {
    const d = MUSCLE_DOSE[level];
    const add = (names: readonly string[], base: number, often: number) => {
      for (const m of names) {
        const p = prio.has(m.toLowerCase());
        volume.push({ target: m, setsPerWeek: Math.max(3, Math.round(base * share) + (p ? bump : 0)) });
        frequency.push({ target: m, perWeek: Math.min(days, p ? Math.max(2, often) : often) });
      }
    };
    add(MAJOR, d.major, 2);
    add(PULL, d.pull, 2);
    add(MINOR, d.minor, days >= 4 ? 2 : 1);
  }
  const lshare = LIFT_SHARE[x.brain];
  if (lshare) {
    const d = LIFT_DOSE[level];
    for (const lift of ["Squat", "Bench", "Deadlift"] as const) {
      const p = prio.has(lift.toLowerCase());
      volume.push({ target: lift, setsPerWeek: Math.max(2, Math.round(d[lift] * lshare) + (p ? 2 : 0)) });
      const often = lift === "Deadlift" ? (level === "advanced" && x.brain === "powerlifting" && days >= 4 ? 2 : 1) : level === "advanced" && lift === "Bench" && x.brain === "powerlifting" && days >= 4 ? 3 : 2;
      frequency.push({ target: lift, perWeek: Math.min(days, p ? Math.max(often, 2) : often) });
    }
  }

  // fit the week to their time: scale the muscle targets down (never below 60%) when it wouldn't fit
  const fits = x.liftingMinutes ? Math.floor(Math.max(0, x.liftingMinutes - 8) / MINUTES_PER_SET) * days : Infinity;
  const muscleNeeds = volume.filter((v) => !["Squat", "Bench", "Deadlift"].includes(v.target)).reduce((n, v) => n + v.setsPerWeek, 0) / CREDITS_PER_SET;
  const liftNeeds = share ? 0 : volume.filter((v) => ["Squat", "Bench", "Deadlift"].includes(v.target)).reduce((n, v) => n + v.setsPerWeek, 0) * 1.6; // a powerlifter's accessories on top
  const needed = Math.round(muscleNeeds + liftNeeds);
  let scaled: number | null = null;
  if (Number.isFinite(fits) && needed > fits && needed > 0) {
    scaled = Math.max(0.6, fits / needed);
    for (const v of volume) v.setsPerWeek = Math.max(["Squat", "Bench", "Deadlift"].includes(v.target) ? 2 : 3, Math.round(v.setsPerWeek * scaled));
    scaled = Math.round(scaled * 100) / 100;
  }

  const noLoads = x.maxesOnFile ? "percentages only for a lift with a max on file" : "no percentages: no maxes or logged loads on file yet";
  const reps: Record<Brain, Record<ExperienceLevel, string>> = {
    bodybuilding: { beginner: "Compounds 8–12 reps, isolation 10–15", intermediate: "Compounds 6–10 reps, isolation 8–15 (lengthened-bias work 12–20)", advanced: "Compounds 5–10 reps, isolation 8–20" },
    powerbuilding: { beginner: "Main lifts 5–8 reps, accessories 8–15", intermediate: "Main lifts 4–6 reps (top set + back-offs), accessories 8–15", advanced: "Main lifts 3–6 reps (top set + back-offs), accessories 6–15" },
    general_strength: { beginner: "Main lifts 5–8 reps, accessories 8–12", intermediate: "Main lifts 3–6 reps, accessories 8–12", advanced: "Main lifts 2–5 reps, accessories 6–12" },
    powerlifting: { beginner: "Competition lifts 4–6 reps, no singles yet; variations 6–8", intermediate: "Top sets 3–5 reps + back-offs; variations 5–8", advanced: "Top sets 1–5 reps + back-offs; variations 3–8" },
    general_fitness: { beginner: "Main exercises 8–12 reps, accessories 10–15", intermediate: "Main exercises 6–10 reps, accessories 10–15", advanced: "Main exercises 5–10 reps, accessories 8–15" },
    hybrid: { beginner: "Strength 6–10 reps, accessories 10–15", intermediate: "Strength 4–8 reps, accessories 8–15", advanced: "Strength 3–6 reps, accessories 8–12" },
    other: { beginner: "Main exercises 8–12 reps, accessories 10–15", intermediate: "Main exercises 6–10 reps, accessories 8–15", advanced: "Main exercises 5–10 reps, accessories 8–15" },
  };
  const effort: Record<ExperienceLevel, string> = {
    beginner: "Week 1 at RPE 6–7 (3–4 reps left) to find working weights and learn the lifts, then RPE 7–8; isolation up to RPE 8–9; no barbell set to failure",
    intermediate: "Week 1 at RPE 7 to set the loads, then compounds RPE 7–8.5 (1.5–3 reps left), isolation RPE 8–9.5",
    advanced: "Week 1 at RPE 7–8 to set the loads, then compounds RPE 7.5–9, isolation RPE 9–10 on the last set",
  };
  const progression: Record<ExperienceLevel, string> = {
    beginner: "Double progression: when every set reaches the top of the rep range at the target RPE, add the smallest jump (2.5–5 lb / 1–2.5 kg) and start back at the bottom",
    intermediate: x.brain === "powerlifting" || x.brain === "general_strength" || x.brain === "powerbuilding" ? "Main lifts: add load when the top set comes in under its target RPE; accessories: double progression" : "Double progression on every exercise, load added when all sets reach the top of the range at the target RPE",
    advanced: x.brain === "bodybuilding" || x.brain === "general_fitness" ? "Double progression, last set taken close to failure; hold exercises steady so progress can be read" : "Main lifts: weekly RPE / load progression on a top set with back-offs; accessories: double progression; last week lighter",
  };
  return {
    frequency,
    volume,
    intensity: `${reps[x.brain][level]} · ${noLoads}`,
    effort: effort[level],
    progression: progression[level],
    fit: { needed, fits: Number.isFinite(fits) ? fits : needed, scaled },
  };
}
