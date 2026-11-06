// Starting points for the challenge builder: pick what people will do and
// the scoring, units, rules and tie-break come pre-filled with sensible
// defaults (a dead hang is longest time wins, a deadlift max is heaviest
// verified weight wins). Everything stays editable until the event starts.
import type { Direction, Metric, Scoring, Tiebreak, Unit } from "./types";

export interface ChallengePreset {
  id: string;
  label: string;
  hint: string;
  activity: string;
  metric: Metric;
  unit: Unit;
  direction: Direction;
  scoring: Scoring;
  attempts_allowed: number;
  load_value?: number | null;
  load_unit?: "lb" | "kg" | null;
  time_cap_seconds?: number | null;
  objective: string;
  equipment?: string;
  judging_standard?: string;
  rules: string[];
  tiebreak: Tiebreak;
  /** An extra line for the registration ticks (experience with the load). */
  experience?: string;
  safety?: string;
}

const AGE = (n: number) => `I'm ${n} or older.`;
const RISK = "I've read the rules and the safety policy, I'm healthy enough for a hard effort, and I take part at my own risk.";

export function defaultAcknowledgments(p: Pick<ChallengePreset, "experience">, minAge = 18): string[] {
  return [AGE(minAge), ...(p.experience ? [p.experience] : []), RISK];
}

const LIFT_SAFETY =
  "• Spotters stand by on every set and safety arms or pins are set for every lift.\n• Collars stay on the bar.\n• Warm up properly before your attempt; staff will tell you when you're on deck.\n• A judge or spotter stops the set the moment you lose control. Completed reps still count.\n• If you have an injury, a medical condition or feel unwell, don't take part.";
const GENERAL_SAFETY =
  "• Warm up before your attempt.\n• Staff will stop an attempt that looks unsafe.\n• If you have an injury, a medical condition or feel unwell, don't take part.";

export const CHALLENGE_PRESETS: ChallengePreset[] = [
  {
    id: "bench_reps",
    label: "Bench press reps",
    hint: "Most reps at a set weight",
    activity: "Barbell Bench Press",
    metric: "reps",
    unit: "reps",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    load_value: 225,
    load_unit: "lb",
    objective: "Most valid reps with 225 lb in one continuous set.",
    equipment: "Competition bench with safety arms, collars on, two spotters.",
    judging_standard: "Bar touches the chest under control, full lockout at the top, no bounce, no help, butt, head and upper back on the bench, feet planted.",
    rules: [
      "The bar touches your chest under control on every rep.",
      "Lock your elbows out fully at the top of every rep.",
      "No bouncing the bar off your chest.",
      "Your butt, head and upper back stay on the bench.",
      "Your feet stay planted.",
      "No help from the spotters during a scored rep.",
      "No more than 3 seconds between reps.",
      "The judges decide whether each rep counts.",
    ],
    tiebreak: "bodyweight_lower",
    experience: "I can press the challenge weight for at least one controlled rep in training.",
    safety: LIFT_SAFETY,
  },
  {
    id: "max_lift",
    label: "Max lift",
    hint: "Heaviest single, best of 3",
    activity: "Deadlift",
    metric: "weight",
    unit: "lb",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 3,
    objective: "Heaviest verified single across three attempts.",
    judging_standard: "Full lockout, no hitching or ramping, controlled return to the floor on the judge's call.",
    rules: [
      "Three attempts. Your best valid one counts.",
      "Pick each attempt before you're called; weights only go up.",
      "Full lockout at the top and wait for the judge's down call.",
      "No hitching or ramping the bar up your thighs.",
      "Keep control of the bar on the way down.",
      "The judges decide whether each lift counts.",
    ],
    tiebreak: "bodyweight_lower",
    experience: "I train this lift regularly and know my max.",
    safety: LIFT_SAFETY,
  },
  {
    id: "relative_lift",
    label: "Bodyweight-relative lift",
    hint: "Heaviest lift for your size",
    activity: "Deadlift",
    metric: "weight",
    unit: "lb",
    direction: "higher",
    scoring: "bodyweight_ratio",
    attempts_allowed: 3,
    objective: "Best verified lift divided by bodyweight (weighed at check-in).",
    rules: [
      "You're weighed at check-in. No bodyweight, no score.",
      "Three attempts. Your best valid one counts.",
      "Full lockout and wait for the judge's down call.",
      "The judges decide whether each lift counts.",
    ],
    tiebreak: "next_best",
    experience: "I train this lift regularly and know my max.",
    safety: LIFT_SAFETY,
  },
  {
    id: "squat_reps",
    label: "Squat reps",
    hint: "Most reps at a set weight",
    activity: "Back Squat",
    metric: "reps",
    unit: "reps",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    load_value: 225,
    load_unit: "lb",
    objective: "Most valid reps with 225 lb in one continuous set.",
    judging_standard: "Hip crease below the top of the knee, full stand at the top, no help.",
    rules: [
      "Squat until your hip crease is below the top of your knee on every rep.",
      "Stand all the way up between reps.",
      "No help from the spotters during a scored rep.",
      "No more than 5 seconds standing between reps.",
      "The judges decide whether each rep counts.",
    ],
    tiebreak: "bodyweight_lower",
    experience: "I can squat the challenge weight for at least one controlled rep to depth in training.",
    safety: LIFT_SAFETY,
  },
  {
    id: "pullups",
    label: "Pull-ups",
    hint: "Most strict reps",
    activity: "Strict Pull-Up",
    metric: "reps",
    unit: "reps",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    objective: "Most strict pull-ups in one set.",
    judging_standard: "Start from a dead hang with arms straight, chin over the bar, no kipping or swinging.",
    rules: [
      "Start every rep from a dead hang with your arms straight.",
      "Your chin goes over the bar.",
      "No kipping, swinging or leg drive.",
      "Dropping off the bar ends the set.",
      "The judges decide whether each rep counts.",
    ],
    tiebreak: "shared",
    safety: GENERAL_SAFETY,
  },
  {
    id: "pushups",
    label: "Push-ups in 60 seconds",
    hint: "Most reps against the clock",
    activity: "Push-Up",
    metric: "reps",
    unit: "reps",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    time_cap_seconds: 60,
    objective: "Most push-ups in 60 seconds.",
    judging_standard: "Chest to a fist-height target, full lockout, body in a straight line.",
    rules: [
      "Chest touches the target on every rep.",
      "Lock your elbows out at the top.",
      "Keep your body in a straight line from head to heels.",
      "You can rest in the top position; the clock keeps running.",
      "The judges decide whether each rep counts.",
    ],
    tiebreak: "shared",
    safety: GENERAL_SAFETY,
  },
  {
    id: "dead_hang",
    label: "Dead hang",
    hint: "Longest hold wins",
    activity: "Dead Hang",
    metric: "time",
    unit: "s",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    objective: "Longest dead hang from the bar.",
    judging_standard: "Both hands on the bar, arms straight, feet off the ground. Time stops when a hand comes off or a foot touches.",
    rules: [
      "Overhand grip, both hands on the bar.",
      "Arms stay straight.",
      "No chalk breaks, no regripping with your feet down.",
      "The clock stops when a hand leaves the bar or a foot touches down.",
    ],
    tiebreak: "shared",
    safety: GENERAL_SAFETY,
  },
  {
    id: "farmers_hold",
    label: "Farmer's hold",
    hint: "Longest hold with set handles",
    activity: "Farmer's Hold",
    metric: "time",
    unit: "s",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    load_value: 100,
    load_unit: "lb",
    objective: "Longest hold with a 100 lb handle in each hand.",
    rules: [
      "Pick up on the judge's call. The clock starts when both handles leave the floor.",
      "Stand tall; no resting the handles on your legs.",
      "The clock stops when either handle touches down.",
    ],
    tiebreak: "shared",
    experience: "I'm used to carrying heavy loads and my grip and back are healthy.",
    safety: GENERAL_SAFETY,
  },
  {
    id: "farmers_carry",
    label: "Farmer's carry",
    hint: "Farthest distance",
    activity: "Farmer's Carry",
    metric: "distance",
    unit: "m",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    load_value: 100,
    load_unit: "lb",
    objective: "Farthest carry with a 100 lb handle in each hand, no drops.",
    rules: [
      "Pick up on the judge's call.",
      "Distance is measured to where the first handle touches down.",
      "Turns are marked; your whole body goes around the cone.",
    ],
    tiebreak: "shared",
    experience: "I'm used to carrying heavy loads and my grip and back are healthy.",
    safety: GENERAL_SAFETY,
  },
  {
    id: "row_500",
    label: "500 m row",
    hint: "Fastest time",
    activity: "500 m Row",
    metric: "time",
    unit: "s",
    direction: "lower",
    scoring: "best",
    attempts_allowed: 1,
    objective: "Fastest 500 m on the rower.",
    rules: [
      "Damper setting is your choice.",
      "The monitor's time is the official time.",
      "Feet strapped in for the whole piece.",
    ],
    tiebreak: "shared",
    safety: GENERAL_SAFETY,
  },
  {
    id: "custom",
    label: "Something else",
    hint: "Set it up yourself",
    activity: "",
    metric: "points",
    unit: "pts",
    direction: "higher",
    scoring: "best",
    attempts_allowed: 1,
    objective: "",
    rules: [],
    tiebreak: "shared",
    safety: GENERAL_SAFETY,
  },
];

/** Units that fit each metric (the builder shows only these). */
export const UNITS_FOR: Record<Metric, Unit[]> = {
  reps: ["reps"],
  weight: ["lb", "kg"],
  time: ["s"],
  distance: ["m", "km", "mi"],
  points: ["pts", "cal"],
};

/** The usual direction for a metric when the coach switches it. */
export function defaultDirection(metric: Metric, activity = ""): Direction {
  if (metric === "time") return /\b(hang|hold|plank|wall sit)\b/i.test(activity) ? "higher" : "lower";
  return "higher";
}

/** The fields the builder writes for a preset (the rest keep their defaults). */
export function presetFields(p: ChallengePreset, minAge = 18) {
  return {
    activity: p.activity,
    metric: p.metric,
    unit: p.unit,
    direction: p.direction,
    scoring: p.scoring,
    attempts_allowed: p.attempts_allowed,
    load_value: p.load_value ?? null,
    load_unit: p.load_unit ?? null,
    time_cap_seconds: p.time_cap_seconds ?? null,
    objective: p.objective || null,
    equipment: p.equipment ?? null,
    judging_standard: p.judging_standard ?? null,
    rules: p.rules,
    tiebreak: p.tiebreak,
    acknowledgments: defaultAcknowledgments(p, minAge),
    safety: p.safety ?? null,
  };
}
