/**
 * The 12 JF Effect library programs (JF Effect 12-Program Master Build
 * Specification, Nov 13 2026), written as data on top of progression.ts.
 *
 * Every program: 12 weeks in 3 blocks of 4, a workout list per week, and every
 * row's sets, reps, effort (RPE or RIR), rest, cue and swap. Where the
 * programming improves on the spec, the change and its reason are in that
 * program's `changes` (the coach's internal notes carry them too).
 */

import type { TrainingStyle } from "@/lib/pl-programs";
import type { ExKey } from "./catalog";
import {
  hyp, hypRow, pl, s, t, timed, blockOf, isDeload,
  type HypOptions, type Level, type PlWeek, type Slot, type Track, type WeekRow,
} from "./progression";

export type Category = "Athletes" | "Men" | "Women" | "At Home";

export type DayDef = {
  title: string;
  /** one line under the title: what the session is for and how long */
  focus: string;
  /** optional sessions (Elite Powerlifting's recovery day): skipping it is never a missed workout */
  optional?: boolean;
  slots: Slot[];
};

export type ProgramDef = {
  number: number;
  slug: string;
  name: string;
  category: Category;
  level: "Beginner" | "Intermediate" | "Advanced" | "Any level";
  equipment: "Gym" | "Bodyweight only" | "Dumbbells only" | "Dumbbells + bodyweight";
  /** core training days a week (an optional day is on top) */
  coreDays: number;
  style: TrainingStyle;
  goal: string;
  /** typical session length, minutes */
  minutes: number;
  track: Track;
  blockNames: [string, string, string];
  blockFocus: [string, string, string];
  tags: string[];
  /** what a client or member reads */
  description: string;
  /** what a coach (and the AI) reads: how to run and adapt it */
  coachGuide: string;
  /** where the programming deliberately departs from the spec, and why */
  changes: string[];
  days: DayDef[];
};

// Rest defaults (seconds), from the spec's resolver
const R = {
  heavy: 240, // primary squat / deadlift top sets and hard back-offs (3–6 min)
  bench: 180, // primary bench (2.5–5 min)
  secondary: 180, // secondary SBD, heavy bilateral legs (2–4 min)
  hardCompound: 150, // demanding DB / machine compounds near the top of their range
  compound: 120, // DB compounds, rows, pulldowns, unilateral legs (90–180 s)
  machine: 105, // stable machine / cable rows and presses (90–150 s)
  iso: 75, // isolation (60–120 s)
  core: 60, // planks, dead bugs (45–90 s)
  bwHard: 90, // hard push-ups, lunges, squats at home
  bwEasy: 50, // low-fatigue drills at home
};

const PL_BLOCKS: [string, string, string] = ["Block 1 — Accumulation (Weeks 1–4)", "Block 2 — Intensification (Weeks 5–8)", "Block 3 — Specificity (Weeks 9–12)"];
const PL_FOCUS: [string, string, string] = ["Volume", "Strength", "Peaking"];
const HYP_BLOCKS: [string, string, string] = ["Block 1 — Foundation (Weeks 1–4)", "Block 2 — Build (Weeks 5–8)", "Block 3 — Strength & Specialize (Weeks 9–12)"];
const HYP_FOCUS: [string, string, string] = ["Hypertrophy", "Hypertrophy", "Strength"];
const HOME_BLOCKS: [string, string, string] = ["Block 1 — Foundation (Weeks 1–4)", "Block 2 — Build (Weeks 5–8)", "Block 3 — Progress (Weeks 9–12)"];

/** Hypertrophy slot with a program's level baked in. */
const h = (level: Level) => (ex: ExKey, o: Omit<HypOptions, "level">) => hyp(ex, { ...o, level });
/** Accessory slot in a powerlifting program (effort eases as the main lifts peak). */
const plAcc = (level: Level) => (ex: ExKey, o: Omit<HypOptions, "level" | "plAccessory">) => hyp(ex, { ...o, level, plAccessory: true });

const TOP_SINGLE_NOTE = "If it moves slower than the RPE says, stop there: no grinders.";

// ===========================================================================
// 01 — STRENGTH FOUNDATION (Athletes · Beginner · 3 days)

const p01 = (): ProgramDef => {
  const a = plAcc("beginner");
  // Squat, Day 1 (primary): straight sets, then a top triple + back-off in Block 3
  const squatMon: PlWeek[] = [
    s(3, 5, "6"), s(3, 5, "6.5"), s(3, 5, "7"), s(2, 5, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(3, 4, "7.5"), s(2, 4, "5-6"),
    t(3, "7", [2, 3, 90]), t(3, "7.5", [2, 3, 90]), t(3, "8", [2, 3, 90]), t(3, "8", [1, 3, 88]),
  ];
  const benchMon: PlWeek[] = [
    s(3, 6, "6"), s(3, 6, "6.5"), s(3, 6, "7"), s(2, 6, "5-6"),
    s(3, 5, "6.5"), s(3, 5, "7"), s(3, 5, "7"), s(2, 5, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(3, 4, "7.5"), s(2, 4, "6"),
  ];
  const deadliftWed: PlWeek[] = [
    s(3, 4, "6"), s(3, 4, "6.5"), s(3, 4, "7"), s(2, 3, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(3, 4, "7.5"), s(2, 3, "5-6"),
    t(3, "7", [1, 3, 90]), t(3, "7.5", [1, 3, 90]), t(3, "8", [1, 3, 90]), t(3, "8", [1, 3, 85]),
  ];
  const pausedBenchWed: PlWeek[] = [
    s(3, 5, "6"), s(3, 5, "6.5"), s(3, 5, "7"), s(2, 5, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(3, 4, "7"), s(2, 4, "5-6"),
    s(3, 4, "7"), s(2, 4, "7"), s(2, 3, "7"), s(2, 3, "6"),
  ];
  const benchFri: PlWeek[] = [
    t(5, "7", [2, 5, 92]), t(5, "7.5", [2, 5, 92]), t(5, "8", [2, 5, 92]), s(2, 5, "5-6"),
    t(4, "7", [2, 4, 92]), t(4, "7.5", [2, 4, 92]), t(4, "8", [2, 4, 92]), s(2, 4, "5-6"),
    t(3, "7", [2, 3, 92]), t(3, "7.5", [2, 3, 92]), t(3, "8", [2, 3, 92]), t(3, "8", [1, 3, 90]),
  ];
  const squatFri: PlWeek[] = [
    s(2, 5, "5-6"), s(2, 5, "6"), s(2, 5, "6.5"), s(1, 5, "5-6"),
    s(2, 4, "6"), s(2, 4, "6.5"), s(2, 4, "6.5"), s(1, 4, "5-6"),
    s(2, 3, "6.5"), s(2, 3, "6.5"), s(2, 3, "7"), s(1, 3, "6"),
  ];
  return {
    number: 1,
    slug: "jf-strength-foundation",
    name: "JF Effect | Strength Foundation — Beginner — 3 days/week",
    category: "Athletes",
    level: "Beginner",
    equipment: "Gym",
    coreDays: 3,
    style: "powerlifting",
    goal: "Learn the squat, bench and deadlift and get steadily stronger",
    minutes: 60,
    track: "powerlifting",
    blockNames: PL_BLOCKS,
    blockFocus: PL_FOCUS,
    tags: ["JF Effect", "Athletes", "Powerlifting", "Strength", "Beginner", "Gym", "3 days"],
    description:
      "Your first powerlifting program. Squat twice, bench three times and deadlift once a week, with the work that keeps those lifts safe and strong. Every set has a target effort (RPE), so the weights come from what you can do that day, not a guess. 12 weeks in three blocks, an easier week every fourth week, and no max testing: you finish by beating your own triples. About an hour, 3 days a week, in a gym with a rack, bench and cables. Optional: 2 easy 15–30 minute walks or bike rides a week.",
    coachGuide: [
      "Purpose: learn competition patterns, consistent technique and modest progression. Not a mock peak.",
      "Exposures: squat 2x (Day 1 primary, Day 3 secondary), bench 3x (Day 3 primary top set + back-offs, Day 1 secondary, Day 2 paused tertiary), deadlift 1x (Day 2 primary) plus a DB RDL hinge on Day 1.",
      "Loading: RPE only (beginners' e1RMs aren't reliable). Back-offs are a % of the top set they actually lift that day (percentage_basis top_set), never % of an e1RM.",
      "Progression: same RPE, more load = progress. If the top set overshoots the RPE by more than a point, or form breaks, lower the load that day. Block 3 introduces top set + back-off on squat and deadlift so the athlete learns the structure later programs use.",
      "Deadlift stance (conventional or sumo) is the coach's call per athlete. Keep it constant across the 12 weeks.",
      "Trim first if sessions run long: Day 1 dead bug, Day 2 side plank, then one set of the lat pulldown.",
      "Week 12 is a submax check (top triple at RPE 8, no max attempts). If they have a meet, ask the AI to rebuild Weeks 9–12 around the meet date (see the Elite program's taper rules).",
    ].join("\n"),
    changes: [
      "Day 3: the dumbbell lateral raise is replaced by a chest-supported dumbbell row (2x8–12). Upper-back work was only 5 sets a week, and for a beginner powerlifter the upper back holds the bar on the squat and the setup on the bench; a lateral raise does neither.",
      "Block 3 squat and deadlift use a top set plus one or two back-off sets instead of straight 3s, so the athlete practises the top-set/back-off structure (same total work, same RPE caps).",
    ],
    days: [
      {
        title: "Day 1 — Squat + Bench",
        focus: "Squat primary · bench secondary · about 55–65 min",
        slots: [
          pl("compSquat", squatMon, { role: "Primary", rest: R.heavy - 60, note: "Warm up with 3–5 lighter sets. Same depth and brace on every rep: hip crease below the top of the knee." }),
          pl("compBench", benchMon, { role: "Secondary", rest: 150, note: "Pause on the chest, feet planted, same setup every rep." }),
          a("dbRdl", { sets: 2, reps: "8-10", rest: R.compound, note: "Hips back, soft knees, dumbbells close to the legs. Stop where your back would round." }),
          a("cableRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach, let the shoulder blades reach forward at the front." }),
          a("deadBug", { sets: 2, reps: "8-12 per side", rest: R.core, conservative: true, note: "Lower back stays flat on the floor. Slow and controlled." }),
        ],
      },
      {
        title: "Day 2 — Deadlift + Paused Bench",
        focus: "Deadlift primary · paused bench · about 55–65 min",
        slots: [
          pl("compDeadlift", deadliftWed, { role: "Primary", rest: R.heavy, note: "Same start every rep: bar over mid-foot, pull the slack out, then push the floor away. Stance is your coach's call; keep it the same all program." }),
          pl("pausedBench", pausedBenchWed, { role: "Tertiary", rest: 150, note: "Still 2-second pause on the chest, then press. Same setup as your competition bench." }),
          a("dbReverseLunge", { sets: 2, reps: "8-10 per side", rest: R.compound, note: "Step back, front foot flat, knee tracks over the toes." }),
          a("latPulldown", { sets: 3, reps: "8-12", rest: R.machine, note: "Pull to the top of the chest, elbows down to your sides, control the stretch at the top." }),
          timed("sidePlank", { sets: 2, seconds: [20, 30, 40], rest: 45, perSide: true, note: "Straight line from head to heels." }),
        ],
      },
      {
        title: "Day 3 — Bench + Squat",
        focus: "Bench primary · squat secondary · about 55–65 min",
        slots: [
          pl("compBench", benchFri, { role: "Primary", rest: R.bench, note: "Warm up with 3–5 lighter sets. Pause on the chest every rep." }),
          pl("compSquat", squatFri, { role: "Secondary", rest: 150, note: "Technique practice: smooth reps, same depth, nothing grindy." }),
          a("hipThrust", { sets: 2, reps: "8-12", rest: R.compound, note: "Chin tucked, ribs down, drive through the heels, 1-second squeeze at the top." }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows pinned to your sides, full lockout." }),
          a("csRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest on the pad, drive the elbows back toward your hips, squeeze 1 second." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 02 — STRENGTH DEVELOPMENT (Athletes · Intermediate · 4 days)

/** the spec's primary-lift wave; deadlift takes one fewer back-off set */
function primaryWave(lift: "squat" | "bench" | "deadlift"): PlWeek[] {
  const d = lift === "deadlift" ? 1 : 0;
  const n = (sets: number) => Math.max(1, sets - d);
  return [
    t(5, "7", [n(2), 5, 90]), t(5, "7.5", [n(2), 5, 90]), t(5, "8", [n(2), 5, 90]), s(2, 4, "6"),
    t(4, "7", [n(3), 4, 91]), t(4, "7.5", [n(3), 4, 91]), t(4, "8", [n(2), 4, 90]), s(2, 3, "6"),
    t(3, "7.5", [n(2), 3, 91]), t(2, "8", [n(2), 2, 90]), t(1, "8-8.5", [n(2), 2, lift === "bench" ? 90 : 88]), t(1, "8", [1, 2, 85]),
  ];
}

const p02 = (): ProgramDef => {
  const a = plAcc("intermediate");
  const benchMon: PlWeek[] = [
    s(3, 5, "6.5"), s(3, 5, "7"), s(3, 5, "7.5"), s(2, 5, "6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(3, 4, "7.5"), s(2, 4, "6"),
    s(3, 3, "7"), s(2, 3, "7"), s(2, 3, "7.5"), s(2, 3, "6"),
  ];
  const pauseDlTue: PlWeek[] = [
    s(3, 3, "6"), s(3, 3, "6.5"), s(3, 3, "7"), s(2, 3, "5-6"),
    s(3, 3, "6.5"), s(3, 3, "7"), s(2, 3, "7"), s(2, 2, "5-6"),
    s(2, 2, "6.5"), s(2, 2, "7"), s(2, 2, "7"), s(1, 2, "6"),
  ];
  const highBarThu: PlWeek[] = [
    s(3, 5, "6"), s(3, 5, "6.5"), s(3, 5, "7"), s(2, 5, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(2, 4, "7"), s(2, 4, "5-6"),
    s(2, 4, "6.5"), s(2, 4, "7"), s(2, 3, "7"), s(2, 3, "6"),
  ];
  const benchFri: PlWeek[] = [
    s(2, 4, "6"), s(2, 4, "6.5"), s(2, 4, "7"), s(1, 4, "6"),
    s(2, 4, "6.5"), s(2, 4, "7"), s(2, 4, "7"), s(1, 4, "6"),
    s(2, 3, "6.5"), s(2, 3, "7"), s(2, 3, "7"), s(1, 3, "6"),
  ];
  return {
    number: 2,
    slug: "jf-strength-development",
    name: "JF Effect | Strength Development — Intermediate — 4 days/week",
    category: "Athletes",
    level: "Intermediate",
    equipment: "Gym",
    coreDays: 4,
    style: "powerlifting",
    goal: "Build the squat, bench and deadlift with a heavy day and a lighter variation for each",
    minutes: 70,
    track: "powerlifting",
    blockNames: PL_BLOCKS,
    blockFocus: PL_FOCUS,
    tags: ["JF Effect", "Athletes", "Powerlifting", "Strength", "Intermediate", "Gym", "4 days"],
    description:
      "For lifters who know the competition lifts and are ready to train them properly. Each lift gets one heavy day (a top set plus back-off sets) and one lighter variation day, with the back, hamstring and triceps work that drives them. Fives, then fours and threes, then doubles and a controlled single, with an easier week every fourth week. No max testing unless your coach plans a meet. About 60–80 minutes, 4 days a week.",
    coachGuide: [
      "Purpose: systematic SBD overload with primary/secondary exposures, weak-point support and recovery.",
      "Exposures: squat Day 1 primary, Day 3 high-bar secondary (plus optional belt squat Day 4); bench Day 3 primary, Day 1 secondary, Day 4 tertiary; deadlift Day 4 primary, Day 2 pause deadlift secondary.",
      "Primary wave (each lift on its own): W1–3 top 5 @7/7.5/8 + back-offs 10% lighter; W4 2x4 @6; W5–7 top 4 @7/7.5/8 + back-offs 9–10% lighter; W8 2x3 @6; W9 top 3 @7.5, W10 top 2 @8, W11 single @8–8.5 + doubles, W12 controlled single @8. Deadlift takes one fewer back-off set.",
      "Back-offs are a % of that day's top set (logged), never of an e1RM. Don't add load just because it's a new week: if the top set overshoots its RPE by more than a point, take the extra off.",
      "Secondaries move from 5s to 4s and 3s at RPE 6–7.5 with fewer sets in Block 3; they don't all intensify at once.",
      "Swap the pause deadlift for another variation (deficit, block pull, tempo) only if it fixes this athlete's weak point. High-bar squat can drop to 2 sets if it hurts Day 4's deadlift.",
      "Trim first: Day 4 belt squat and adductor (both optional), then Day 1 cable crunch.",
      "Meet: anchor Weeks 9–12 to the meet date (heavy competition exposure 7–14 days out, 40–60% less volume over the last 7–10 days, last heavy squat/deadlift earlier than bench, a light primer, never heavy the day before). Ask the AI to rebuild those weeks with the date.",
    ].join("\n"),
    changes: [
      "Day 1 gets a 2x8–12 seated cable row. Direct back work was 6 sets a week (pulldown 3 + row 3) for a 4-day strength program; the upper back holds the squat bar and the bench setup, and Day 1 had the room (it was the shortest session).",
    ],
    days: [
      {
        title: "Day 1 — Squat + Bench",
        focus: "Heavy squat · bench volume · about 70 min",
        slots: [
          pl("compSquat", primaryWave("squat"), { role: "Primary", rest: R.heavy, note: "Warm up with 3–5 lighter sets." }),
          pl("compBench", benchMon, { role: "Secondary", rest: 150, note: "Pause on the chest, same setup and leg drive every rep." }),
          a("cableRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach, full stretch forward." }),
          a("seatedLegCurl", { sets: 2, reps: "8-12", rest: R.iso, note: "Hips pinned to the seat, control the lowering." }),
          a("cableCrunch", { sets: 2, reps: "10-15", rest: R.core, conservative: true, note: "Curl the ribs toward the hips; don't sit back into it." }),
        ],
      },
      {
        title: "Day 2 — Pause Deadlift + Upper",
        focus: "Deadlift variation · back and chest · about 60 min",
        slots: [
          pl("pauseDeadlift", pauseDlTue, { role: "Secondary", rest: R.secondary, note: "Pause 1 second just after the plates leave the floor, same back angle as your normal start, then finish the pull." }),
          a("latPulldown", { sets: 3, reps: "8-12", rest: R.machine, note: "Pull to the top of the chest, elbows to your sides." }),
          a("inclineDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Low incline, dumbbells over the elbows, full stretch at the bottom." }),
          a("rearDeltMachine", { sets: 2, reps: "12-20", rest: 60, note: "Swap: rear-delt cable fly or bent-over dumbbell raise." }),
        ],
      },
      {
        title: "Day 3 — Bench + High-Bar Squat",
        focus: "Heavy bench · squat variation · about 70 min",
        slots: [
          pl("compBench", primaryWave("bench"), { role: "Primary", rest: R.bench, note: "Warm up with 3–5 lighter sets. Competition pause on every rep." }),
          pl("highBarSquat", highBarThu, { role: "Secondary", rest: R.secondary, note: "Bar high on the traps, more upright, full depth. If it leaves your legs flat for Day 4's deadlift, drop a set." }),
          a("csRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest on the pad, elbows back toward the hips. Swap: a chest-supported machine row." }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows pinned, full lockout." }),
        ],
      },
      {
        title: "Day 4 — Deadlift + Bench",
        focus: "Heavy deadlift · bench practice · about 65 min",
        slots: [
          pl("compDeadlift", primaryWave("deadlift"), { role: "Primary", rest: R.heavy, note: "Warm up with 3–5 lighter sets. Same start position every rep; stance is your coach's call." }),
          pl("compBench", benchFri, { role: "Tertiary", rest: 150, note: "Clean pauses and your own commands: a skill set, not a grind." }),
          a("beltSquat", { sets: 2, reps: "8-12", rest: R.compound, note: "Optional: only if your legs recovered from the deadlifts. Swap: leg press." }),
          a("adductor", { sets: 2, reps: "10-15", rest: R.iso, note: "Optional if short on time." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 03 — ELITE POWERLIFTING (Athletes · Advanced · 3 core days + optional)

const p03 = (): ProgramDef => {
  const a = plAcc("advanced");
  // Day 4: the week's competition SBD. Singles + back-offs; deadlift fewer back-offs.
  const friSquat: PlWeek[] = [
    t(1, "6.5", [3, 4, 90]), t(1, "7", [3, 4, 90]), t(1, "7.5", [3, 4, 89]), s(2, 3, "6"),
    t(1, "7", [3, 3, 91]), t(1, "7.5", [3, 3, 90]), t(1, "8", [2, 3, 89]), s(2, 2, "6"),
    t(1, "8", [3, 2, 91]), t(1, "8.5", [2, 2, 90]), t(1, "8.5", [1, 2, 90]), t(1, "8", [1, 2, 85]),
  ];
  const friBench: PlWeek[] = [
    t(1, "6.5", [3, 4, 91]), t(1, "7", [3, 4, 91]), t(1, "7.5", [3, 4, 90]), s(2, 3, "6"),
    t(1, "7", [3, 3, 92]), t(1, "7.5", [3, 3, 91]), t(1, "8", [2, 3, 90]), s(2, 2, "6"),
    t(1, "8", [3, 2, 92]), t(1, "8.5", [2, 2, 91]), t(1, "8.5", [1, 2, 91]), t(1, "8", [1, 2, 87]),
  ];
  const friDeadlift: PlWeek[] = [
    t(1, "6.5", [2, 3, 88]), t(1, "7", [2, 3, 88]), t(1, "7.5", [2, 3, 88]), s(2, 2, "6"),
    t(1, "7", [2, 3, 89]), t(1, "7.5", [1, 3, 88]), t(1, "8", [1, 3, 88]), s(1, 2, "6"),
    t(1, "8", [2, 2, 90]), t(1, "8.5", [1, 2, 89]), t(1, "8.5", [1, 2, 88]), t(1, "7.5-8"),
  ];
  const highBarMon: PlWeek[] = [
    s(3, 6, "6"), s(3, 6, "6.5"), s(3, 5, "7"), s(2, 5, "5-6"),
    s(3, 4, "6.5"), s(3, 4, "7"), s(2, 4, "7"), s(2, 4, "5-6"),
    s(2, 4, "6.5"), s(2, 3, "7"), s(2, 3, "7"), s(2, 3, "6"),
  ];
  const blockPressMon: PlWeek[] = [
    s(3, 6, "6.5"), s(3, 6, "7"), s(3, 5, "7"), s(2, 5, "6"),
    s(3, 5, "7"), s(3, 4, "7"), s(3, 4, "7.5"), s(2, 4, "6"),
    s(2, 4, "7"), s(2, 4, "7.5"), s(2, 3, "7.5"), s(2, 4, "6"),
  ];
  const pauseDlTue: PlWeek[] = [
    s(3, 3, "6"), s(3, 3, "6.5"), s(3, 3, "7"), s(2, 2, "5-6"),
    s(3, 3, "6.5"), s(2, 3, "7"), s(2, 3, "7"), s(2, 2, "5-6"),
    s(2, 2, "6.5"), s(2, 2, "7"), s(1, 2, "7"), s(1, 2, "6"),
  ];
  const benchTue: PlWeek[] = [
    s(3, 5, "7"), s(3, 4, "7.5"), s(4, 4, "7.5"), s(2, 4, "6"),
    s(3, 3, "7.5"), s(4, 3, "7.5"), s(3, 3, "8"), s(2, 3, "6"),
    s(3, 3, "7.5"), s(3, 2, "8"), s(2, 2, "8"), s(2, 3, "6.5"),
  ];
  return {
    number: 3,
    slug: "jf-elite-powerlifting",
    name: "JF Effect | Elite Powerlifting — Advanced — 3 days/week + optional recovery day",
    category: "Athletes",
    level: "Advanced",
    equipment: "Gym",
    coreDays: 3,
    style: "powerlifting",
    goal: "Advanced squat, bench and deadlift strength with controlled fatigue",
    minutes: 90,
    track: "powerlifting",
    blockNames: PL_BLOCKS,
    blockFocus: PL_FOCUS,
    tags: ["JF Effect", "Athletes", "Powerlifting", "Strength", "Advanced", "Gym", "3 days"],
    description:
      "For experienced powerlifters. One big day a week where you take a squat, bench and deadlift single and back-off sets, and two days that build the lifts with variations: high-bar squats, close-grip block presses, pause deadlifts and competition bench volume. A fourth, short recovery day is optional: skip it any week you're beat up. Singles stay at RPE 8–8.5 in normal training: no grinders, no max testing unless your coach is peaking you for a meet.",
    coachGuide: [
      "Purpose: advanced SBD specificity with controlled fatigue, not five demanding sessions. Day 4 is the primary SBD exposure; Day 2 is the secondary deadlift and the bench volume day; Day 1 is variations.",
      "Day 4 singles: W1–3 RPE 6.5–7.5 then 4s for volume (back-offs ~10% under the single); W4 2x3 @6; W5–7 single RPE 7–8 plus 3s; W8 2x2 @6; W9–10 single RPE 8–8.5 plus doubles; W11 last heavy exposure, back-offs cut; W12 controlled single and transition (or the meet taper).",
      "If total fatigue is high on Day 4, cut deadlift back-offs first, then squat back-offs. Readiness can alternate squat- and deadlift-priority back-off volume week to week.",
      "Variations are chosen for a reason: high-bar for quad contribution, block press for triceps/lockout with less shoulder stretch, pause deadlift for floor position. If one isn't this athlete's bottleneck, swap it (e.g. pause squat for position, belt squat for quads, Larsen press, deficit pull) and say why.",
      "Optional Day 3 (recovery/accessories) is labelled optional: skipping it never counts as a missed workout. Zone-2 cardio 15–25 min after it if it helps recovery.",
      "Accessory volume tapers as specificity rises: rows and pulldowns 3 sets in Blocks 1–2, 2 sets in Block 3.",
      "Meet: replace Weeks 10–12 (or more) with a taper anchored to the meet date: a heavy competition exposure 7–14 days out, volume down 40–60% over the last 7–10 days, last heavy squat and deadlift earlier than the last heavy bench, a light primer 2–3 days out, nothing heavy the day before. Attempts come from recent singles, never invented. Do not assume Week 12 is meet week.",
    ].join("\n"),
    changes: [
      "Row and pulldown volume tapers from 3 sets (Blocks 1–2) to 2 sets (Block 3): accessory fatigue comes down as the competition lifts get heavier, so the singles and doubles get the recovery.",
      "Week 12 deadlift is a single only (no back-off): the week is an assessment and deadlift fatigue is the slowest to clear.",
    ],
    days: [
      {
        title: "Day 1 — High-Bar Squat + Block Press",
        focus: "Squat and bench variations · about 60 min",
        slots: [
          pl("highBarSquat", highBarMon, { role: "Secondary", rest: R.secondary, note: "Warm up with 3–5 lighter sets. Bar high on the traps, upright, full depth." }),
          pl("cgBlockPress", blockPressMon, { role: "Tertiary", rest: 150, note: "2–3 inch blocks, close grip. Lockout and triceps; stop a set if a shoulder complains. Swap: close-grip bench press if there are no blocks." }),
          a("csRow", { sets: 3, reps: "8-12", addB3: -1, rest: R.machine, note: "Chest on the pad, elbows back to the hips. Swap: chest-supported machine row." }),
          a("dbLateralRaise", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbows, stop at shoulder height, no swinging." }),
        ],
      },
      {
        title: "Day 2 — Pause Deadlift + Bench",
        focus: "Deadlift variation · bench volume · about 65 min",
        slots: [
          pl("pauseDeadlift", pauseDlTue, { role: "Secondary", rest: R.secondary, note: "Pause just off the floor in your normal start position. Stance is your coach's call: don't switch to sumo just for this." }),
          pl("compBench", benchTue, { role: "Secondary", rest: R.bench, note: "Competition pause and commands. This is the week's bench volume." }),
          a("latPulldown", { sets: 3, reps: "8-12", addB3: -1, rest: R.machine, note: "Pull to the top of the chest, elbows to your sides." }),
          a("lyingLegCurl", { sets: 2, reps: "8-12", rest: R.iso, note: "Hips down on the pad, control the lowering." }),
        ],
      },
      {
        title: "Day 3 — Optional Recovery",
        focus: "Optional · short and easy · skip it any week you're beat up · add 15–25 min easy cardio if it helps",
        optional: true,
        slots: [
          a("rearDeltMachine", { sets: 2, reps: "12-20", rest: 60, conservative: true, note: "Optional day: nothing here should leave you sore." }),
          a("adductor", { sets: 2, reps: "10-15", rest: R.iso, conservative: true }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, conservative: true }),
          a("cableCrunch", { sets: 2, reps: "10-15", rest: R.core, conservative: true }),
        ],
      },
      {
        title: "Day 4 — Competition Squat, Bench + Deadlift",
        focus: "The week's main session · singles + back-offs · 75–110 min",
        slots: [
          pl("compSquat", friSquat, { role: "Primary", rest: R.heavy + 30, note: `Warm up with 4–6 sets. ${TOP_SINGLE_NOTE}` }),
          pl("compBench", friBench, { role: "Primary", rest: R.heavy, note: `Competition pause and commands. ${TOP_SINGLE_NOTE}` }),
          pl("compDeadlift", friDeadlift, { role: "Primary", rest: R.heavy + 30, note: `If the day has been hard, do the single and cut the back-offs. ${TOP_SINGLE_NOTE}` }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 04 — MUSCLE FOUNDATION (Men · Beginner · 3 days full body)

const p04 = (): ProgramDef => {
  const a = h("beginner");
  return {
    number: 4,
    slug: "jf-muscle-foundation",
    name: "JF Effect | Muscle Foundation — Beginner — 3 days/week",
    category: "Men",
    level: "Beginner",
    equipment: "Gym",
    coreDays: 3,
    style: "bodybuilding",
    goal: "Build muscle and general strength with full-body training",
    minutes: 55,
    track: "beginner",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Men", "Muscle", "Hypertrophy", "Beginner", "Gym", "3 days", "Full Body"],
    description:
      "Your first proper muscle-building program. Three full-body workouts a week using machines, cables and dumbbells that are easy to learn and easy to progress: when you hit the top of the rep range on every set, add a little weight. Two hard sets per exercise, an easier week every fourth week, and a rep-PR week at the end to see how far you've come. About 45–60 minutes. Optional: 2 easy 15–30 minute walks or bike rides a week.",
    coachGuide: [
      "Purpose: competent full-body training, sustainable muscle gain, general strength. Gender label is only a browsing tag.",
      "Weekly sets (approx.): quads 7, chest 6, back 7, hamstrings 4 + hip thrust, side delts 2, arms 2+2, calves 2. Beginner range is 6–10 effective sets per muscle.",
      "Double progression: when every set hits the top of the range at the target RIR, add the smallest increment next time.",
      "Weeks 4 and 8 are lighter weeks (beginner version of a deload): 3-set exercises drop a set and everything is at 3–4 RIR; 2-set work stays 2 sets. Beginners carry little fatigue, but the easier week keeps technique sharp and adherence high.",
      "Goblet squat → belt squat or back squat when the dumbbell gets too light for 12 hard reps.",
      "Trim first if over 60 min: Day 1 plank, Day 3 dead bug, then a lateral raise or curl set.",
      "Advance on consistent technique, completion and stable progress, not a calendar date.",
    ].join("\n"),
    changes: [],
    days: [
      {
        title: "Day 1 — Full Body A",
        focus: "Legs, chest, back · about 50 min",
        slots: [
          a("legPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Feet shoulder width, lower until your hips want to tuck, then drive. 1–2 lighter sets first." }),
          a("dbBench", { sets: 2, reps: "6-10", rest: R.compound, note: "Shoulder blades pinned back, dumbbells to chest level, press up and slightly in." }),
          a("cableRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach, full stretch forward." }),
          a("dbRdl", { sets: 2, reps: "8-12", rest: R.compound, note: "Hips back, soft knees, stop where your back would round." }),
          a("dbLateralRaise", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbows, stop at shoulder height." }),
          timed("plank", { sets: 2, seconds: [25, 35, 45], rest: R.core, note: "Squeeze glutes and abs, straight line." }),
        ],
      },
      {
        title: "Day 2 — Full Body B",
        focus: "Squat, back, upper chest · about 55 min",
        slots: [
          a("gobletSquat", { sets: 3, reps: "8-12", rest: R.compound, note: "Dumbbell at your chest, sit between your heels, chest up. Ask your coach to move you to a belt or back squat when it's too light." }),
          a("latPulldown", { sets: 3, reps: "8-12", rest: R.machine, note: "Pull to the top of the chest, elbows down to your sides." }),
          a("inclineDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Low incline, full stretch at the bottom." }),
          a("seatedLegCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Hips pinned, control the lowering." }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows pinned, full lockout." }),
          a("standingCalf", { sets: 2, reps: "10-15", rest: 60, note: "Full stretch at the bottom, pause 1 second at the top." }),
        ],
      },
      {
        title: "Day 3 — Full Body C",
        focus: "Legs, chest, back, arms · about 50 min",
        slots: [
          a("beltSquat", { sets: 2, reps: "8-12", rest: R.compound, note: "Upright torso, full depth. Swap: leg press." }),
          a("machineChestPress", { sets: 2, reps: "8-12", rest: R.machine, note: "Handles at mid-chest, control the stretch." }),
          a("csRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest on the pad, elbows back toward the hips." }),
          a("hipThrust", { sets: 2, reps: "8-12", rest: R.compound, note: "Chin tucked, ribs down, 1-second squeeze at the top." }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: 60, note: "Elbows still, full stretch at the bottom." }),
          a("deadBug", { sets: 2, reps: "8-12 per side", rest: R.core, conservative: true, note: "Lower back flat, slow." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 05 — MUSCLE & STRENGTH (Men · Intermediate · 4 days upper/lower)

const p05 = (): ProgramDef => {
  const a = h("intermediate");
  const squat: PlWeek[] = [
    s(3, "6-8", "7"), s(3, "6-8", "7.5"), s(3, "6-8", "8"), s(2, 6, "6"),
    s(3, "5-7", "7"), s(3, "5-7", "7.5"), s(3, "5-7", "8"), s(2, 5, "6"),
    s(3, "4-6", "7.5"), s(3, "4-6", "8"), s(3, "4-6", "8"), s(2, "4-6", "8"),
  ];
  const bench: PlWeek[] = [
    s(3, "6-10", "7"), s(3, "6-10", "7.5"), s(3, "6-10", "8"), s(2, 8, "6"),
    s(3, "6-8", "7"), s(3, "6-8", "7.5"), s(3, "6-8", "8"), s(2, 6, "6"),
    s(3, "5-7", "7.5"), s(3, "5-7", "8"), s(3, "5-7", "8"), s(2, "5-7", "8"),
  ];
  return {
    number: 5,
    slug: "jf-muscle-strength",
    name: "JF Effect | Muscle & Strength — Intermediate — 4 days/week",
    category: "Men",
    level: "Intermediate",
    equipment: "Gym",
    coreDays: 4,
    style: "bodybuilding",
    goal: "Build muscle with enough heavy compound work to keep getting stronger",
    minutes: 65,
    track: "hypertrophy",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Men", "Muscle", "Hypertrophy", "Strength", "Intermediate", "Gym", "4 days", "Upper Lower"],
    description:
      "Upper/lower, 4 days a week: two upper and two lower sessions built around a heavy squat, bench, incline press and Romanian deadlift, with the machine and cable work that actually grows muscle. Reps first, then load. Each block gets a little harder, with an easier week every fourth week, and the last block moves the big lifts into heavier rep ranges. About 55–75 minutes.",
    coachGuide: [
      "Purpose: productive upper/lower hypertrophy with enough compound strength practice. Not a six-day marathon.",
      "Weekly sets (approx.): chest 8, back 10, side delts 6, rear delts 2, quads 8, hamstrings 8, glutes 2 direct + compounds, calves 3, arms 2–4 each.",
      "Squat and bench run on RPE (6–8 reps → 5–7 → 4–6 by block). Everything else is double progression at the target RIR.",
      "Squat: competition, high-bar or safety bar, whichever the client trains best; no powerlifting commands needed.",
      "More arm work only by trading low-priority sets (e.g. one pec-deck or adductor set), never by stacking exercises.",
      "Trim first if over 75 min: adductor, cable crunch, then one set of the reverse pec deck.",
    ].join("\n"),
    changes: [
      "Upper B: the seated dumbbell shoulder press is replaced by a dumbbell lateral raise (3x12–20). Front delts already get about 6 hard pressing sets a week from the incline press and bench, while side delts were getting only 3 direct sets; the raise grows the side delts with less joint and recovery cost. Put the press back for clients who want it (swap note on the row).",
    ],
    days: [
      {
        title: "Day 1 — Upper A",
        focus: "Upper chest, lats, shoulders, arms · about 65 min",
        slots: [
          a("inclineDbPress", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "1–2 lighter sets first. Low incline, full stretch at the bottom." }),
          a("latPulldown", { sets: 3, reps: "8-12", repsB3: "6-10", rest: R.machine, note: "Pull to the top of the chest, elbows down to your sides." }),
          a("csRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest on the pad, elbows back to the hips." }),
          a("cableLateral", { sets: 3, reps: "12-20", rest: 60, note: "Cable from low and behind you, lead with the elbow." }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows pinned, full lockout." }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows still, full stretch." }),
        ],
      },
      {
        title: "Day 2 — Lower A",
        focus: "Squat, hinge, quads, hamstrings · about 60 min",
        slots: [
          pl("highBarSquat", squat, { rest: R.secondary, note: "Warm up with 3–4 lighter sets. Any squat you train well (high bar, safety bar or competition); full depth, no grinders." }),
          a("rdl", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "Hips back, bar close, stretch the hamstrings without rounding." }),
          a("legExtension", { sets: 2, reps: "10-15", rest: R.iso, note: "Pause 1 second at the top." }),
          a("seatedLegCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Hips pinned, control the lowering." }),
          a("cableCrunch", { sets: 2, reps: "10-15", rest: R.core, conservative: true, note: "Curl the ribs to the hips." }),
        ],
      },
      {
        title: "Day 3 — Upper B",
        focus: "Chest, back, delts · about 65 min",
        slots: [
          pl("bbBench", bench, { rest: R.hardCompound, note: "Warm up with 2–3 lighter sets. Touch the chest, no bounce. Swap: chest press machine." }),
          a("cableRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach." }),
          a("neutralPulldown", { sets: 2, reps: "10-12", rest: R.machine, note: "Palms facing, pull the elbows down to your ribs." }),
          a("pecDeck", { sets: 2, reps: "10-15", rest: R.iso, note: "Big stretch, squeeze 1 second." }),
          a("dbLateralRaise", { sets: 3, reps: "12-20", rest: 60, note: "Lead with the elbows. Swap: seated dumbbell shoulder press 2x8–12 if you'd rather press." }),
          a("rearDeltMachine", { sets: 2, reps: "12-20", rest: 60, note: "Arms long, sweep out and back." }),
        ],
      },
      {
        title: "Day 4 — Lower B",
        focus: "Quads, glutes, hamstrings, calves · about 60 min",
        slots: [
          a("legPress", { sets: 3, reps: "8-12", repsB3: "6-10", rest: R.hardCompound, note: "1–2 lighter sets first. Deep and controlled." }),
          a("hipThrust", { sets: 2, reps: "8-12", rest: R.compound, note: "Chin tucked, 1-second squeeze at the top." }),
          a("lyingLegCurl", { sets: 3, reps: "8-12", rest: R.iso, note: "Hips down on the pad." }),
          a("standingCalf", { sets: 3, reps: "8-15", rest: 60, note: "Full stretch, 1-second pause at the top." }),
          a("adductor", { sets: 2, reps: "10-15", rest: R.iso, note: "Control the stretch." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 06 — PHYSIQUE SPECIALIZATION (Men · Advanced · 4 days upper/lower)

const p06 = (): ProgramDef => {
  const a = h("advanced");
  const iso = { intensityTechnique: true };
  return {
    number: 6,
    slug: "jf-physique-specialization",
    name: "JF Effect | Physique Specialization — Advanced — 4 days/week",
    category: "Men",
    level: "Advanced",
    equipment: "Gym",
    coreDays: 4,
    style: "bodybuilding",
    goal: "Advanced hypertrophy with emphasis on lats, delts, upper chest and arms",
    minutes: 75,
    track: "hypertrophy",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Men", "Muscle", "Hypertrophy", "Advanced", "Gym", "4 days", "Upper Lower"],
    description:
      "Advanced bodybuilding, 4 days a week. Fewer, better sets after proper warm-ups: a handful of hard working sets per muscle, close to failure on the stable machine and cable work, with emphasis on the lats, side delts, upper chest and arms. Optional rest-pause on the last isolation set in the hardest weeks. Not a failure-every-set program and not six days in the gym. About 60–85 minutes.",
    coachGuide: [
      "Purpose: high-quality hypertrophy with emphasis options for lats, side/rear delts, upper chest and arms. Dorian Yates-inspired execution: fewer, excellent working sets after warm-ups; no compulsory failure or forced reps.",
      "Weekly sets (approx.): back 11, chest 8, side delts 6, rear delts 2, quads 10, hamstrings 6, glutes 2 + compounds, calves 4, biceps 4, triceps 2 + pressing.",
      "Specialization: pick 1–2 lagging muscles and move 2–4 weekly hard sets from non-priority work to them (e.g. +1 lateral raise set each upper day, −1 leg extension and −1 seated calf). Never 3+ redundant rows/pulldowns in one day.",
      "Intensity techniques: optional rest-pause on the final set of a safe isolation (machines/cables) in Weeks 7, 10 and 11 only.",
      "Trim first if over 85 min: cable crunch, seated calf raise, then one set of the hammer curl.",
    ].join("\n"),
    changes: [
      "Chest was 4 hard sets a week for an advanced physique program that lists upper chest as an emphasis. The incline press and machine chest press go from 2 to 3 sets, and Upper B's dumbbell shoulder press becomes a pec deck (2x10–15): front delts already get 6 hard pressing sets, side delts get 6 lateral-raise sets, and the press added joint stress without new stimulus. Chest goes to 8 sets a week.",
    ],
    days: [
      {
        title: "Day 1 — Upper A",
        focus: "Lats + upper chest · about 70 min",
        slots: [
          a("latPulldown", { sets: 3, reps: "6-10", rest: R.machine, note: "1–2 ramp-up sets. Full stretch at the top, elbows to the hips." }),
          a("csRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest on the pad, pause with the elbows behind you." }),
          a("inclineSmith", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "Low incline, bar to the upper chest, controlled stretch. Swap: incline machine press." }),
          a("cableLateral", { sets: 3, reps: "12-20", rest: 60, ...iso, note: "Lead with the elbow, constant tension." }),
          a("rearDeltMachine", { sets: 2, reps: "12-20", rest: 60, ...iso }),
          a("inclineDbCurl", { sets: 2, reps: "8-12", rest: R.iso, ...iso, note: "Arms hang behind you, full stretch." }),
        ],
      },
      {
        title: "Day 2 — Lower A",
        focus: "Quads, hamstrings, calves · about 60 min",
        slots: [
          a("beltSquat", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "2–3 ramp-up sets. Upright, deep, controlled. Swap: hack squat or any stable squat." }),
          a("rdl", { sets: 2, reps: "6-10", rest: R.hardCompound, note: "Hips back, bar close, big hamstring stretch." }),
          a("lyingLegCurl", { sets: 2, reps: "8-12", rest: R.iso, ...iso }),
          a("legExtension", { sets: 2, reps: "10-15", rest: R.iso, ...iso, note: "Pause 1 second at the top." }),
          a("standingCalf", { sets: 2, reps: "8-15", rest: 60, note: "Full stretch, 1-second pause." }),
        ],
      },
      {
        title: "Day 3 — Upper B",
        focus: "Shoulders, arms, back width · about 75 min",
        slots: [
          a("machineChestPress", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.machine, note: "1–2 ramp-up sets. Controlled stretch, no bouncing." }),
          a("oneArmCableRow", { sets: 3, reps: "8-12 per side", rest: R.compound, note: "One arm, drive the elbow toward the hip, big stretch forward." }),
          a("pullUp", { sets: 2, reps: "6-10", rest: R.hardCompound, note: "Add weight or use assistance so 6–10 is hard. Swap: lat pulldown." }),
          a("pecDeck", { sets: 2, reps: "10-15", rest: R.iso, ...iso, note: "Big stretch, squeeze 1 second." }),
          a("cableLateral", { sets: 3, reps: "12-20", rest: 60, ...iso }),
          a("ohCableTriceps", { sets: 2, reps: "10-15", rest: R.iso, ...iso, note: "Full stretch overhead." }),
          a("hammerCurl", { sets: 2, reps: "8-12", rest: R.iso }),
        ],
      },
      {
        title: "Day 4 — Lower B",
        focus: "Quads, glutes, hamstrings · about 70 min",
        slots: [
          a("legPress", { sets: 3, reps: "8-12", repsB3: "6-10", rest: R.hardCompound, note: "1–2 ramp-up sets. Deep and controlled." }),
          a("hipThrust", { sets: 2, reps: "8-12", rest: R.compound, note: "Chin tucked, 1-second squeeze." }),
          a("bss", { sets: 2, reps: "8-10 per side", rest: R.compound, note: "Rear foot on a bench, drop straight down." }),
          a("seatedLegCurl", { sets: 2, reps: "10-15", rest: R.iso, ...iso }),
          a("seatedCalf", { sets: 2, reps: "10-15", rest: 60 }),
          a("cableCrunch", { sets: 2, reps: "10-15", rest: R.core, conservative: true }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 07 — FITNESS FOUNDATION (Women · Beginner · 3 days full body)

const p07 = (): ProgramDef => {
  const a = h("beginner");
  return {
    number: 7,
    slug: "jf-fitness-foundation",
    name: "JF Effect | Fitness Foundation — Beginner — 3 days/week",
    category: "Women",
    level: "Beginner",
    equipment: "Gym",
    coreDays: 3,
    style: "lifestyle",
    goal: "Full-body strength and confidence with real glute and leg work",
    minutes: 55,
    track: "beginner",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Women", "Glutes", "Strength", "Beginner", "Gym", "3 days", "Full Body"],
    description:
      "Three full-body workouts a week to build strength and confidence in the gym, with proper glute and leg work and a balanced upper body. Real weights, not light ones: you add weight whenever you hit the top of the rep range. Machines and dumbbells that are easy to learn, an easier week every fourth week, and a rep-PR week at the end. About 45–60 minutes. Optional: 2 easy 15–30 minute walks or bike rides a week.",
    coachGuide: [
      "Purpose: full-body strength and confidence with meaningful glute/lower-body work. Not 'light weights because female'.",
      "Weekly sets (approx.): quads 9, glutes 5 direct + compounds, hamstrings 4, back 7, chest 4, delts 4, core 2 exercises.",
      "Double progression at the target RIR. Weeks 4 and 8 are lighter weeks (same movements, 3-set work drops a set, 3–4 RIR).",
      "Scale exercise choice to skill and joints: goblet squat or belt squat, split squat with or without dumbbells. For a true novice, drop one set from the hip thrust and leg press in Block 1.",
      "Trim first if over 60 min: plank or dead bug, then the lateral raise.",
    ].join("\n"),
    changes: [],
    days: [
      {
        title: "Day 1 — Full Body A",
        focus: "Legs, back, chest · about 50 min",
        slots: [
          a("legPress", { sets: 3, reps: "8-12", rest: R.compound, note: "1–2 lighter sets first. Lower until your hips want to tuck, then drive." }),
          a("dbRdl", { sets: 2, reps: "8-12", rest: R.compound, note: "Hips back, soft knees, dumbbells close to the legs." }),
          a("latPulldown", { sets: 2, reps: "8-12", rest: R.machine, note: "Pull to the top of the chest, elbows to your sides." }),
          a("machineChestPress", { sets: 2, reps: "8-12", rest: R.machine, note: "Handles at mid-chest, control the stretch." }),
          a("hipAbduction", { sets: 2, reps: "12-20", rest: 60, note: "Lean slightly forward, pause 1 second open." }),
          timed("plank", { sets: 2, seconds: [20, 30, 40], rest: R.core, note: "Squeeze glutes and abs, straight line." }),
        ],
      },
      {
        title: "Day 2 — Full Body B",
        focus: "Glutes, legs, back, shoulders · about 55 min",
        slots: [
          a("hipThrust", { sets: 3, reps: "8-12", rest: R.compound, note: "1–2 lighter sets first. Chin tucked, ribs down, 1-second squeeze at the top." }),
          a("dbSplitSquat", { sets: 2, reps: "8-10 per side", rest: R.compound, note: "Bodyweight first, dumbbells when 10 is easy. Drop the back knee straight down." }),
          a("cableRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach." }),
          a("seatedDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Dumbbells from shoulder height, press up and slightly in." }),
          a("seatedLegCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Hips pinned, control the lowering." }),
          a("deadBug", { sets: 2, reps: "8-12 per side", rest: R.core, conservative: true, note: "Lower back flat, slow." }),
        ],
      },
      {
        title: "Day 3 — Full Body C",
        focus: "Squat, chest, back, glutes · about 55 min",
        slots: [
          a("gobletSquat", { sets: 2, reps: "8-12", rest: R.compound, note: "Dumbbell at your chest, sit between your heels. Swap: belt squat." }),
          a("inclineDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Low incline, full stretch at the bottom." }),
          a("neutralPulldown", { sets: 2, reps: "8-12", rest: R.machine, note: "Palms facing, elbows to your ribs." }),
          a("dbReverseLunge", { sets: 2, reps: "8-10 per side", rest: R.compound, note: "Step back, front foot flat." }),
          a("dbGluteBridge", { sets: 2, reps: "10-15", rest: R.iso, note: "Dumbbell on the hips, drive through the heels, squeeze at the top." }),
          a("dbLateralRaise", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbows, stop at shoulder height." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 08 — GLUTE & PHYSIQUE BUILDER (Women · Intermediate · 4 days)

const p08 = (): ProgramDef => {
  const a = h("intermediate");
  return {
    number: 8,
    slug: "jf-glute-physique-builder",
    name: "JF Effect | Glute & Physique Builder — Intermediate — 4 days/week",
    category: "Women",
    level: "Intermediate",
    equipment: "Gym",
    coreDays: 4,
    style: "bodybuilding",
    goal: "Build glutes and legs while training back, shoulders, chest and arms",
    minutes: 65,
    track: "hypertrophy",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Women", "Glutes", "Hypertrophy", "Intermediate", "Gym", "4 days", "Upper Lower"],
    description:
      "Two lower days and two upper days. Lower days are built around the hip thrust, Romanian deadlift, split squats and a heavy squat, with abduction and hamstring work; upper days train your back, shoulders, chest and arms so the whole physique comes along. Each block gets a little harder, with an easier week every fourth week. About 55–75 minutes.",
    coachGuide: [
      "Purpose: glutes and legs first, with real back, shoulder, chest and arm training.",
      "Glute volume: hip thrust 3 (4 in Blocks 2–3) + abduction 4 direct, with RDL, split squat, belt squat and lunge counted as partial overlap ≈ 12–14 effective glute sets a week. Hamstrings 7, quads 7, back 8, delts 6, chest 4.",
      "If hip thrust / RDL / split-squat fatigue gets excessive, trim sets before adding exercises (first the calf raise, then one abduction set).",
      "Trim first if over 75 min: standing calf raise (optional), cable crunch, then one set of the leg extension.",
    ].join("\n"),
    changes: [
      "Lower B: the leg press (second bilateral quad compound right after the belt squat) is replaced by a lying hamstring curl (2x10–15). Hamstrings were the only lower-body muscle under ~6 weekly sets, while quads were still covered by the belt squat, reverse lunge and leg extension.",
      "Hip thrust gets a 4th set in Blocks 2 and 3: the glutes are this program's priority, so they get the volume progression.",
    ],
    days: [
      {
        title: "Day 1 — Lower A (Glutes + Hinge)",
        focus: "Hip thrust, RDL, split squat · about 65 min",
        slots: [
          a("hipThrust", { sets: 3, addB2: 1, reps: "6-10", rest: R.hardCompound, note: "2–3 ramp-up sets. Barbell or machine. Chin tucked, ribs down, 1-second squeeze." }),
          a("rdl", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "Hips back, bar close, stretch without rounding." }),
          a("bss", { sets: 2, reps: "8-12 per side", rest: R.compound, note: "Rear foot on a bench, lean slightly forward for more glute." }),
          a("seatedLegCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Hips pinned, control the lowering." }),
          a("hipAbduction", { sets: 2, reps: "12-20", rest: 60, note: "Lean slightly forward, pause 1 second open." }),
        ],
      },
      {
        title: "Day 2 — Upper A",
        focus: "Back, chest, shoulders, triceps · about 55 min",
        slots: [
          a("latPulldown", { sets: 3, reps: "8-12", rest: R.machine, note: "Pull to the top of the chest, elbows to your sides." }),
          a("inclineDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Low incline, full stretch at the bottom." }),
          a("cableRow", { sets: 2, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach." }),
          a("cableLateral", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbow, constant tension." }),
          a("pushdown", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows pinned, full lockout." }),
        ],
      },
      {
        title: "Day 3 — Lower B (Quads + Glutes)",
        focus: "Squat, lunge, hamstrings, glutes · about 65 min",
        slots: [
          a("beltSquat", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "2–3 ramp-up sets. Upright and deep. Swap: hack squat or a stable squat." }),
          a("dbReverseLunge", { sets: 2, reps: "8-12 per side", rest: R.compound, note: "Step back, front foot flat, drive through the front heel." }),
          a("lyingLegCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Hips down on the pad." }),
          a("legExtension", { sets: 2, reps: "10-15", rest: R.iso, note: "Pause 1 second at the top." }),
          a("hipAbduction", { sets: 2, reps: "12-20", rest: 60 }),
          a("standingCalf", { sets: 2, reps: "10-15", rest: 60, note: "Optional if short on time." }),
        ],
      },
      {
        title: "Day 4 — Upper B",
        focus: "Back, shoulders, chest, arms · about 60 min",
        slots: [
          a("machineChestPress", { sets: 2, reps: "8-12", rest: R.machine, note: "Handles at mid-chest, control the stretch." }),
          a("csRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest on the pad, elbows back to the hips." }),
          a("seatedDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Dumbbells from shoulder height, press up and slightly in." }),
          a("rearDeltMachine", { sets: 2, reps: "12-20", rest: 60 }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows still, full stretch." }),
          a("cableCrunch", { sets: 2, reps: "10-15", rest: R.core, conservative: true }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 09 — ADVANCED PHYSIQUE (Women · Advanced · 4 days)

/** hip thrust: a top set and lighter back-off sets in a hypertrophy program */
const hipThrustTopBack = (): Slot => ({
  ex: "hipThrust",
  rows: (week): WeekRow[] => {
    const base = hypRow("hipThrust", { sets: 3, reps: "6-8", rest: R.hardCompound, level: "advanced" }, week);
    if (isDeload(week)) {
      return [{ ...base, sets: 2, reps: "8-10", note: "Deload: two easy sets, no top set." }];
    }
    const top: WeekRow = { ...base, sets: 1, reps: blockOf(week) === 3 ? "5-7" : "6-8", note: "Top set. 2–3 ramp-up sets first. Chin tucked, ribs down, 1-second squeeze." };
    const back: WeekRow = {
      ex: "hipThrust",
      sets: week === 12 ? 1 : 2,
      reps: "8-10",
      pctOfTop: 92,
      rest: R.compound,
      note: "Back-off sets: 8% less than the top set you just lifted. Skip the drop if the bar can't be loaded that finely.",
    };
    return [top, back];
  },
});

const p09 = (): ProgramDef => {
  const a = h("advanced");
  const iso = { intensityTechnique: true };
  return {
    number: 9,
    slug: "jf-advanced-physique",
    name: "JF Effect | Advanced Physique — Advanced — 4 days/week",
    category: "Women",
    level: "Advanced",
    equipment: "Gym",
    coreDays: 4,
    style: "bodybuilding",
    goal: "Glute and leg specialization with quality upper-body development",
    minutes: 70,
    track: "hypertrophy",
    blockNames: HYP_BLOCKS,
    blockFocus: HYP_FOCUS,
    tags: ["JF Effect", "Women", "Glutes", "Hypertrophy", "Advanced", "Gym", "4 days", "Upper Lower"],
    description:
      "For experienced lifters building glutes and legs without neglecting the upper body. A heavy hip thrust top set with back-off sets, Romanian deadlifts, split squats, step-ups and a heavy squat, plus two upper days for back, shoulders, chest and arms. Precise, not just more: every set has a job. About 60–80 minutes, 4 days a week.",
    coachGuide: [
      "Purpose: glute/leg specialization with quality upper-body work. Higher precision, not automatically higher volume.",
      "Hip thrust: top set 6–8 (5–7 in Block 3) at 1–2 RIR, then 2 back-offs at 92% of the top set (skip the drop if the bar can't be loaded that finely).",
      "Weekly sets (approx.): glutes 3–5 direct + abduction 4 + compounds; hamstrings 6; quads 9; back 8; delts 8 (lateral 3, rear 3, press 2); chest 4; arms 2+2.",
      "Pick 1–2 specialization muscles and shift sets toward them; preserve the upper body. The optional glute bridge on Day 4 is only for weeks when performance and recovery are good.",
      "Intensity techniques: optional rest-pause on the final set of safe isolations in Weeks 7, 10, 11.",
      "Trim first if over 80 min: optional glute bridge, then one set of the reverse pec deck.",
    ].join("\n"),
    changes: [],
    days: [
      {
        title: "Day 1 — Lower A (Glute priority)",
        focus: "Hip thrust top set, RDL, split squat · about 65 min",
        slots: [
          hipThrustTopBack(),
          a("rdl", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "Hips back, bar close, stretch without rounding." }),
          a("bss", { sets: 2, reps: "8-10 per side", rest: R.compound, note: "Rear foot on a bench, slight forward lean." }),
          a("hipAbduction", { sets: 2, reps: "12-20", rest: 60, ...iso }),
        ],
      },
      {
        title: "Day 2 — Upper A",
        focus: "Back, upper chest, shoulders, triceps · about 60 min",
        slots: [
          a("latPulldown", { sets: 3, reps: "6-10", rest: R.machine, note: "Full stretch at the top, elbows to the hips." }),
          a("csRow", { sets: 2, reps: "8-12", rest: R.machine }),
          a("inclineDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Low incline, full stretch." }),
          a("cableLateral", { sets: 3, reps: "12-20", rest: 60, ...iso }),
          a("ohCableTriceps", { sets: 2, reps: "10-15", rest: R.iso, ...iso, note: "Full stretch overhead." }),
        ],
      },
      {
        title: "Day 3 — Lower B (Quads + Glutes)",
        focus: "Squat, leg press, hamstrings, step-up · about 70 min",
        slots: [
          a("beltSquat", { sets: 3, reps: "6-10", repsB3: "5-8", rest: R.hardCompound, note: "2–3 ramp-up sets. Upright and deep. Swap: hack squat or a stable squat." }),
          a("legPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Feet higher on the platform for more glute." }),
          a("seatedLegCurl", { sets: 3, reps: "8-12", rest: R.iso, ...iso }),
          a("dbStepUp", { sets: 2, reps: "8-12 per side", rest: R.compound, note: "Stable box at knee height, drive through the top foot. Swap: reverse lunge." }),
          a("hipAbduction", { sets: 2, reps: "12-20", rest: 60, ...iso }),
        ],
      },
      {
        title: "Day 4 — Upper B",
        focus: "Back, shoulders, chest, arms · about 60 min",
        slots: [
          a("cableRow", { sets: 3, reps: "8-12", rest: R.machine, note: "Chest up, pull to your stomach." }),
          a("seatedDbPress", { sets: 2, reps: "8-12", rest: R.compound }),
          a("cableFly", { sets: 2, reps: "10-15", rest: R.iso, ...iso, note: "Big stretch, hug the arc." }),
          a("rearDeltMachine", { sets: 3, reps: "12-20", rest: 60, ...iso }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: R.iso }),
          a("dbGluteBridge", { sets: 2, reps: "10-15", rest: R.iso, conservative: true, note: "Optional: only when performance and recovery are good this week." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 10 — BODYWEIGHT FOUNDATION (At Home · zero equipment · 3 days)

const NO_PULL = "Zero equipment means no real pulling exercise: this keeps the upper back healthy but doesn't replace rows or pulldowns.";

const p10 = (): ProgramDef => {
  const a = h("intermediate");
  return {
    number: 10,
    slug: "jf-bodyweight-foundation",
    name: "JF Effect | Bodyweight Foundation — Bodyweight only — 3 days/week",
    category: "At Home",
    level: "Any level",
    equipment: "Bodyweight only",
    coreDays: 3,
    style: "lifestyle",
    goal: "Practical strength and fitness at home with no equipment",
    minutes: 40,
    track: "hypertrophy",
    blockNames: HOME_BLOCKS,
    blockFocus: ["Technique", "Volume", "Strength"],
    tags: ["JF Effect", "At Home", "Home", "Bodyweight", "Full Body", "3 days", "Any level"],
    description:
      "Three full-body workouts at home with zero equipment: no bench, bar or bands. Squats, lunges, push-ups, bridges and core work, made harder over 12 weeks with slower reps, pauses, harder variations and single-leg work instead of weights. Every exercise has an easier and a harder version so it fits your level. One honest limit: with no equipment there's no real pulling exercise, so your back gets upper-back drills, not rows. If you later get a pull-up bar or bands, ask your coach for the upgrade. About 30–45 minutes.",
    coachGuide: [
      "Purpose: practical strength/fitness starting point with zero equipment, scaled to ability by exercise variation.",
      "Equipment: none assumed (no pull-up bar, bench, bands, chair or door anchor). Never prescribe door-frame, furniture or towel-anchor rows as defaults.",
      "Limitation (disclosed to the client): prone W / Y-T-W / reverse snow angels are upper-back health drills, not a substitute for rows or pulldowns. Upgrade path if they get a pull-up bar or bands: add rows/pull-downs and move the prone drills to warm-ups.",
      "Progression order: cleaner range and control → more reps → harder leverage or single-leg variation → one more set only when justified. Push-up path: incline/knees → full → 3-second lowering → pause at the bottom → pike push-ups (Day 2) once 15 clean push-ups are easy.",
      "Optional if they have a smooth floor and a towel: sliding leg curls for hamstrings (not assumed).",
    ].join("\n"),
    changes: [
      "Push-ups use one library exercise all week with a different emphasis each day (standard, 3-second lowering, pause at the bottom) instead of switching to pike push-ups by default: most people starting with zero equipment can't do a safe pike push-up yet; it's the Day 2 progression once 15 push-ups are easy.",
    ],
    days: [
      {
        title: "Day 1 — Bodyweight A",
        focus: "Squat, push-up, lunge, bridge · about 35–40 min",
        slots: [
          a("bwSquat", { sets: 3, reps: "10-20", rest: R.bwHard, note: "Full depth you can control. Too easy at 20? Slow the lowering to 3 seconds and pause at the bottom." }),
          a("pushUp", { sets: 3, reps: "6-15", rest: R.bwHard, note: "Knees or full: whichever gives 6–15 hard reps. Body in one line, chest to the floor." }),
          a("bwReverseLunge", { sets: 2, reps: "8-12 per side", rest: R.bwHard, note: "Step back, front foot flat, back knee near the floor." }),
          a("bwGluteBridge", { sets: 2, reps: "12-20", rest: R.bwEasy, note: "Drive through the heels, 2-second squeeze at the top." }),
          a("proneW", { sets: 2, reps: "10-15", rest: R.bwEasy, conservative: true, note: NO_PULL }),
          timed("plank", { sets: 2, seconds: [25, 35, 45], rest: R.bwEasy, note: "Squeeze glutes and abs, straight line." }),
        ],
      },
      {
        title: "Day 2 — Bodyweight B",
        focus: "Split squat, push-up, hinge, upper back · about 40 min",
        slots: [
          a("splitSquat", { sets: 3, reps: "8-15 per side", rest: R.bwHard, note: "Long stance, drop the back knee straight down. Harder: pause 2 seconds at the bottom." }),
          a("pushUp", { sets: 3, reps: "5-12", rest: R.bwHard, note: "3-second lowering every rep. Once 15 clean push-ups are easy, switch to pike push-ups here." }),
          a("bwSingleLegRdl", { sets: 2, reps: "10-15 per side", rest: R.bwEasy, note: "Hinge on one leg, reach the hips back, slow and balanced. Touch a wall if you wobble." }),
          a("proneYTW", { sets: 2, reps: "6-10 each letter", rest: R.bwEasy, conservative: true, note: NO_PULL }),
          a("deadBug", { sets: 2, reps: "8-12 per side", rest: R.bwEasy, conservative: true, note: "Lower back flat, slow." }),
          a("singleLegCalf", { sets: 2, reps: "10-20 per side", rest: R.bwEasy, note: "Full stretch at the bottom. Off a step edge for more range." }),
        ],
      },
      {
        title: "Day 3 — Bodyweight C",
        focus: "Paused squat, push-up, lateral lunge, bridge · about 40 min",
        slots: [
          a("bwSquat", { sets: 3, reps: "10-20", rest: R.bwHard, note: "2-second pause at the bottom of every rep." }),
          a("pushUp", { sets: 3, reps: "6-15", rest: R.bwHard, note: "1-second pause just above the floor." }),
          a("lateralLunge", { sets: 2, reps: "8-12 per side", rest: R.bwEasy, note: "Sit into one hip, other leg straight, chest up." }),
          a("singleLegBridge", { sets: 2, reps: "8-15 per side", rest: R.bwEasy, note: "Hips stay level, 1-second squeeze." }),
          a("proneSnowAngel", { sets: 2, reps: "10-15", rest: R.bwEasy, conservative: true, note: NO_PULL }),
          timed("sidePlank", { sets: 2, seconds: [20, 30, 40], rest: R.bwEasy, perSide: true, note: "Knees down if needed." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 11 — DUMBBELL MUSCLE BUILDER (At Home · dumbbells + floor · 3 days)

const NO_BENCH = "No bench needed.";

const p11 = (): ProgramDef => {
  const a = h("intermediate");
  return {
    number: 11,
    slug: "jf-dumbbell-muscle-builder",
    name: "JF Effect | Dumbbell Muscle Builder — Dumbbells only — 3 days/week",
    category: "At Home",
    level: "Any level",
    equipment: "Dumbbells only",
    coreDays: 3,
    style: "bodybuilding",
    goal: "Build muscle and strength at home with one pair of adjustable dumbbells",
    minutes: 50,
    track: "hypertrophy",
    blockNames: HOME_BLOCKS,
    blockFocus: ["Hypertrophy", "Hypertrophy", "Strength"],
    tags: ["JF Effect", "At Home", "Home", "Dumbbells", "Muscle", "Full Body", "3 days", "Any level"],
    description:
      "Full-body muscle building with one pair of adjustable dumbbells and some floor space: no bench, cables, bands or pull-up bar. Every press is done on the floor and every row is done standing. When the dumbbells get too light, you progress with reps, single-leg work and slower lowering instead of junk sets. About 40–55 minutes, 3 days a week.",
    coachGuide: [
      "Equipment: adjustable dumbbells + floor (~10x10 ft). No bench, bands, cables, machines, pull-up bar or door attachment assumed. Benches/bands only as clearly optional swaps once confirmed.",
      "Weekly sets (approx.): quads 9, hamstrings 5, glutes 2 + compounds, chest 6, back 6 + rear delts 2, delts 3 + 2, arms 2 + 2.",
      "If the dumbbells are too light for bilateral legs, move to split-stance/unilateral work and higher controlled reps rather than adding sets. Adjust set counts to the load range they actually own.",
      "Double progression; smallest dumbbell jump available. When there's no heavier dumbbell: more reps, slower lowering, a pause, single-leg/arm, then an extra set only if recovery allows. No endless tempo tricks.",
    ].join("\n"),
    changes: [],
    days: [
      {
        title: "Day 1 — DB Full Body A",
        focus: "Squat, floor press, row, hinge · about 50 min",
        slots: [
          a("gobletSquat", { sets: 3, reps: "8-15", rest: R.compound, note: "Dumbbell at your chest, sit between your heels, chest up." }),
          a("dbFloorPress", { sets: 3, reps: "6-12", rest: R.compound, note: `Elbows touch the floor and settle, then press. ${NO_BENCH}` }),
          a("oneArmDbRow", { sets: 3, reps: "8-15 per side", rest: R.iso, note: "Free hand braced on your own thigh, flat back, elbow to the hip. No bench needed." }),
          a("dbRdl", { sets: 3, reps: "8-15", rest: R.compound, note: "Hips back, dumbbells close to the legs, big hamstring stretch." }),
          a("dbLateralRaise", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbows, stop at shoulder height." }),
          a("deadBug", { sets: 2, reps: "8-12 per side", rest: R.core, conservative: true, note: "Lower back flat, slow." }),
        ],
      },
      {
        title: "Day 2 — DB Full Body B",
        focus: "Lunge, overhead press, row, glutes · about 50 min",
        slots: [
          a("dbReverseLunge", { sets: 3, reps: "8-12 per side", rest: R.compound, note: "Step back, front foot flat, drive through the front heel." }),
          a("standingDbPress", { sets: 3, reps: "6-12", rest: R.compound, note: "Squeeze glutes, ribs down, press straight up." }),
          a("dbBentRow", { sets: 3, reps: "8-15", rest: R.compound, note: "Hinge to about 45°, flat back, row to the hips." }),
          a("dbGluteBridge", { sets: 2, reps: "10-20", rest: R.iso, note: "One dumbbell across the hip crease, held steady with both hands. 1-second squeeze." }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: 60, note: "Elbows still, full stretch." }),
          a("floorCrunch", { sets: 2, reps: "10-20", rest: R.core, conservative: true, note: "Curl the ribs toward the hips. Hold a dumbbell on your chest when 20 is easy." }),
        ],
      },
      {
        title: "Day 3 — DB Full Body C",
        focus: "Split squat, press, hinge, arms · about 50 min",
        slots: [
          a("dbSplitSquat", { sets: 3, reps: "8-12 per side", rest: R.compound, note: "Long stance, drop the back knee straight down." }),
          a("dbFloorPress", { sets: 3, reps: "8-15", rest: R.compound, note: `Palms facing each other this time. ${NO_BENCH}` }),
          a("dbRdl", { sets: 2, reps: "8-12", rest: R.compound, note: "Slower lowering than Day 1: 3 seconds down." }),
          a("rearDeltDb", { sets: 2, reps: "12-20", rest: 60, note: "Hinge forward, arms long, sweep out to the sides." }),
          a("dbOhTriceps", { sets: 2, reps: "10-15", rest: R.iso, note: "One dumbbell in both hands, elbows forward, full stretch." }),
          timed("suitcaseCarry", { sets: 2, seconds: [30, 40, 45], rest: R.core, perSide: true, note: "One heavy dumbbell, stand tall. March in place if space is tight." }),
        ],
      },
    ],
  };
};

// ===========================================================================
// 12 — AT-HOME PHYSIQUE BUILDER (At Home · dumbbells + bodyweight · 4 days)

const p12 = (): ProgramDef => {
  const a = h("intermediate");
  return {
    number: 12,
    slug: "jf-at-home-physique-builder",
    name: "JF Effect | At-Home Physique Builder — Dumbbells + bodyweight — 4 days/week",
    category: "At Home",
    level: "Any level",
    equipment: "Dumbbells + bodyweight",
    coreDays: 4,
    style: "bodybuilding",
    goal: "Upper/lower muscle building at home without machines, a bench or cables",
    minutes: 55,
    track: "hypertrophy",
    blockNames: HOME_BLOCKS,
    blockFocus: ["Hypertrophy", "Hypertrophy", "Strength"],
    tags: ["JF Effect", "At Home", "Home", "Dumbbells", "Muscle", "Upper Lower", "4 days", "Any level"],
    description:
      "Upper/lower muscle building at home: two lower and two upper days with dumbbells and your bodyweight. No machines, bench or cables, and every exercise fits a small space. Floor presses, standing rows, split squats, Romanian deadlifts and push-ups, made harder over 12 weeks with small weight jumps, reps and single-leg work. About 45–60 minutes, 4 days a week.",
    coachGuide: [
      "Equipment: adjustable dumbbells + bodyweight + floor. No bench, multiple stations or improvised supports. A dumbbell + bodyweight superset (e.g. floor press with push-ups) only if it saves time without costing hard sets.",
      "Weekly sets (approx.): quads 10, hamstrings 5, glutes 4 + compounds, chest 8, back 6 + rear delts 2, delts 2 + 2, biceps 4, triceps 2 + pressing, calves 2.",
      "Progress with the smallest dumbbell jump, then reps, unilateral leverage and range. Not endless tempo tricks.",
      "Scale every exercise to the person's actual skill: this program is equipment-gated, not experience-gated.",
    ].join("\n"),
    changes: [
      "Upper B: the optional prone W raise is replaced by a dumbbell hammer curl (2x10–15). With dumbbells available, rows and rear-delt raises already load the upper back properly, and biceps had only 2 direct sets a week in an intermediate/advanced physique program.",
      "Upper B: the spec's 'dumbbell squeeze floor press' uses the library's floor press with a squeeze cue (press the dumbbells together the whole rep) instead of creating a near-duplicate exercise.",
    ],
    days: [
      {
        title: "Day 1 — Lower A",
        focus: "Squat, hinge, lunge, glutes · about 50 min",
        slots: [
          a("gobletSquat", { sets: 3, reps: "8-15", rest: R.compound, note: "Dumbbell at your chest, sit between your heels." }),
          a("dbRdl", { sets: 3, reps: "8-15", rest: R.compound, note: "Hips back, dumbbells close, big hamstring stretch." }),
          a("dbReverseLunge", { sets: 2, reps: "8-12 per side", rest: R.compound, note: "Step back, drive through the front heel." }),
          a("dbGluteBridge", { sets: 2, reps: "12-20", rest: R.iso, note: "Dumbbell across the hip crease, 1-second squeeze." }),
          a("dbStandingCalf", { sets: 2, reps: "12-20", rest: 60, note: "Off a step edge for range; one leg at a time when two is easy." }),
        ],
      },
      {
        title: "Day 2 — Upper A",
        focus: "Floor press, row, shoulders, biceps · about 50 min",
        slots: [
          a("dbFloorPress", { sets: 3, reps: "6-12", rest: R.compound, note: "Elbows settle on the floor, then press. No bench needed." }),
          a("oneArmDbRow", { sets: 3, reps: "8-15 per side", rest: R.iso, note: "Free hand braced on your thigh, flat back, elbow to the hip." }),
          a("standingDbPress", { sets: 2, reps: "8-12", rest: R.compound, note: "Glutes tight, ribs down, press straight up." }),
          a("dbLateralRaise", { sets: 2, reps: "12-20", rest: 60, note: "Lead with the elbows." }),
          a("dbCurl", { sets: 2, reps: "10-15", rest: 60, note: "Elbows still, full stretch." }),
        ],
      },
      {
        title: "Day 3 — Lower B",
        focus: "Split squat, single-leg hinge, lunge, glutes · about 50 min",
        slots: [
          a("dbSplitSquat", { sets: 3, reps: "8-12 per side", rest: R.compound, note: "Long stance, back knee straight down." }),
          a("bStanceRdl", { sets: 2, reps: "10-15 per side", rest: R.compound, note: "Back toes just for balance, load the front leg." }),
          a("walkingLunge", { sets: 2, reps: "8-12 per side", rest: R.compound, note: "Dumbbells at your sides. No room to walk? Reverse lunges in place." }),
          a("singleLegBridge", { sets: 2, reps: "10-15 per side", rest: R.iso, note: "Hips level, 1-second squeeze. Dumbbell on the hip when 15 is easy." }),
          timed("sidePlank", { sets: 2, seconds: [25, 35, 45], rest: R.core, perSide: true }),
        ],
      },
      {
        title: "Day 4 — Upper B",
        focus: "Push-up, row, rear delts, arms · about 55 min",
        slots: [
          a("pushUp", { sets: 3, reps: "6-15", rest: R.bwHard, note: "Full push-ups; elevate the feet or slow the lowering when 15 is easy." }),
          a("dbBentRow", { sets: 3, reps: "8-15", rest: R.compound, note: "Hinge to about 45°, row to the hips." }),
          a("rearDeltDb", { sets: 2, reps: "12-20", rest: 60, note: "Arms long, sweep out to the sides." }),
          a("dbFloorPress", { sets: 2, reps: "10-15", rest: R.iso, note: "Squeeze grip: press the dumbbells together the whole rep." }),
          a("dbOhTriceps", { sets: 2, reps: "10-15", rest: R.iso, note: "Elbows forward, full stretch." }),
          a("hammerCurl", { sets: 2, reps: "10-15", rest: 60, note: "Palms facing, elbows still." }),
        ],
      },
    ],
  };
};

export const JF_PROGRAMS: ProgramDef[] = [p01(), p02(), p03(), p04(), p05(), p06(), p07(), p08(), p09(), p10(), p11(), p12()];
