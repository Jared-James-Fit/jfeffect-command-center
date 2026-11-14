/**
 * The JF Effect running library: three programs, written out week by week and
 * day by day, in the same builder format as the strength library (build.ts):
 * template_type "block", schema_version "2", one block per training phase.
 *
 *   Run Foundation        beginner, 0 → 5K, 12 weeks, 3 days
 *   Distance Builder      5K → half marathon, 12 weeks, 3 days + 2 optional
 *   Marathon Performance  half → full marathon, 18 weeks, 4 days + 2 optional
 *
 * How they're written, and why:
 * - Every run is prescribed by time and effort (RPE /10, talk test), never by
 *   distance or a pace chart. The same 90 minutes is 13 km for one runner and
 *   18 km for another, so time scales the load to the athlete, protects slower
 *   runners from long-run distances that take them 4 hours, and needs no pace
 *   data we don't have. Athletes log distance and time; pace is worked out.
 * - A session is rows on the library's own Running and Walking exercises: a
 *   warm-up, the main set, a cool-down. An interval session is sets × time
 *   with the recovery as the rest (3 × 8 min, 2 min jog between), so the
 *   logger's set timer and rest timer run it as written.
 * - Core days come first and optional days after: workouts land on training
 *   days in order, so a runner training fewer days gets every core session
 *   (easy, quality, long) and the optional ones are the easy volume a
 *   4- or 5-day runner adds.
 * - Every week has a written purpose (pl_weeks.notes), a lower-stress week
 *   comes every 3–4 weeks, and no week repeats the one before.
 *
 * Pure: the migration writer, the production installer and the tests all
 * use it.
 */

export type RunEx = "run" | "walk";

/** The library's own exercises (read Nov 14 2026, both with a demo video). */
export const RUN_EXERCISES: Record<RunEx, { id: string; name: string }> = {
  run: { id: "af9d328c-7860-4c9e-89ef-de4558bc1ab5", name: "Running" },
  walk: { id: "21c052a0-9d94-4a72-9e16-3fab9fa47936", name: "Walking" },
};

export type RunRole =
  | "Warm-up"
  | "Cool-down"
  | "Run/walk"
  | "Easy"
  | "Recovery"
  | "Long run"
  | "Medium-long"
  | "Steady"
  | "Fartlek"
  | "Threshold"
  | "Tempo"
  | "Race effort"
  | "Marathon pace"
  | "Strides"
  | "5K"
  | "Race";

export type RunRow = {
  ex: RunEx;
  role: RunRole;
  sets: number;
  /** each set's time; null = no time target (a 5K or a race: they log what it took) */
  seconds: number | null;
  /** recovery between sets: a walk on run/walk and strides, an easy jog otherwise */
  rest: number | null;
  rpe: string | null;
  /** what it is when there's no time target ("5 km", "Race") */
  label?: string;
  note?: string;
};

export type RunDay = { title: string; focus: string; optional?: boolean; rows: RunRow[] };
export type RunWeek = { purpose: string; lowerStress?: boolean; days: RunDay[] };
export type RunPhase = { name: string; focus: string; weeks: RunWeek[] };

export type RunProgramDef = {
  slug: string;
  name: string;
  level: "Beginner" | "Intermediate" | "Advanced";
  coreDays: number;
  optionalDays: number;
  /** typical session length, minutes */
  minutes: number;
  goal: string;
  description: string;
  tags: string[];
  phases: RunPhase[];
  coachGuide: string;
  changes: string[];
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const m = (minutes: number) => Math.round(minutes * 60);

const NOTE = {
  easy: "Conversational: you can talk in full sentences. Effort is the target, not pace: slow down for hills, heat and wind.",
  recovery: "Slower than easy and short. It's here to loosen you up, not to train. Skip it if anything hurts.",
  long: "Easy the whole way, as relaxed at the end as at the start. Effort, not pace.",
  runWalk:
    "Easy jog for the run, brisk walk for the walk. Too hard? Slow the run down. Still can't finish them? Run 1 min / walk 1 min for the same total time and repeat this week.",
  strides: "20 s quick but relaxed (not a sprint), then walk back until you're fully recovered. Tall, quick, light feet.",
  steady: "Moderately hard but smooth: faster than easy, well short of hard. Short phrases, not full sentences.",
  fartlek: "Each 1 min a strong, controlled push (not a sprint), each easy minute a real jog. Run by feel.",
  threshold:
    "Controlled hard: a pace you could hold for about an hour, a few words at a time. Even reps, the last as quick as the first. If you're slowing down, ease off: never race these.",
  tempo: "One unbroken block at threshold effort: controlled hard, never all out. Ease off if your form breaks.",
  raceEffort:
    "Goal-race effort: 5K runners RPE 8, 10K RPE 7–8, half marathon RPE 7 (10K effort builds the speed your half pace sits under). Even reps.",
  mp: "Goal marathon effort: steady, breathing up but in control. Practise your race fueling and drinks on it.",
  warmup: "Easy jog, the last few minutes a little quicker.",
  cooldown: "Easy jog or walk.",
};

const fuel = (min: number) =>
  min >= 150
    ? " Fuel like race day: 30–60 g carbohydrate an hour (a gel is about 20–25 g) from the first 30 min, and drink to thirst, more in heat."
    : min >= 90
      ? " Practise fueling: 30–60 g carbohydrate an hour from about 45 min (a gel is about 20–25 g). Drink to thirst, more in heat."
      : "";

const walk = (min: number, role: "Warm-up" | "Cool-down", note?: string): RunRow => ({
  ex: "walk", role, sets: 1, seconds: m(min), rest: null, rpe: role === "Warm-up" ? "2-3" : "1-2",
  note: note ?? (role === "Warm-up" ? "Brisk walk, arms swinging. The last minute a little quicker." : "Easy walk to bring your breathing down."),
});
const jog = (min: number, role: "Warm-up" | "Cool-down"): RunRow => ({
  ex: "run", role, sets: 1, seconds: m(min), rest: null, rpe: "2-3", note: role === "Warm-up" ? NOTE.warmup : NOTE.cooldown,
});
const easy = (min: number, note = NOTE.easy): RunRow => ({ ex: "run", role: "Easy", sets: 1, seconds: m(min), rest: null, rpe: "3-4", note });
const recovery = (min: number, note = NOTE.recovery): RunRow => ({ ex: "run", role: "Recovery", sets: 1, seconds: m(min), rest: null, rpe: "2-3", note });
const longRun = (min: number, note = NOTE.long): RunRow => ({ ex: "run", role: "Long run", sets: 1, seconds: m(min), rest: null, rpe: "3-4", note: note + fuel(min) });
const mediumLong = (min: number): RunRow => ({ ex: "run", role: "Medium-long", sets: 1, seconds: m(min), rest: null, rpe: "3-4", note: NOTE.long + fuel(min) });
const runWalk = (sets: number, runSec: number, walkSec: number): RunRow => ({
  ex: "run", role: "Run/walk", sets, seconds: runSec, rest: walkSec, rpe: "3-4", note: NOTE.runWalk,
});
const continuous = (min: number, note = NOTE.easy): RunRow => ({ ex: "run", role: "Easy", sets: 1, seconds: m(min), rest: null, rpe: "3-4", note });
const strides = (n: number): RunRow => ({ ex: "run", role: "Strides", sets: n, seconds: 20, rest: 60, rpe: "6-7", note: NOTE.strides });
const steady = (min: number): RunRow => ({ ex: "run", role: "Steady", sets: 1, seconds: m(min), rest: null, rpe: "5", note: NOTE.steady });
const fartlek = (n: number): RunRow => ({ ex: "run", role: "Fartlek", sets: n, seconds: 60, rest: 60, rpe: "6", note: NOTE.fartlek });
const threshold = (n: number, min: number, jogSec: number): RunRow => ({
  ex: "run", role: "Threshold", sets: n, seconds: m(min), rest: jogSec, rpe: "6-7", note: NOTE.threshold,
});
const tempo = (min: number): RunRow => ({ ex: "run", role: "Tempo", sets: 1, seconds: m(min), rest: null, rpe: "6-7", note: NOTE.tempo });
const raceEffort = (n: number, min: number, jogSec: number): RunRow => ({
  ex: "run", role: "Race effort", sets: n, seconds: m(min), rest: jogSec, rpe: "7-8", note: NOTE.raceEffort,
});
const mp = (n: number, min: number, jogSec: number | null, note = NOTE.mp): RunRow => ({
  ex: "run", role: "Marathon pace", sets: n, seconds: m(min), rest: jogSec, rpe: "5-6", note,
});

const day = (title: string, focus: string, rows: RunRow[], optional?: boolean): RunDay => ({ title, focus, rows, ...(optional ? { optional } : {}) });

// ---------------------------------------------------------------------------
// Program 1: Run Foundation (0 → 5K)
// ---------------------------------------------------------------------------

type Main = [sets: number, runSec: number, walkSec: number] | number;
const mainRow = (x: Main): RunRow => (typeof x === "number" ? continuous(x) : runWalk(x[0], x[1], x[2]));
const RF_WARM = walk(5, "Warm-up");
const RF_COOL = walk(5, "Cool-down", "Easy walk. Calves and hips can take a gentle stretch after.");

const RF_WEEKS: { purpose: string; lowerStress?: boolean; titles: [string, string, string]; main: [Main, Main, Main] }[] = [
  { purpose: "First week of running: short, easy runs with full walking recovery, so muscles, tendons and bones start adapting before the runs get longer.", titles: ["Run/walk", "Run/walk", "Longer run/walk"], main: [[8, 60, 90], [6, 90, 120], [8, 90, 90]] },
  { purpose: "Each run gets 30 seconds longer. Still easy: finish every one able to talk.", titles: ["Run/walk", "Run/walk", "Longer run/walk"], main: [[8, 90, 90], [6, 120, 120], [6, 150, 120]] },
  { purpose: "Longer runs, shorter walks: about 15 minutes of running a session.", titles: ["Run/walk", "Run/walk", "Longer run/walk"], main: [[6, 150, 90], [5, 180, 90], [5, 210, 90]] },
  { purpose: "Lower-stress week: fewer runs so your body catches up. The long day's runs still get a little longer (4 minutes).", lowerStress: true, titles: ["Run/walk", "Run/walk", "Longer run/walk"], main: [[5, 150, 90], [5, 180, 90], [4, 240, 120]] },
  { purpose: "Continuous running starts: runs of 4–6 minutes.", titles: ["Run intervals", "Run intervals", "Longer run"], main: [[4, 240, 90], [3, 300, 120], [3, 360, 120]] },
  { purpose: "Runs of 6–10 minutes with short walks.", titles: ["Run intervals", "Run intervals", "Longer run"], main: [[3, 360, 90], [3, 420, 120], [2, 600, 120]] },
  { purpose: "Two 12-minute runs on the long day: close to 25 minutes of running in one go.", titles: ["Run intervals", "Run intervals", "Longer run"], main: [[3, 420, 60], [2, 600, 90], [2, 720, 90]] },
  { purpose: "Lower-stress week, and your first continuous 15- and 20-minute runs.", lowerStress: true, titles: ["Run intervals", "Continuous run", "Continuous run"], main: [[2, 600, 60], 15, 20] },
  { purpose: "20–25 minutes without a walk. Pace doesn't matter; finishing easy does.", titles: ["Easy run", "Easy run", "Long easy run"], main: [20, 18, 26] },
  { purpose: "Building toward 30 minutes of continuous running.", titles: ["Easy run", "Easy run", "Long easy run"], main: [22, 20, 30] },
  { purpose: "The longest run of the program (35 minutes). If it's comfortable, you're ready for 5 km.", titles: ["Easy run", "Easy run", "Long easy run"], main: [25, 20, 35] },
  { purpose: "A lighter week, then your 5 km run on day 3. Not ready yet? Repeat weeks 10 and 11 first: there's no deadline.", lowerStress: true, titles: ["Easy run", "Easy shakeout", "5K run"], main: [20, 15, 0] },
];

const RF_5K: RunRow = {
  ex: "run", role: "5K", sets: 1, seconds: null, rest: null, rpe: "4-6", label: "5 km",
  note: "Run 5 km without stopping at a comfortable, steady effort: not a race. Log the distance and your time. Not ready? Run 30 min easy instead and repeat weeks 10–11.",
};

function runFoundation(): RunPhase[] {
  const weeks: RunWeek[] = RF_WEEKS.map((w, i) => ({
    purpose: w.purpose,
    lowerStress: w.lowerStress,
    days: w.titles.map((title, di) => {
      const main = i === 11 && di === 2 ? RF_5K : mainRow(w.main[di]);
      const focus = typeof w.main[di] === "number" ? "Easy aerobic · continuous" : "Easy aerobic · run/walk";
      return day(title, i === 11 && di === 2 ? "5 km" : focus, [RF_WARM, main, RF_COOL]);
    }),
  }));
  return [
    { name: "Running adaptation", focus: "Run/walk intervals at an easy effort", weeks: weeks.slice(0, 4) },
    { name: "Continuous running", focus: "Longer runs, shorter walks", weeks: weeks.slice(4, 8) },
    { name: "5K preparation", focus: "20–35 minutes continuous, then 5 km", weeks: weeks.slice(8, 12) },
  ];
}

// ---------------------------------------------------------------------------
// Program 2: Distance Builder (5K → half marathon)
// ---------------------------------------------------------------------------

type Quality = { title: string; focus: string; rows: RunRow[] };
const q = (title: string, focus: string, rows: RunRow[]): Quality => ({ title, focus, rows });

const DB_WEEKS: {
  purpose: string;
  lowerStress?: boolean;
  easy: number;
  strides: number;
  quality: Quality;
  long: number | "race";
  optEasy: number;
  optRecovery: number | null;
}[] = [
  { purpose: "Base: find a steady rhythm of easy running, with one short steady finish and quick strides for economy.", easy: 30, strides: 4,
    quality: q("Steady finish", "Aerobic · steady", [easy(20), steady(10)]), long: 45, optEasy: 30, optRecovery: 20 },
  { purpose: "Base: first fartlek, eight 1-minute pushes inside an easy run. The long run gets 5 minutes longer.", easy: 35, strides: 4,
    quality: q("Fartlek", "Aerobic · fartlek", [jog(10, "Warm-up"), fartlek(8), jog(10, "Cool-down")]), long: 50, optEasy: 30, optRecovery: 25 },
  { purpose: "Base: the most volume of the block. Ten 1-minute pushes and a 55-minute long run.", easy: 35, strides: 6,
    quality: q("Fartlek", "Aerobic · fartlek", [jog(10, "Warm-up"), fartlek(10), jog(10, "Cool-down")]), long: 55, optEasy: 35, optRecovery: 25 },
  { purpose: "Lower-stress week: everything a little shorter so the base sets in.", lowerStress: true, easy: 30, strides: 4,
    quality: q("Steady finish", "Aerobic · steady", [easy(20), steady(8)]), long: 45, optEasy: 25, optRecovery: 20 },
  { purpose: "Threshold starts: three 6-minute reps at a controlled-hard effort, never racing them.", easy: 35, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(12, "Warm-up"), threshold(3, 6, 120), jog(10, "Cool-down")]), long: 60, optEasy: 35, optRecovery: 25 },
  { purpose: "Threshold reps grow to 8 minutes. The long run passes an hour.", easy: 40, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(12, "Warm-up"), threshold(3, 8, 120), jog(10, "Cool-down")]), long: 65, optEasy: 35, optRecovery: 25 },
  { purpose: "Twenty minutes of unbroken tempo: the same effort, held longer.", easy: 40, strides: 6,
    quality: q("Tempo run", "Threshold · tempo", [jog(12, "Warm-up"), tempo(20), jog(10, "Cool-down")]), long: 70, optEasy: 40, optRecovery: 30 },
  { purpose: "Lower-stress week: two threshold reps and a shorter long run.", lowerStress: true, easy: 35, strides: 4,
    quality: q("Threshold intervals", "Threshold", [jog(12, "Warm-up"), threshold(2, 8, 120), jog(10, "Cool-down")]), long: 55, optEasy: 30, optRecovery: 20 },
  { purpose: "Race-specific: 4-minute reps at goal-race effort, and the long run reaches 75 minutes.", easy: 40, strides: 6,
    quality: q("Race-effort intervals", "Race-specific", [jog(15, "Warm-up"), raceEffort(5, 4, 120), jog(10, "Cool-down")]), long: 75, optEasy: 40, optRecovery: 30 },
  { purpose: "Race-specific: the longest threshold reps (12 minutes) and the longest run of the program.", easy: 40, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(2, 12, 180), jog(10, "Cool-down")]), long: 85, optEasy: 40, optRecovery: 30 },
  { purpose: "The taper starts: the last race-effort session and a shorter long run, so you arrive fresh.", easy: 35, strides: 4,
    quality: q("Race-effort intervals", "Race-specific", [jog(15, "Warm-up"), raceEffort(4, 5, 120), jog(10, "Cool-down")]), long: 60, optEasy: 30, optRecovery: 25 },
  { purpose: "Race week: short, easy runs and one sharpener, then race on day 3.", lowerStress: true, easy: 30, strides: 4,
    quality: q("Race sharpener", "Race-specific", [jog(10, "Warm-up"), raceEffort(4, 1, 120), jog(5, "Cool-down")]), long: "race", optEasy: 20, optRecovery: null },
];

const DB_LONG_NOTE = (min: number) =>
  min >= 75
    ? `${NOTE.long} Half-marathon runners: go to 90–100 min this week if your last two long runs felt easy. 5K runners can stop at 60 min.`
    : NOTE.long;

const RACE_ROW: RunRow = {
  ex: "run", role: "Race", sets: 1, seconds: null, rest: null, rpe: "8-9", label: "Race",
  note: "Start a touch slower than goal effort for the first 10%, settle in, and finish strongest. Nothing new today: shoes, breakfast and fueling you've already trained with. Log your distance and time.",
};

function distanceBuilder(): RunPhase[] {
  const weeks: RunWeek[] = DB_WEEKS.map((w, i) => {
    const last = i === DB_WEEKS.length - 1;
    const days: RunDay[] = [
      day("Easy run + strides", "Aerobic · easy", [easy(w.easy), strides(w.strides)]),
      day(w.quality.title, w.quality.focus, w.quality.rows),
      w.long === "race"
        ? day("Race day", "Race", [jog(12, "Warm-up"), RACE_ROW, walk(10, "Cool-down", "Walk, then eat and drink within the hour.")])
        : day("Long run", "Aerobic · long", [longRun(w.long, DB_LONG_NOTE(w.long))]),
      day(last ? "Recovery jog (after the race)" : "Easy run", "Aerobic · easy", [
        last ? recovery(w.optEasy, "Only after a 5K or 10K, and only if your legs feel normal. After a half: walk instead.") : easy(w.optEasy),
      ], true),
    ];
    if (w.optRecovery != null) days.push(day("Recovery run", "Recovery", [recovery(w.optRecovery)], true));
    return { purpose: w.purpose, lowerStress: w.lowerStress, days };
  });
  return [
    { name: "Aerobic base", focus: "Easy volume, strides and fartlek", weeks: weeks.slice(0, 4) },
    { name: "Threshold development", focus: "Controlled threshold intervals and tempo", weeks: weeks.slice(4, 8) },
    { name: "Race-specific", focus: "Goal-race effort, taper and race", weeks: weeks.slice(8, 12) },
  ];
}

// ---------------------------------------------------------------------------
// Program 3: Marathon Performance (half → full marathon)
// ---------------------------------------------------------------------------

/** minutes a set of intervals takes, recoveries between them included */
export const rowMinutes = (r: RunRow) => ((r.seconds ?? 0) * r.sets + (r.rest ?? 0) * Math.max(0, r.sets - 1)) / 60;

/** a long run with marathon-pace work inside it: easy, then the marathon-pace part, then (optionally) easy to finish */
const longWithMp = (totalMin: number, mpRow: RunRow, easyAfterMin: number): RunRow[] => {
  const before = totalMin - rowMinutes(mpRow) - easyAfterMin;
  const rows: RunRow[] = [{ ...longRun(before), note: `Easy to start; the marathon-pace part comes after this.${fuel(totalMin)}` }];
  rows.push(mpRow);
  if (easyAfterMin > 0) rows.push({ ...easy(easyAfterMin, "Back to easy to finish, even if the pace slows."), role: "Long run" });
  return rows;
};

const MP_W: {
  purpose: string;
  lowerStress?: boolean;
  easy: number;
  strides: number;
  quality: Quality;
  mediumLong: number;
  long: RunRow[] | "race";
  optRecovery: number;
  optEasy: number | null;
}[] = [
  // Phase 1: aerobic foundation
  { purpose: "Foundation: settle into four or more runs a week, all easy, with strides for economy. Mileage climbs slowly from what you already run.", easy: 45, strides: 0,
    quality: q("Easy + strides", "Aerobic · strides", [easy(40), strides(6)]), mediumLong: 60, long: [longRun(90)], optRecovery: 30, optEasy: 45 },
  { purpose: "Foundation: a first fartlek, and the long run to 100 minutes with fueling practice.", easy: 50, strides: 6,
    quality: q("Fartlek", "Aerobic · fartlek", [jog(15, "Warm-up"), fartlek(8), jog(10, "Cool-down")]), mediumLong: 65, long: [longRun(100)], optRecovery: 30, optEasy: 45 },
  { purpose: "Foundation: 25 minutes of steady running, the most volume of the phase.", easy: 50, strides: 6,
    quality: q("Steady run", "Aerobic · steady", [jog(15, "Warm-up"), steady(25), jog(10, "Cool-down")]), mediumLong: 70, long: [longRun(105)], optRecovery: 35, optEasy: 50 },
  { purpose: "Lower-stress week: shorter runs and strides only, so the foundation is absorbed before the endurance phase.", lowerStress: true, easy: 40, strides: 0,
    quality: q("Easy + strides", "Aerobic · strides", [easy(35), strides(6)]), mediumLong: 55, long: [longRun(80)], optRecovery: 30, optEasy: 40 },
  // Phase 2: endurance development
  { purpose: "Endurance: threshold intervals begin, and the long run passes 1 hour 50.", easy: 50, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(3, 8, 120), jog(10, "Cool-down")]), mediumLong: 70, long: [longRun(110)], optRecovery: 35, optEasy: 50 },
  { purpose: "Endurance: 10-minute threshold reps and a 2-hour long run.", easy: 55, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(3, 10, 180), jog(10, "Cool-down")]), mediumLong: 75, long: [longRun(120)], optRecovery: 35, optEasy: 50 },
  { purpose: "Endurance: two 15-minute threshold blocks, and the long run to 2 hours 10.", easy: 55, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(2, 15, 180), jog(10, "Cool-down")]), mediumLong: 80, long: [longRun(130)], optRecovery: 40, optEasy: 55 },
  { purpose: "Lower-stress week before marathon-specific work: shorter long run, a light threshold session.", lowerStress: true, easy: 45, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(2, 10, 180), jog(10, "Cool-down")]), mediumLong: 65, long: [longRun(100)], optRecovery: 30, optEasy: 40 },
  // Phase 3: marathon-specific
  { purpose: "Marathon-specific: first marathon-pace intervals (3 × 15 min). The long run stays easy.", easy: 55, strides: 6,
    quality: q("Marathon-pace intervals", "Marathon-specific", [jog(15, "Warm-up"), mp(3, 15, 300), jog(10, "Cool-down")]), mediumLong: 80, long: [longRun(135)], optRecovery: 40, optEasy: 55 },
  { purpose: "Marathon-specific: threshold this week, and the long run finishes with 20 minutes at marathon pace.", easy: 60, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(4, 8, 120), jog(10, "Cool-down")]), mediumLong: 85,
    long: longWithMp(140, mp(1, 20, null, "The last 20 minutes at goal marathon effort, on tired legs. Practise your race fueling on it."), 0), optRecovery: 40, optEasy: 55 },
  { purpose: "Marathon-specific: two 25-minute marathon-pace blocks and a 2-and-a-half-hour easy long run.", easy: 60, strides: 6,
    quality: q("Marathon-pace intervals", "Marathon-specific", [jog(15, "Warm-up"), mp(2, 25, 300), jog(10, "Cool-down")]), mediumLong: 90, long: [longRun(150)], optRecovery: 40, optEasy: 60 },
  { purpose: "Lower-stress week: shorter everything, one light threshold session. Let the big weeks land.", lowerStress: true, easy: 45, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(3, 8, 120), jog(10, "Cool-down")]), mediumLong: 70, long: [longRun(110)], optRecovery: 30, optEasy: 45 },
  { purpose: "Marathon-specific: the long run reaches 2 hours 40 with two 20-minute marathon-pace blocks inside it; the midweek session is threshold.", easy: 60, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(3, 10, 120), jog(10, "Cool-down")]), mediumLong: 90,
    long: longWithMp(160, mp(2, 20, 300), 45), optRecovery: 40, optEasy: 60 },
  // Phase 4: peak specificity
  { purpose: "Peak: the longest run of the build (2 hours 50, all easy) as a full race-day rehearsal: breakfast, shoes, kit and fueling.", easy: 60, strides: 6,
    quality: q("Marathon-pace intervals", "Marathon-specific", [jog(15, "Warm-up"), mp(2, 20, 240), jog(10, "Cool-down")]), mediumLong: 90,
    long: [longRun(170, `${NOTE.long} Full race rehearsal: race breakfast 3 hours before, race shoes and kit, race fueling every 20–30 minutes.`)], optRecovery: 40, optEasy: 60 },
  { purpose: "Peak: the dress rehearsal, 45 minutes at marathon pace inside a 2-and-a-half-hour run. Midweek is light threshold.", easy: 55, strides: 6,
    quality: q("Threshold intervals", "Threshold", [jog(15, "Warm-up"), threshold(3, 8, 120), jog(10, "Cool-down")]), mediumLong: 80,
    long: longWithMp(150, mp(1, 45, null, `45 minutes at goal marathon effort, fueled exactly as on race day. If it feels harder than RPE 6, your goal is too fast: adjust it now, not on race day.`), 15), optRecovery: 35, optEasy: 50 },
  // Phase 5: taper and race
  { purpose: "Taper week 1: volume drops about a quarter, the intensity stays. Freshness comes from less, not from nothing.", lowerStress: true, easy: 50, strides: 6,
    quality: q("Marathon-pace intervals", "Taper", [jog(15, "Warm-up"), mp(3, 12, 180), jog(10, "Cool-down")]), mediumLong: 70,
    long: longWithMp(120, mp(1, 20, null), 0), optRecovery: 30, optEasy: 45 },
  { purpose: "Taper week 2: about 60% of peak volume, short marathon-pace reps to keep the rhythm. Sleep and carbohydrate matter more than training now.", lowerStress: true, easy: 40, strides: 6,
    quality: q("Marathon-pace intervals", "Taper", [jog(15, "Warm-up"), mp(2, 10, 180), jog(10, "Cool-down")]), mediumLong: 55, long: [longRun(90)], optRecovery: 25, optEasy: 35 },
  { purpose: "Race week: a short tune-up, easy runs, extra carbohydrate the last 2 days, then race on day 4.", lowerStress: true, easy: 30, strides: 4,
    quality: q("Race-pace tune-up", "Race week", [jog(15, "Warm-up"), mp(3, 5, 120), jog(10, "Cool-down")]), mediumLong: 30, long: "race", optRecovery: 20, optEasy: null },
];

const MARATHON_RACE: RunRow = {
  ex: "run", role: "Race", sets: 1, seconds: null, rest: null, rpe: "8-9", label: "Marathon",
  note:
    "First 5 km a touch slower than goal pace, then settle at goal effort and hold it through 30 km; race the last 10 km if you still have it. Fuel from the start: 30–60 g carbohydrate an hour (up to 60–90 if you've trained your gut for it), drink to thirst, more in heat. Nothing new today. Log your distance and time.",
};

function marathonPerformance(): RunPhase[] {
  const weeks: RunWeek[] = MP_W.map((w) => {
    const raceWeek = w.long === "race";
    const days: RunDay[] = [
      day(w.strides ? "Easy run + strides" : "Easy run", "Aerobic · easy", w.strides ? [easy(w.easy), strides(w.strides)] : [easy(w.easy)]),
      day(w.quality.title, w.quality.focus, w.quality.rows),
      raceWeek
        ? day("Easy run + strides", "Race week", [easy(w.mediumLong, "Short and easy. Legs should feel springy by the end."), strides(4)])
        : day("Medium-long run", "Aerobic · medium-long", [mediumLong(w.mediumLong)]),
      raceWeek
        ? day("Race day", "Marathon", [
            jog(8, "Warm-up"),
            MARATHON_RACE,
            walk(15, "Cool-down", "Walk it out, then eat and drink within the hour. Easy walking only for 3–4 days; no hard running for 2 weeks."),
          ])
        : day((w.long as RunRow[]).some((r) => r.role === "Marathon pace") ? "Long run with marathon pace" : "Long run", "Aerobic · long", w.long as RunRow[]),
      day(raceWeek ? "Recovery walk or jog (after the race)" : "Recovery run", "Recovery", [
        raceWeek ? recovery(w.optRecovery, "Only if your legs feel normal; a walk is just as good this week.") : recovery(w.optRecovery),
      ], true),
    ];
    if (w.optEasy != null) days.push(day("Easy run", "Aerobic · easy", [easy(w.optEasy)], true));
    return { purpose: w.purpose, lowerStress: w.lowerStress, days };
  });
  return [
    { name: "Aerobic foundation", focus: "Consistent easy volume, strides, long-run tolerance", weeks: weeks.slice(0, 4) },
    { name: "Endurance development", focus: "Threshold intervals and progressive long runs", weeks: weeks.slice(4, 8) },
    { name: "Marathon-specific", focus: "Marathon-pace work, long runs to 2 h 40", weeks: weeks.slice(8, 13) },
    { name: "Peak specificity", focus: "Race rehearsal and the dress rehearsal", weeks: weeks.slice(13, 15) },
    { name: "Taper and race", focus: "Less volume, same rhythm, race", weeks: weeks.slice(15, 18) },
  ];
}

// ---------------------------------------------------------------------------
// Coach guides (template notes: what Edit with AI reads to adapt a copy)
// ---------------------------------------------------------------------------

const INTENSITY_GUIDE = `Effort scale (RPE /10, with the talk test when there's no pace or heart-rate data):
- Recovery 2–3: very comfortable, full conversation.
- Easy 3–4: conversational, full sentences. Most running lives here.
- Steady / marathon effort 5–6: short phrases.
- Threshold 6–7: controlled hard, a few words at a time; a pace you could hold about an hour. Never raced.
- Intervals 7–9: hard, depending on length (5K effort about 8).
- Maximum 10: all out. Never prescribed in training.
Pace is a guide, effort is the rule: hills, heat, wind, trails and fatigue all slow the pace at the same effort. Only set paces from a recent race or time trial run flat and in good conditions (a 5K or 10K within 6–8 weeks); never from gym strength or bodyweight.`;

const PROGRESSION_GUIDE = `Progress on readiness, not on the calendar:
- Move to the next week when the athlete did at least 80% of the planned runs, easy runs felt easy (RPE 4 or less, talk test passed), soreness was gone within 48 hours, and nothing hurt.
- Repeat the week when they missed 2 or more runs, easy runs crept to RPE 5+, or they're unusually tired. Repeating is progress done properly, not failure.
- Missed sessions are never made up or stacked into the next week. Missed one: carry on. Missed a week: repeat the last completed week. Two or more weeks off: go back two weeks. Ill: no running until 1–2 days symptom-free, then easy only.
- Pain that changes how they run, gets worse during a run, or lasts more than a few days: stop running that day, switch to walking or cycling if it's pain-free, and get it assessed by a physio or doctor before progressing. Never progress through pain.`;

const STRENGTH_GUIDE = `Strength training alongside (1–2 sessions a week suits most runners: squat or split squat, Romanian deadlift, calf raises, hamstring curls, hip thrusts, rows, presses, trunk work):
- Keep heavy lower-body work at least 48 hours before the quality session and the long run; the best slot is the same day as an easy run (run first) or the day after the long run is avoided.
- Never heavy legs the day before the long run.
- A powerlifter running for health or a 5K follows Run Foundation even if they're strong: strength doesn't transfer to tendons and bones used to impact. Someone training for a meet and a race at the same time can't maximise both: decide which one leads this block and keep the other at maintenance.`;

const SCHEDULE_GUIDE = (core: string, optional: string, longDay: string) => `Days: ${core} ${optional}
Workouts land on the athlete's training days in order, so ${longDay} If their long-run day is different (e.g. Sunday), move it in the calendar or ask Edit with AI ("long run on Sundays"). Keep at least one easy day or rest day between the quality session and the long run.`;

const DURATION_GUIDE = (weeks: number) => `Length and race date: ${weeks} weeks as written. Start it so the last week is race week (start = race date minus ${weeks} weeks, on a Monday). Less time than that: shorten the early weeks (delete from the start), never the taper. More time: repeat the base weeks first. If the race is too close for the athlete's current running, tell them plainly and plan a later race or a completion goal.`;

const RF_GUIDE = `Run Foundation (0 → 5K): for anyone who runs little or not at all, including strong lifters who don't run. Goal: 30+ minutes of easy continuous running and a 5 km finish.
${SCHEDULE_GUIDE("3 a week, never on back-to-back days (e.g. Mon / Wed / Sat).", "", "the longer run (day 3) lands on the 3rd training day: pick days so it's the weekend.")}
Every session: 5 min brisk walk, the run, 5 min walk. All running is easy (RPE 3–4); there are no speed sessions on purpose. Run/walk ratios adapt to the person: shorten the run, keep the walk, or repeat a week. Someone who can already jog 10 minutes can start at week 5; 20 minutes, week 9.
${PROGRESSION_GUIDE}
${INTENSITY_GUIDE}
${STRENGTH_GUIDE}
${DURATION_GUIDE(12)}`;

const DB_GUIDE = `Distance Builder (5K → half marathon): for runners who can already run 30 minutes continuously, 2–3 times a week (roughly 15–25 km a week). Goal: a faster 5K or 10K, or finishing a half marathon strongly.
${SCHEDULE_GUIDE("3 core runs (easy + strides, the quality session, the long run) and 2 optional ones (an easy run and a recovery run).", "A 3-day runner does the core 3 and deletes the optional days (Edit with AI: \"remove the optional runs\"); 4 days adds the easy run; 5 days adds both.", "the long run is the 3rd training day.")}
Block by block: aerobic base (easy volume, strides, fartlek), then threshold development (controlled 6–12 min reps, a 20 min tempo), then race-specific (goal-race-effort reps, a taper and the race in week 12). One quality session a week; everything else easy. A lower-stress week every 4th week. Long run reaches 85 min (90–100 for half-marathon runners, 60 is plenty for 5K).
Volume: written for someone running ~2–3 h a week. Lower than that: cut every easy and long run by 20–30% for the first block. Higher: add easy minutes, never extra quality sessions. No fixed 10% rule: increase what they've proven they absorb. The long run is about 40–45% of a 3-day week (that's fine) and should drop to about a third as they add the optional days.
Half marathon from a low base: allow 16 weeks by repeating the threshold block's weeks 5–7 before week 9. Fueling for runs over 75–90 min: 30–60 g carbohydrate an hour, practised in training.
${PROGRESSION_GUIDE}
${INTENSITY_GUIDE}
${STRENGTH_GUIDE}
${DURATION_GUIDE(12)}`;

const MP_GUIDE = `Marathon Performance (half → full marathon): for experienced runners already running 4+ days and roughly 35–60 km a week, with a recent long run of 75–90 minutes and a half marathon behind them. Goal: finish or race a marathon (a half-marathon racer can use weeks 1–12 and race at the end of a 2-week taper).
${SCHEDULE_GUIDE("4 core runs (easy + strides, the quality session, a medium-long run, the long run) and 2 optional ones (a recovery run and an easy run).", "4 days: delete the optional days; 5 days: keep the recovery run; 6 days: keep both. Don't force 6 days on someone who doesn't recover from 5.", "the long run is the 4th training day and the medium-long the 3rd: if those fall back to back, move the medium-long earlier in the week.")}
Phases: aerobic foundation (weeks 1–4), endurance development with threshold (5–8), marathon-specific with marathon-pace work (9–13), peak specificity with the race rehearsal and the dress rehearsal (14–15), a 3-week taper and the race (16–18). One quality session a week, plus marathon pace inside some long runs (not all of them). Lower-stress weeks in weeks 4, 8 and 12.
Long runs are written in time (90 → 170 min) so a slower runner never runs 30–35 km just because the plan said so: 2 h 50 easy is about 30 km for a 3:15 marathoner and about 24 km for a 4:30 one, and both are enough.
Volume: written for ~4.5–6 h a week across 4–6 days. Lower base: shorten easy and medium-long runs by 20%. Never add quality to make up volume.
Fueling: practise from week 2 on every run over 90 minutes, building to the race plan: 30–60 g carbohydrate an hour for most runners, up to 60–90 g only for those who've trained their gut. Race week: extra carbohydrate the last 2 days (about 6–8 g per kg of bodyweight a day), nothing new on race day.
Race day and after: warm up 5–10 min easy, start conservatively, fuel from the start. After: 3–4 days of walking, easy short runs for the next 2 weeks, no hard sessions for 2 weeks.
${PROGRESSION_GUIDE}
${INTENSITY_GUIDE}
${STRENGTH_GUIDE}
${DURATION_GUIDE(18)}`;

// ---------------------------------------------------------------------------
// The programs
// ---------------------------------------------------------------------------

export const RUN_PROGRAMS: RunProgramDef[] = [
  {
    slug: "jf-run-foundation",
    name: "JF Effect | Run Foundation — Beginner — 3 days/week",
    level: "Beginner",
    coreDays: 3,
    optionalDays: 0,
    minutes: 35,
    goal: "Go from little or no running to 30 minutes continuous and a 5 km finish",
    description:
      "Your first running program. Three short sessions a week start as easy run/walk intervals and build, a little at a time, to 30 minutes of continuous running and a 5 km run in week 12. Everything is easy enough to talk through: no speed work, no pace targets, just time and effort. Every session is a 5-minute walk, the run, and a 5-minute walk. Struggling with a week? Repeat it. Strong lifters who don't run start here too.",
    tags: ["JF Effect", "Running", "Beginner", "0–5K", "3 days"],
    phases: runFoundation(),
    coachGuide: RF_GUIDE,
    changes: [
      "A lower-stress week in each block (weeks 4, 8 and 12) instead of straight-line progression; the longest single run still grows in weeks 4 and 8 so the athlete feels progress.",
      "Block 3 tops out at a 35-minute run instead of 45: about the time a beginner needs for 5 km at an easy effort, without the extra impact a 45-minute run costs someone in their 3rd month of running.",
      "The 5 km in week 12 is a comfortable continuous run, not a race, with a written fallback (30 min easy, repeat weeks 10–11) instead of forcing the distance.",
    ],
  },
  {
    slug: "jf-distance-builder",
    name: "JF Effect | Distance Builder — Intermediate — 3 days/week + 2 optional runs",
    level: "Intermediate",
    coreDays: 3,
    optionalDays: 2,
    minutes: 50,
    goal: "Run a faster 5K or 10K, or finish a half marathon strong",
    description:
      "For runners who can already run 30 minutes. Each week is one easy run with strides, one quality session and one long run, plus up to two optional easy runs if you run 4–5 days. Twelve weeks in three blocks: aerobic base, threshold (controlled-hard intervals and a tempo run), then race-specific work, a short taper and race day in week 12. Everything is set by time and effort, so it fits your pace, and most of your running stays easy.",
    tags: ["JF Effect", "Running", "Intermediate", "5K–Half", "3–5 days"],
    phases: distanceBuilder(),
    coachGuide: DB_GUIDE,
    changes: [
      "One template covers 5K, 10K and the half marathon: the race-effort sessions are written by effort (5K RPE 8, 10K 7–8, half 7) and the long run note tells half runners to extend to 90–100 min, instead of three race-specific programs.",
      "Default length 12 weeks; a half marathon from a low base repeats the threshold block (16 weeks), written in the coach guide.",
      "Three core days are the right consolidation for a 3-day runner (one easy, one quality, one long); the 4th and 5th days are optional easy volume, never a second quality day.",
      "No fixed 10% weekly increase: volume follows what the athlete absorbs (coach guide).",
    ],
  },
  {
    slug: "jf-marathon-performance",
    name: "JF Effect | Marathon Performance — Advanced — 4 days/week + 2 optional runs",
    level: "Advanced",
    coreDays: 4,
    optionalDays: 2,
    minutes: 70,
    goal: "Prepare for and race a marathon (or a half marathon) with the endurance, pacing and fueling to finish strong",
    description:
      "For experienced runners heading to a marathon. Eighteen weeks: aerobic foundation, endurance and threshold, marathon-specific work, a peak with full race rehearsals, then a 3-week taper and race day. Four core runs a week (easy with strides, one quality session, a medium-long run and the long run) plus up to two optional easy runs. Long runs are set by time (up to 2 h 50), never forced to 30–35 km, and you'll practise race fueling all the way through.",
    tags: ["JF Effect", "Running", "Advanced", "Half–Marathon", "4–6 days"],
    phases: marathonPerformance(),
    coachGuide: MP_GUIDE,
    changes: [
      "18 weeks as the default inside the spec's 16–24: four weeks each of foundation and endurance, five marathon-specific, two peak, three of taper and race. Longer preparations repeat foundation weeks; shorter ones drop from the start, never the taper.",
      "Peak long run 170 min by time instead of a distance, and marathon pace inside only three long runs plus the taper week, so not every long run is a workout.",
      "Threshold and marathon-pace sessions alternate in the marathon-specific phase, so there's never more than one hard midweek session.",
    ],
  },
];

/** Fixed ids, hashed from each slug like the strength library's (stableUuid in sql.ts; the test re-derives them). */
export const RUN_TEMPLATE_IDS: Record<string, string> = {
  "jf-run-foundation": "95bbbe24-052d-5f0e-ac70-2d5936332b83",
  "jf-distance-builder": "7c8f6059-fa93-5bbb-af11-f8312ac3b18d",
  "jf-marathon-performance": "0801019d-2cb4-5a6a-8595-d7e73b1c7af4",
};
