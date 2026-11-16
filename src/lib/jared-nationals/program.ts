/**
 * Jared McIntyre: 2027 Canada Powerlifting National Championships prep
 * (Nanaimo BC, Feb 8–13 2027, lifting day TBD; Feb 8 is the conservative
 * anchor). The coach's 12-week program (Nov 16 2026), written week by week,
 * with the small data-based changes listed in PREP_CHANGES.
 *
 * Pure data: scripts/jared-nationals/write-migration.ts turns it into the
 * migration that rewrites Jared's untouched future workouts (and the library
 * template) in place; src/test/jared-nationals-prep.test.ts holds the coaching
 * rules (the coach's final audit) and keeps the migration in step.
 *
 * Loading (load-reference.ts): a top single is RPE only; back-offs and
 * competition-related secondaries are a % of the Training Max with the RPE as a
 * cap (the cap beats the %); accessories are RPE. A range ("72.5–75%") loads its
 * low end and the note gives the top. Weeks run Sunday to Saturday like the
 * rest of the program (training Mon / Tue / Thu / Sat).
 */
import type { ExKey } from "./catalog";

export type Dow = "Mon" | "Tue" | "Thu" | "Sat";
export const DOW_OFFSET: Record<Dow, number> = { Mon: 1, Tue: 2, Thu: 4, Sat: 6 };
export const DAY_INDEX: Record<Dow, number> = { Mon: 1, Tue: 2, Thu: 3, Sat: 4 };

export type Basis = "training_max" | "top_set";

export interface RowDef {
  ex: ExKey;
  role: string;
  sets: number;
  reps?: string;
  rpe?: string;
  /** planned % (a range's low end) */
  pct?: number;
  basis?: Basis;
  rest?: number;
  /** timed rows (cardio) */
  minutes?: number;
  note: string;
  optional?: boolean;
}

export interface DayDef {
  dow: Dow;
  title: string;
  focus: string;
  notes: string;
  /** an optional session (pl_days.is_optional): never counted as missed */
  optional?: boolean;
  rows: RowDef[];
}

export interface WeekDef {
  n: number;
  phase: string;
  label: string;
  summary: string;
  notes: string;
  days: DayDef[];
}

export interface BlockDef {
  key: string;
  /** the existing pl_blocks row this block becomes (its block-scoped Training Maxes stay attached) */
  blockId: string;
  /** the library template's block id it mirrors */
  templateBlockId: string;
  name: string;
  focus: string;
  goal: string;
  label: string;
  summary: string;
  coachNotes: string;
  status: "Active" | "Draft";
  weeks: number[];
}

export const CLIENT_ID = "3a548c6a-a07c-4832-aa32-92fdfdbe3282";
export const PREP_ID = "5c15b431-6dd1-4741-94a0-f8b94a5aca4b";
export const TEMPLATE_ID = "ba654f72-19f0-4fcd-b726-9a37cec79a22";
/** Block 2 — Volume 4s/6s: its first two weeks (Nov 1–14) are trained and stay as they are */
export const HISTORY_BLOCK_ID = "74cce272-afde-4d4d-8c11-5214c5a6b3c1";
/** first day this rewrite may touch */
export const FROM_DATE = "2026-11-16";
/** Sunday of week 1 */
export const WEEK1_START = "2026-11-15";
export const MEET = {
  name: "2027 Canada Powerlifting National Championships",
  location: "Nanaimo, BC",
  federation: "CPU",
  windowStart: "2027-02-08",
  windowEnd: "2027-02-13",
};
/** the run marker: the migration does nothing once it's on file */
export const RUN_MARKER = "jared_nationals_2027";

// ── rest (seconds) ─────────────────────────────────────────────────────────
const SQ = 300; // 5–7 min
const BN = 240; // 4–5 min
const DL = 360; // 6–8 min
const CGBP = 210; // 3–4 min
const SEC_SQ = 240;
const SEC_BN = 180;
const TECH_DL = 180;
const ACC_C = 120;
const ACC_I = 90;

const REST_WORDS: Record<number, string> = {
  300: "5–7 min",
  240: "4–5 min",
  360: "6–8 min",
  210: "3–4 min",
  180: "3–4 min",
};

type Lift = "Squat" | "Bench" | "Deadlift";
const LIFT_EX: Record<Lift, ExKey> = {
  Squat: "compSquat",
  Bench: "compBench",
  Deadlift: "compDeadlift",
};
const LIFT_REST: Record<Lift, number> = { Squat: SQ, Bench: BN, Deadlift: DL };
const capOf = (rpe: string) => rpe.split(/[-–]/).pop()!;
const dash = (s: string) => s.replace(/-/g, "–");

const TM_NOTE: Record<Lift, string> = {
  Squat: "your Competition Squat Training Max",
  Bench: "your Competition Bench Training Max",
  Deadlift:
    "your Competition Deadlift Training Max (set from Week 1's conventional single; if none is on file yet, go by the RPE cap)",
};

/** a top single, RPE only */
function single(lift: Lift, rpe: string, extra = ""): RowDef {
  const r = dash(rpe);
  return {
    ex: LIFT_EX[lift],
    role: `Primary ${lift}`,
    sets: 1,
    reps: "1",
    rpe,
    rest: LIFT_REST[lift],
    note:
      `Top single @${r}${lift === "Deadlift" ? ", conventional" : ""}. Attempt-style jumps, competition commands. The day's read, not a test: log the weight and an honest RPE.` +
      `${extra ? " " + extra : ""} Rest ${REST_WORDS[LIFT_REST[lift]]}.`,
  };
}

/** back-offs as a % of the Training Max with the RPE as the cap */
function backoff(
  lift: Lift,
  sets: number,
  reps: string,
  pct: number,
  rpe: string,
  opts: { top?: number; extra?: string; optional?: boolean } = {},
): RowDef {
  const cap = capOf(rpe);
  const range = opts.top != null && opts.top !== pct ? `${pct}–${opts.top}%` : `${pct}%`;
  return {
    ex: LIFT_EX[lift],
    role: `Primary ${lift} Backoff`,
    sets,
    reps,
    rpe,
    pct,
    basis: "training_max",
    rest: LIFT_REST[lift],
    optional: opts.optional,
    note:
      (opts.optional ? "Optional. " : "") +
      `Back-offs: ${range} of ${TM_NOTE[lift]}. ` +
      (opts.top != null && opts.top !== pct
        ? `The app loads ${pct}%; go to ${opts.top}% only if the single moved well and you're under the cap. `
        : "") +
      `RPE cap @${cap}: the cap beats the %, so if a set goes over @${cap}, take weight off the next.` +
      (opts.extra ? " " + opts.extra : "") +
      ` Rest ${REST_WORDS[LIFT_REST[lift]]}.`,
  };
}

/** a competition-related lift loaded from a Training Max, RPE as the cap */
function tmLift(
  ex: ExKey,
  role: string,
  sets: number,
  reps: string,
  pct: number,
  rpe: string,
  note: string,
  opts: { top?: number; rest?: number; optional?: boolean } = {},
): RowDef {
  const cap = capOf(rpe);
  const range = opts.top != null && opts.top !== pct ? `${pct}–${opts.top}%` : `${pct}%`;
  const of =
    ex === "compBench" || ex === "pauseBench2ct" || ex === "closeGripBlock"
      ? "your Competition Bench Training Max"
      : ex === "pausedDeadlift" || ex === "compDeadlift"
        ? "your Competition Deadlift Training Max"
        : "your Competition Squat Training Max";
  return {
    ex,
    role,
    sets,
    reps,
    rpe,
    pct,
    basis: "training_max",
    rest: opts.rest,
    optional: opts.optional,
    note:
      (opts.optional ? "Optional. " : "") +
      `${note} Load: ${range} of ${of}${opts.top != null && opts.top !== pct ? ` (the app loads ${pct}%)` : ""}. ` +
      (ex === "pausedDeadlift" || ex === "compDeadlift"
        ? "No Training Max on file? Go by the RPE. "
        : "") +
      `RPE cap @${cap}: the cap beats the %.` +
      (opts.rest ? ` Rest ${REST_WORDS[opts.rest] ?? `${Math.round(opts.rest / 60)} min`}.` : ""),
  };
}

// ── accessories ────────────────────────────────────────────────────────────
type Effort = "build" | "fr" | "peak" | "taper";
const ACC_NOTE: Record<Effort, string> = {
  build:
    "1 hard set after warm-ups. Double progression: beat last time's reps; at the top of the range at the target RPE, add the smallest jump. Never add sets.",
  fr: "Fatigue reduction: easier on purpose. Same load or a touch lighter, 2–3 reps in the tank.",
  peak: "Peak: crisp, short of a grind. Nothing that leaves you sore for squat or deadlift.",
  taper: "Taper: easy, 3+ reps in the tank.",
};
const PRIORITY_2 =
  "2 hard sets (priority muscle). Double progression: reps first, then the smallest jump. Never a third set.";
const HIPS = " Never to soreness that touches your squat or deadlift.";

function acc(
  ex: ExKey,
  role: string,
  sets: number,
  reps: string,
  rpe: string,
  effort: Effort,
  opts: { optional?: boolean; extra?: string; rest?: number } = {},
): RowDef {
  const hips = role === "Adductors" || role === "Abductors" || role === "Calves";
  return {
    ex,
    role: opts.optional ? `${role} (optional)` : role,
    sets,
    reps,
    rpe,
    rest:
      opts.rest ??
      (["latPulldown", "verticalPull", "latRow", "horizontalRow", "legCurl", "beltSquat"].includes(
        ex,
      )
        ? ACC_C
        : ACC_I),
    optional: opts.optional,
    note:
      (opts.optional ? "Optional. " : "") +
      (sets === 2 && effort === "build" ? PRIORITY_2 : ACC_NOTE[effort]) +
      (hips && (effort === "build" || effort === "fr") ? HIPS : "") +
      (opts.extra ? " " + opts.extra : ""),
  };
}

function cardio(minutes: number, note: string, optional = false): RowDef {
  return {
    ex: "walk",
    role: optional ? "Cardio (optional)" : "Cardio",
    sets: 1,
    minutes,
    rest: 0,
    optional,
    note:
      (optional ? "Optional. " : "") +
      `Zone 2: incline walk or bike, conversational pace.${note ? " " + note : ""} 10 minutes done beats 30 skipped.`,
  };
}

// ── the pieces that repeat ─────────────────────────────────────────────────
const CGBP_NOTE =
  "Bench/triceps overload: grip a little narrower than competition, press off 2–4 in blocks, full lockout.";
function cgbp(reps: string, rpe: string, role = "Overload Bench", extra = ""): RowDef {
  return {
    ex: "closeGripBlock",
    role,
    sets: 1,
    reps,
    rpe,
    rest: CGBP,
    note: `${role.endsWith("Backoff") ? "Back-off set. " : ""}${CGBP_NOTE}${extra ? " " + extra : ""} Rest 3–4 min.`,
  };
}

const PAUSED_DL_NOTE =
  "Low-fatigue conventional technique pull: competition setup, pause 1–2 s just off the floor holding position, finish, reset every rep. If the one set feels unusually fatiguing, stop: never a second deadlift workout.";
function pausedDl(reps: string, rpe: string, pct: number | null, extra = ""): RowDef {
  const base: RowDef = {
    ex: "pausedDeadlift",
    role: "Deadlift Technique (optional)",
    sets: 1,
    reps,
    rpe,
    rest: TECH_DL,
    optional: true,
    note: `Optional. ${PAUSED_DL_NOTE} Skip it if Saturday's deadlift went backwards, your low back or hamstrings are still tired, or sleep has slipped.${extra ? " " + extra : ""}`,
  };
  if (pct == null) {
    return {
      ...base,
      note: base.note + " Go by the RPE: Saturday sets the deadlift Training Max.",
    };
  }
  return {
    ...base,
    pct,
    basis: "training_max",
    note:
      base.note +
      ` Load: about ${pct}% of your Competition Deadlift Training Max; no Training Max on file yet, go by the RPE. RPE cap @${capOf(rpe)}.`,
  };
}

const BENCH_BACK =
  "Sharp low-back pain getting out of your setup (like Oct 23)? Stop, use a back-friendly setup and flag it for your coach.";

// ── day templates ──────────────────────────────────────────────────────────
const MON_NOTES = (extra = "") =>
  `Target 75–90 min. % loads are planned weights; the RPE cap always wins. Over 90 min? Cut the last accessory before any squat or bench work.${extra ? " " + extra : ""}`;
const TUE_NOTES = (extra = "") =>
  `Target 45–60 min. Low-fatigue development: nothing here should make Saturday's deadlift harder. Over 60 min? Drop the optional work first.${extra ? " " + extra : ""}`;
const THU_NOTES = (extra = "") =>
  `Target 75–90 min. % loads are planned weights; the RPE cap always wins. Over 90 min? Cut the last accessory, never the bench work.${extra ? " " + extra : ""}`;
const SAT_NOTES = (extra = "") =>
  `Target 75–90 min. The one deadlift day that matters each week: everything else is built around it. Over 90 min? Cut the last accessory.${extra ? " " + extra : ""}`;

const MON_TITLE = "Monday — Primary Squat + Bench/Triceps Overload";
const TUE_TITLE = "Tuesday — Low-Fatigue Development + Optional Deadlift Technique";
const TUE_TITLE_NO_DL = "Tuesday — Low-Fatigue Development";
const THU_TITLE = "Thursday — Secondary Squat + Primary Competition Bench";
const SAT_TITLE = "Saturday — Primary Competition Deadlift + Secondary Bench";

// ── the 12 weeks ───────────────────────────────────────────────────────────
export const WEEKS: WeekDef[] = [
  {
    n: 1,
    phase: "Calibration + Base Volume",
    label: "Week 1 · Calibration",
    summary:
      "Singles @6 and light back-offs. Shows where your squat and bench Training Maxes sit, and Saturday's conventional single sets your deadlift Training Max.",
    notes:
      "Week 1 of 12. Calibration + base volume. Singles @6, back-offs well under the cap. Squat and bench Training Maxes stay at 235 / 150 kg (Sep 20 meet) unless this week says otherwise; Saturday's conventional single sets the deadlift Training Max.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Squat calibration + bench/triceps overload",
        notes: MON_NOTES(
          "Calibration week: the single and the back-offs help confirm your squat Training Max.",
        ),
        rows: [
          single("Squat", "6", "Calibration: confirms where your squat Training Max sits."),
          backoff("Squat", 3, "4", 72.5, "6"),
          cgbp("6", "6"),
          cgbp("6", "6", "Overload Bench Backoff"),
          acc("beltSquat", "Quaternary Squat", 1, "8-12", "8-9", "build"),
          acc("latPulldown", "Lats", 1, "6-12", "8-9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8-9", "build"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(
          "Order to drop if you're short on time: curl, the 2nd ab set, then the paused pull.",
        ),
        rows: [
          pausedDl("4", "5", null),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8-9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          acc("curl", "Biceps", 1, "8-12", "9", "build", { optional: true }),
          cardio(10, "10–15 min.", false),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "High bar squat + bench calibration",
        notes: THU_NOTES(
          "Calibration week: the bench single and back-offs help confirm your bench Training Max.",
        ),
        rows: [
          tmLift(
            "highBar",
            "Secondary Squat",
            2,
            "5",
            67.5,
            "5",
            "Secondary squat: upright torso, controlled depth, crisp reps, never a grind.",
            { rest: SEC_SQ },
          ),
          single(
            "Bench",
            "6",
            `Calibration: confirms where your bench Training Max sits. ${BENCH_BACK}`,
          ),
          backoff("Bench", 3, "4", 72.5, "6"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "8-9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8-9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Conventional deadlift calibration + secondary bench",
        notes: SAT_NOTES(
          "Calibration: this single @6 and the back-offs set your conventional Competition Deadlift Training Max. Log the single's weight and RPE carefully.",
        ),
        rows: [
          single(
            "Deadlift",
            "6",
            "Calibration: this sets your conventional Competition Deadlift Training Max.",
          ),
          {
            ex: "compDeadlift",
            role: "Primary Deadlift Backoff",
            sets: 2,
            reps: "4",
            rpe: "6",
            pct: 77.5,
            basis: "top_set",
            rest: DL,
            note: "Back-offs: 77.5% of today's single (≈ 70–72.5% of a Training Max; there's no conventional Training Max yet, so they read from the single you just logged). RPE cap @6: the cap beats the %, so if the first is over @6, take weight off. Rest 6–8 min.",
          },
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "6",
            70,
            "5",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "8-9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "8-9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8-9", "build"),
        ],
      },
    ],
  },
  {
    n: 2,
    phase: "Base Volume",
    label: "Week 2 · Base volume",
    summary:
      "Singles @6.5, back-offs at 75% of the Training Max. Same exercises, a little more load.",
    notes: "Week 2 of 12. Base volume: singles @6.5, back-offs 72.5–75% with the cap at @6–7.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Primary squat + bench/triceps overload",
        notes: MON_NOTES(),
        rows: [
          single("Squat", "6.5"),
          backoff("Squat", 3, "4", 75, "6-7"),
          cgbp("6", "7"),
          cgbp("6", "6", "Overload Bench Backoff"),
          acc("beltSquat", "Quaternary Squat", 1, "8-12", "8-9", "build"),
          acc("latPulldown", "Lats", 1, "6-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8-9", "build"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(),
        rows: [
          pausedDl("4", "5", 60),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8-9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          cardio(10, "10–15 min.", false),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "High bar squat + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "highBar",
            "Secondary Squat",
            2,
            "5",
            70,
            "5-6",
            "Secondary squat: upright torso, controlled depth, crisp reps, never a grind.",
            { rest: SEC_SQ },
          ),
          single("Bench", "6.5", BENCH_BACK),
          backoff("Bench", 3, "4", 75, "6-7"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8-9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + secondary bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "6.5"),
          backoff("Deadlift", 2, "4", 72.5, "6-7", { top: 75 }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "6",
            72.5,
            "5-6",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8-9", "build"),
        ],
      },
    ],
  },
  {
    n: 3,
    phase: "Base Volume",
    label: "Week 3 · Heaviest base week",
    summary:
      "Singles @7, back-offs at 77.5%. The last push of the base phase before an easier week.",
    notes: "Week 3 of 12. Heaviest base week: singles @7, back-offs 75–77.5% with the cap at @7.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Primary squat + bench/triceps overload",
        notes: MON_NOTES(),
        rows: [
          single("Squat", "7"),
          backoff("Squat", 3, "4", 77.5, "7", {
            extra: "If the third back-off would go over @7, stop at two.",
          }),
          cgbp("5", "7-7.5"),
          cgbp("5", "6-7", "Overload Bench Backoff"),
          acc("beltSquat", "Quaternary Squat", 1, "8-12", "9", "build"),
          acc("latPulldown", "Lats", 1, "6-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(),
        rows: [
          pausedDl(
            "4",
            "5-6",
            60,
            "No extra set unless the first is extremely easy and there's a clear reason.",
          ),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          cardio(10, "10–15 min.", false),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "High bar squat + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "highBar",
            "Secondary Squat",
            2,
            "5",
            72.5,
            "6",
            "Secondary squat: upright torso, controlled depth, crisp reps, never a grind.",
            { rest: SEC_SQ },
          ),
          single("Bench", "7", BENCH_BACK),
          backoff("Bench", 3, "4", 77.5, "7", {
            extra: "If the third back-off would go over @7, stop at two.",
          }),
          acc("horizontalRow", "Upper Back", 1, "6-10", "9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + secondary bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "7"),
          backoff("Deadlift", 2, "4", 75, "7", { top: 77.5 }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "5",
            75,
            "6",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
        ],
      },
    ],
  },
  {
    n: 4,
    phase: "Fatigue Reduction",
    label: "Week 4 · Fatigue reduction",
    summary:
      "Deliberately easier: singles @6, fewer back-offs, accessories trimmed. Training Max review after this week.",
    notes:
      "Week 4 of 12. Fatigue reduction, easier on purpose. After this week the coach reviews squat / bench / conventional deadlift e1RM, RPE accuracy, bar speed, recovery, adherence and bodyweight, and updates a Training Max only if the trend says so (never from one strong session).",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Easy squat + overload bench",
        notes: MON_NOTES(
          "Fatigue reduction: no belt squat unless you feel exceptionally recovered.",
        ),
        rows: [
          single("Squat", "6"),
          backoff("Squat", 2, "3", 67.5, "6", { top: 70 }),
          cgbp("5", "6"),
          acc("latPulldown", "Lats", 1, "8-12", "7-8", "fr"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "fr"),
          acc("hipAdduction", "Adductors", 1, "12-20", "7-8", "fr"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE_NO_DL,
        focus: "Lats, delts, calves, hips, core (easy)",
        notes: TUE_NOTES("No deadlift variation this week."),
        rows: [
          acc("latRow", "Lats", 1, "8-10", "7-8", "fr"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "fr"),
          acc("calfRaise", "Calves", 1, "10-20", "8", "fr"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "fr"),
          acc("abWheel", "Core", 1, "8-15", "8", "fr", { extra: "1 set." }),
          cardio(10, "", true),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "Easy high bar + bench",
        notes: THU_NOTES("Fatigue reduction."),
        rows: [
          tmLift(
            "highBar",
            "Secondary Squat",
            1,
            "5",
            65,
            "5",
            "Secondary squat: upright torso, controlled depth, easy and crisp.",
            { rest: SEC_SQ },
          ),
          single("Bench", "6"),
          backoff("Bench", 2, "3", 70, "6"),
          acc("horizontalRow", "Upper Back", 1, "8-10", "8", "fr"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "fr"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "fr"),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Easy deadlift + secondary bench",
        notes: SAT_NOTES(
          "Fatigue reduction. After today: Training Max review (squat, bench, conventional deadlift).",
        ),
        rows: [
          single("Deadlift", "6"),
          backoff("Deadlift", 1, "3", 67.5, "6", {
            top: 70,
            extra: "1–2 sets: add a 2nd only if the first was fast and no harder than @6.",
          }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            1,
            "5",
            67.5,
            "5",
            "Secondary bench: full 2-count pause, easy.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "10", "8", "fr"),
          acc("verticalPull", "Lats", 1, "8-12", "8", "fr"),
          acc("calfRaise", "Calves", 1, "10-20", "8", "fr"),
        ],
      },
    ],
  },
  {
    n: 5,
    phase: "Strength",
    label: "Week 5 · Strength begins",
    summary:
      "Triples now. Thursday's squat becomes a competition-stance paused squat: more specific from here.",
    notes:
      "Week 5 of 12. Strength phase begins: back-offs move to triples at 77.5%, and Thursday's secondary squat becomes the competition-stance paused squat.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Primary squat + bench/triceps overload",
        notes: MON_NOTES(),
        rows: [
          single("Squat", "7"),
          backoff("Squat", 3, "3", 77.5, "7"),
          cgbp("5", "7"),
          cgbp("5", "6", "Overload Bench Backoff"),
          acc("latPulldown", "Lats", 1, "6-10", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("beltSquat", "Quaternary Squat", 1, "8-10", "8-9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(),
        rows: [
          pausedDl("3", "5", 60),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          cardio(10, "10–15 min.", false),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "Competition-stance paused squat + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "pauseSquat",
            "Secondary Squat",
            2,
            "4",
            62.5,
            "5-6",
            "Competition-stance paused squat: your competition stance and bar position, a clean 1–2 s pause in the hole, stay tight, drive up.",
            { top: 65, rest: SEC_SQ },
          ),
          single("Bench", "7", BENCH_BACK),
          backoff("Bench", 3, "3", 77.5, "7"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + secondary bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "7"),
          backoff("Deadlift", 2, "3", 75, "7", { top: 77.5 }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "5",
            75,
            "6",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
        ],
      },
    ],
  },
  {
    n: 6,
    phase: "Strength",
    label: "Week 6 · Strength",
    summary: "Singles @7.5, triples at 80% of the Training Max.",
    notes: "Week 6 of 12. Strength: singles @7.5, back-offs 3×3 at 80% with the cap at @7–7.5.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Primary squat + bench/triceps overload",
        notes: MON_NOTES(),
        rows: [
          single("Squat", "7.5"),
          backoff("Squat", 3, "3", 80, "7-7.5"),
          cgbp("4", "7.5"),
          cgbp("4", "6-7", "Overload Bench Backoff"),
          acc("latPulldown", "Lats", 1, "6-10", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("beltSquat", "Quaternary Squat", 1, "8-10", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(),
        rows: [
          pausedDl(
            "3",
            "5-6",
            62.5,
            "If Saturday's deadlift recovery has got worse, take it out this week.",
          ),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          cardio(10, "10–15 min.", false),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "Competition-stance paused squat + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "pauseSquat",
            "Secondary Squat",
            2,
            "4",
            65,
            "6",
            "Competition-stance paused squat: your competition stance and bar position, a clean 1–2 s pause in the hole, stay tight, drive up.",
            { top: 67.5, rest: SEC_SQ },
          ),
          single("Bench", "7.5", BENCH_BACK),
          backoff("Bench", 3, "3", 80, "7-7.5"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + secondary bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "7.5"),
          backoff("Deadlift", 2, "3", 77.5, "7-7.5", { top: 80 }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "4",
            77.5,
            "6-7",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
        ],
      },
    ],
  },
  {
    n: 7,
    phase: "Strength (hardest week)",
    label: "Week 7 · Hardest week",
    summary:
      "Singles @8, never @9. The hardest accumulation week before the second fatigue reduction.",
    notes:
      "Week 7 of 12. The hardest accumulation week: singles @8 (never turn one into @9), back-offs at 80–82.5% capped at @8. Optional work stays optional.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Primary squat + bench/triceps overload",
        notes: MON_NOTES("Belt squat is optional this week."),
        rows: [
          single("Squat", "8", "Do not turn the single into @9."),
          backoff("Squat", 2, "3", 82.5, "8"),
          cgbp("4", "8"),
          {
            ...cgbp(
              "4",
              "7",
              "Overload Bench Backoff",
              "Optional 2nd set: only if recovery is excellent.",
            ),
            optional: true,
          },
          acc("latPulldown", "Lats", 1, "6-10", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
          acc("beltSquat", "Quaternary Squat", 1, "8-10", "8", "build", { optional: true }),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(),
        rows: [
          pausedDl("3", "5", 60, "Do not go past this."),
          acc("latRow", "Lats", 1, "6-10", "9", "build", {
            extra: "Lat bias: elbows tight to the sides, pull toward the hip.",
          }),
          acc("lateralRaise", "Side Delts", 2, "10-20", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
          acc("abWheel", "Core", 1, "8-15", "8-9", "build", {
            extra: "1–2 working sets: add the 2nd only if time allows. A cable crunch works too.",
          }),
          cardio(10, "", true),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "Competition-stance paused squat + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "pauseSquat",
            "Secondary Squat",
            2,
            "3",
            67.5,
            "6-7",
            "Competition-stance paused squat: your competition stance and bar position, a clean 1–2 s pause in the hole, stay tight, drive up.",
            { top: 70, rest: SEC_SQ },
          ),
          single("Bench", "8", `Do not turn the single into @9. ${BENCH_BACK}`),
          backoff("Bench", 2, "3", 82.5, "8"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "9", "build"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "9", "build"),
          acc("triceps", "Triceps", 1, "8-15", "9", "build"),
          acc("hipAdduction", "Adductors", 1, "12-20", "9", "build"),
          cardio(10, "Only if time and energy are good.", true),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + secondary bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "8", "Do not exceed @8."),
          backoff("Deadlift", 2, "3", 80, "8", {
            extra: "1–2 sets: do the 2nd only if the first was no harder than @7.5 and moved well.",
          }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "4",
            80,
            "7",
            "Secondary bench: full 2-count pause on the chest, competition grip.",
            { rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-12", "9", "build"),
          acc("verticalPull", "Lats", 1, "8-12", "9", "build"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "9", "build"),
          acc("calfRaise", "Calves", 1, "10-20", "9", "build"),
          acc("hipAbduction", "Abductors", 1, "12-20", "9", "build"),
        ],
      },
    ],
  },
  {
    n: 8,
    phase: "Fatigue Reduction",
    label: "Week 8 · Fatigue reduction",
    summary:
      "Second easier week. After it, the squat, bench and deadlift Training Maxes are reassessed for the peak.",
    notes:
      "Week 8 of 12. Fatigue reduction. After this week the competition Training Maxes are reassessed from several exposures and the RPE trend: these become the references for the peak. Don't chase an optimistic e1RM.",
    days: [
      {
        dow: "Mon",
        title: MON_TITLE,
        focus: "Easy squat + overload bench",
        notes: MON_NOTES("Fatigue reduction."),
        rows: [
          single("Squat", "6-6.5"),
          backoff("Squat", 2, "2", 70, "6.5", { top: 72.5 }),
          cgbp("4", "6"),
          acc("latPulldown", "Lats", 1, "8-10", "8", "fr"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "fr"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "fr"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE_NO_DL,
        focus: "Lats, delts, calves, hips, core (easy)",
        notes: TUE_NOTES("No deadlift variation this week."),
        rows: [
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "fr"),
          acc("latRow", "Lats", 1, "8-10", "8", "fr"),
          acc("calfRaise", "Calves", 1, "10-20", "8", "fr"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "fr"),
          acc("abWheel", "Core", 1, "8-15", "8", "fr", { extra: "1 set." }),
          cardio(10, "", true),
        ],
      },
      {
        dow: "Thu",
        title: THU_TITLE,
        focus: "Easy paused squat + bench",
        notes: THU_NOTES("Fatigue reduction."),
        rows: [
          tmLift(
            "pauseSquat",
            "Secondary Squat",
            1,
            "3",
            62.5,
            "5",
            "Competition-stance paused squat, easy and crisp.",
            { rest: SEC_SQ },
          ),
          single("Bench", "6-6.5"),
          backoff("Bench", 2, "2", 72.5, "6.5"),
          acc("horizontalRow", "Upper Back", 1, "8-10", "8", "fr"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "fr"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "fr"),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Easy deadlift + secondary bench",
        notes: SAT_NOTES("Fatigue reduction. After today: Training Max reassessment for the peak."),
        rows: [
          single("Deadlift", "6-6.5"),
          backoff("Deadlift", 1, "2", 70, "6.5", {
            top: 72.5,
            extra: "1–2 sets: add a 2nd only if the first was fast and no harder than @6.5.",
          }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            1,
            "4",
            67.5,
            "5",
            "Secondary bench: full 2-count pause, easy.",
            { rest: SEC_BN },
          ),
          acc("verticalPull", "Lats", 1, "8-10", "8", "fr"),
          acc("legCurl", "Hamstrings", 1, "8-10", "8", "fr"),
          acc("calfRaise", "Calves", 1, "10-20", "8", "fr"),
        ],
      },
    ],
  },
  {
    n: 9,
    phase: "Peak",
    label: "Week 9 · Peak begins",
    summary:
      "Specificity takes over: the block press and belt squat are gone, everything moves toward the platform.",
    notes:
      "Week 9 of 12. Peak begins: non-specific work disappears. Close-grip block press becomes competition bench technique, Thursday's squat becomes competition squat technique, no belt squat and no deadlift variation.",
    days: [
      {
        dow: "Mon",
        title: "Monday — Primary Squat + Bench Technique",
        focus: "Primary squat + competition bench technique",
        notes: MON_NOTES("Peak: no belt squat."),
        rows: [
          single("Squat", "8"),
          backoff("Squat", 2, "2", 82.5, "8"),
          tmLift(
            "compBench",
            "Tertiary Bench",
            2,
            "3",
            70,
            "5-6",
            "Competition bench technique: competition grip, pause and commands, every rep identical.",
            { rest: SEC_BN },
          ),
          acc("latPulldown", "Lats", 1, "6-10", "8-9", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8-9", "peak"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "peak"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE_NO_DL,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES(
          "No deadlift variation unless your coach asks for one for a technical reason (then 1×3 @5 at most).",
        ),
        rows: [
          acc("latRow", "Lats", 1, "6-10", "8-9", "peak"),
          acc("lateralRaise", "Side Delts", 1, "10-20", "9", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8-9", "peak"),
          acc("calfRaise", "Calves", 1, "10-20", "8-9", "peak"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "peak"),
          acc("abWheel", "Core", 1, "8-15", "8", "peak", { extra: "1 set." }),
          cardio(10, "10 minutes at most.", false),
        ],
      },
      {
        dow: "Thu",
        title: "Thursday — Squat Technique + Primary Competition Bench",
        focus: "Competition squat technique + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "compSquat",
            "Secondary Squat",
            2,
            "3",
            70,
            "5-6",
            "Competition squat technique: competition stance, depth and commands, every rep identical.",
            { rest: SEC_SQ },
          ),
          single("Bench", "8", BENCH_BACK),
          backoff("Bench", 2, "2", 82.5, "8"),
          acc("horizontalRow", "Upper Back", 1, "6-10", "8-9", "peak"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8-9", "peak"),
          acc("triceps", "Triceps", 1, "8-12", "8-9", "peak"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "peak"),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + competition-style paused bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "8"),
          backoff("Deadlift", 2, "2", 80, "8", { top: 82.5 }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "3",
            70,
            "6",
            "Competition-style 2-count paused bench: competition grip and commands.",
            { top: 72.5, rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-10", "8", "peak"),
          acc("verticalPull", "Lats", 1, "8-10", "8-9", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "peak"),
          acc("calfRaise", "Calves", 1, "10-20", "8", "peak"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "peak"),
        ],
      },
    ],
  },
  {
    n: 10,
    phase: "Peak",
    label: "Week 10 · Peak",
    summary:
      "Heavy doubles at 85% behind singles @8–8.5. Stop at one back-off if the first is already hard.",
    notes:
      "Week 10 of 12. Peak: singles @8–8.5 and doubles at 85%. If the first double is over @7.5, stop there.",
    days: [
      {
        dow: "Mon",
        title: "Monday — Primary Squat + Bench Technique",
        focus: "Primary squat + competition bench technique",
        notes: MON_NOTES(),
        rows: [
          single("Squat", "8-8.5"),
          backoff("Squat", 2, "2", 85, "7.5", {
            extra: "1–2 sets: if the first double is already over @7.5, stop at one.",
          }),
          tmLift(
            "compBench",
            "Tertiary Bench",
            2,
            "2",
            72.5,
            "5-6",
            "Competition bench technique: competition grip, pause and commands.",
            { rest: SEC_BN },
          ),
          acc("latPulldown", "Lats", 1, "6-10", "8", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "peak"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "peak"),
        ],
      },
      {
        dow: "Tue",
        title: TUE_TITLE_NO_DL,
        focus: "Lats, delts, calves, hips, core",
        notes: TUE_NOTES("No deadlift variation."),
        rows: [
          acc("latRow", "Lats", 1, "6-10", "8", "peak"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8-9", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "peak"),
          acc("calfRaise", "Calves", 1, "10-15", "8", "peak"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "peak"),
          acc("abWheel", "Core", 1, "8-15", "8", "peak", { extra: "1 set." }),
          cardio(10, "Easy.", true),
        ],
      },
      {
        dow: "Thu",
        title: "Thursday — Squat Technique + Primary Competition Bench",
        focus: "Competition squat technique + primary competition bench",
        notes: THU_NOTES(),
        rows: [
          tmLift(
            "compSquat",
            "Secondary Squat",
            2,
            "2",
            72.5,
            "6",
            "Competition squat technique: competition stance, depth and commands.",
            { rest: SEC_SQ },
          ),
          single("Bench", "8-8.5", BENCH_BACK),
          backoff("Bench", 2, "2", 85, "7.5", {
            extra: "1–2 sets: if the first double is already over @7.5, stop at one.",
          }),
          acc("horizontalRow", "Upper Back", 1, "6-10", "8", "peak"),
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "peak"),
          acc("triceps", "Triceps", 1, "8-12", "8", "peak"),
          acc("hipAdduction", "Adductors", 1, "12-20", "8", "peak"),
        ],
      },
      {
        dow: "Sat",
        title: SAT_TITLE,
        focus: "Primary competition deadlift + competition-style bench",
        notes: SAT_NOTES(),
        rows: [
          single("Deadlift", "8-8.5"),
          backoff("Deadlift", 1, "2", 82.5, "8", {
            extra: "No extra back-off unless your coach says it's clearly warranted.",
          }),
          tmLift(
            "pauseBench2ct",
            "Secondary Bench",
            2,
            "2",
            72.5,
            "6",
            "Competition-style 2-count paused bench: competition grip and commands.",
            { top: 75, rest: SEC_BN },
          ),
          acc("legCurl", "Hamstrings", 1, "8-10", "8", "peak"),
          acc("verticalPull", "Lats", 1, "8-10", "8", "peak"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "peak"),
          acc("calfRaise", "Calves", 1, "10-15", "8", "peak"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "peak"),
        ],
      },
    ],
  },
  {
    n: 11,
    phase: "Final Heavy Exposures",
    label: "Week 11 · Final heavy work",
    summary:
      "The last meaningful heavy single for each lift: squat ~14 days out, bench ~11, deadlift ~9 (from Feb 8). Strong and clean, never a grinder.",
    notes:
      "Week 11 of 12. Final meaningful heavy exposures, counted from Feb 8 (the conservative meet anchor): squat Monday (~14 days out), bench Thursday (~11), deadlift Saturday (~9). Don't max out. These dates move with the actual lifting day once it's confirmed.",
    days: [
      {
        dow: "Mon",
        title: "Monday — Final Heavy Squat",
        focus: "Final heavy squat single + light bench",
        notes: MON_NOTES(
          "Final heavy squat: strong, technically clean, confidence-building. Not a grinder.",
        ),
        rows: [
          single(
            "Squat",
            "8-8.5",
            "Final heavy squat: strong, clean, confidence-building. Not a grinder.",
          ),
          backoff("Squat", 1, "2", 75, "6", {
            top: 80,
            optional: true,
            extra: "Only if it improves readiness; skip it if the single was a fight.",
          }),
          tmLift(
            "compBench",
            "Tertiary Bench",
            2,
            "1",
            70,
            "5-6",
            "Competition bench singles: competition commands, fast.",
            { rest: SEC_BN },
          ),
          acc("latPulldown", "Lats", 1, "8-10", "7-8", "taper"),
          acc("rearDelt", "Rear Delts", 1, "12-15", "7-8", "taper"),
          acc("hipAdduction", "Adductors", 1, "12-15", "7-8", "taper"),
        ],
      },
      {
        dow: "Tue",
        title: "Tuesday — Short Recovery Session",
        focus: "Very short development / recovery session",
        notes: "Target 30–45 min. No deadlift. No fatigue chasing: leave fresher than you came in.",
        rows: [
          acc("lateralRaise", "Side Delts", 1, "12-20", "8", "taper"),
          acc("rearDelt", "Rear Delts", 1, "12-20", "8", "taper"),
          acc("calfRaise", "Calves", 1, "10-15", "8", "taper"),
          acc("hipAbduction", "Abductors", 1, "12-20", "8", "taper"),
          acc("abWheel", "Core", 1, "8-12", "8", "taper", { extra: "1 set." }),
          cardio(10, "A 10-minute walk or bike.", true),
        ],
      },
      {
        dow: "Thu",
        title: "Thursday — Final Heavy Bench",
        focus: "Final heavy bench single + light squat",
        notes: THU_NOTES("Final heavy bench: strong and clean, not a grinder."),
        rows: [
          tmLift(
            "compSquat",
            "Secondary Squat",
            1,
            "2",
            60,
            "5",
            "Light competition squat: competition stance and commands, fast.",
            { top: 65, rest: SEC_SQ },
          ),
          single("Bench", "8-8.5", "Final heavy bench: strong and clean, not a grinder."),
          backoff("Bench", 1, "2", 75, "6", {
            top: 80,
            optional: true,
            extra: "Only if it improves readiness.",
          }),
          acc("horizontalRow", "Upper Back", 1, "8-10", "7-8", "taper"),
          acc("lateralRaise", "Side Delts", 1, "12-15", "7-8", "taper"),
          acc("hipAdduction", "Adductors", 1, "12-15", "7-8", "taper"),
        ],
      },
      {
        dow: "Sat",
        title: "Saturday — Final Heavy Deadlift",
        focus: "Final heavy deadlift single + light bench",
        notes:
          "Target 45–60 min. The final meaningful deadlift: @7.5–8, never chase @9. No back-off. No meaningful lower-body accessory fatigue.",
        rows: [
          single(
            "Deadlift",
            "7.5-8",
            "The final meaningful deadlift. Do not chase @9; no back-off.",
          ),
          tmLift(
            "compBench",
            "Secondary Bench",
            2,
            "2",
            65,
            "5",
            "Competition bench: competition commands, fast and identical.",
            { top: 70, rest: SEC_BN },
          ),
          acc("verticalPull", "Lats", 1, "8", "7", "taper", { optional: true }),
          acc("calfRaise", "Calves", 1, "10-15", "7", "taper", { optional: true }),
          acc("hipAbduction", "Abductors", 1, "12-15", "7", "taper", { optional: true }),
        ],
      },
    ],
  },
  {
    n: 12,
    phase: "Taper",
    label: "Week 12 · Taper",
    summary:
      "Everything fast and light, nothing above @4–5. Saturday's primer is for a Feb 8 lifting day and moves with the confirmed day.",
    notes:
      "Week 12 of 12. Taper, anchored on Feb 8 (the earliest day of the Feb 8–13 window). Once the exact lifting day is confirmed these sessions move with it, keeping their distance from the meet; Weeks 1–10 stay as they are.",
    days: [
      {
        dow: "Mon",
        title: "Monday — Taper: Squat, Bench, Deadlift",
        focus: "Fast, light competition lifts",
        notes:
          "Target 45–60 min. Everything should move fast: nothing above about @4–5. Then leave.",
        rows: [
          tmLift(
            "compSquat",
            "Primary Squat",
            2,
            "2",
            60,
            "4-5",
            "Fast competition squats with commands.",
            { top: 65, rest: SQ },
          ),
          tmLift(
            "compBench",
            "Primary Bench",
            3,
            "2",
            60,
            "4-5",
            "Fast competition bench with commands.",
            { top: 65, rest: BN },
          ),
          tmLift(
            "compDeadlift",
            "Primary Deadlift",
            1,
            "1",
            55,
            "4-5",
            "One fast conventional single.",
            { top: 60, rest: DL },
          ),
          acc("latPulldown", "Lats", 1, "8", "6-7", "taper", { optional: true }),
          acc("rearDelt", "Rear Delts", 1, "12", "6-7", "taper", { optional: true }),
        ],
      },
      {
        dow: "Tue",
        title: "Tuesday — Optional Recovery (no lifting)",
        focus: "Optional easy movement",
        optional: true,
        notes:
          "No lifting required. If you want it: 10–15 min of easy movement, light abs or mobility. No fatigue.",
        rows: [cardio(10, "10–15 min of easy movement if you want it.", true)],
      },
      {
        dow: "Thu",
        title: "Thursday — Taper: Technique Touch",
        focus: "Technique touch: squat and bench singles",
        notes: "Target 30–45 min. A technique touch, no meaningful deadlift work.",
        rows: [
          tmLift(
            "compSquat",
            "Primary Squat",
            2,
            "1",
            50,
            "4",
            "1–2 fast singles with commands; one is enough if it felt perfect.",
            { top: 55, rest: SQ },
          ),
          tmLift(
            "compBench",
            "Primary Bench",
            2,
            "1",
            55,
            "4",
            "Fast competition bench singles with commands.",
            { top: 60, rest: BN },
          ),
        ],
      },
      {
        dow: "Sat",
        title: "Saturday — Meet Primer (2 days out)",
        focus: "Very light SBD primer",
        notes:
          "Target 20–30 min. Two days before your lifting day: Feb 6 is for a Feb 8 lift, and it moves to two days before your actual day once that's confirmed. It should feel almost too easy.",
        rows: [
          tmLift("compSquat", "Primary Squat", 1, "1", 40, "4", "One crisp single with commands.", {
            top: 50,
            rest: SQ,
          }),
          tmLift(
            "compBench",
            "Primary Bench",
            2,
            "1",
            40,
            "4",
            "1–2 crisp singles with commands.",
            { top: 50, rest: BN },
          ),
          tmLift(
            "compDeadlift",
            "Primary Deadlift",
            1,
            "1",
            40,
            "4",
            "A single if you want it: leave it out if you feel better without a pull this close.",
            { rest: DL, optional: true },
          ),
        ],
      },
    ],
  },
];

export const BLOCKS: BlockDef[] = [
  {
    key: "block-3",
    blockId: "3f736c8c-f785-4114-b3c5-d76f1af87a50",
    templateBlockId: "777c45d9-ad39-4a06-b8e0-04c6541d8a69",
    name: "Block 3 — Nationals Base",
    focus: "Calibration + Base Volume",
    goal: "Calibrate the Training Maxes (conventional deadlift set in Week 1) and build base volume on the competition lifts; Week 4 reduces fatigue.",
    label: "Nationals base",
    summary:
      "Weeks 1–4 of the Nationals prep. Singles @6–7 with back-offs at 72.5–77.5% of the Training Max, overload bench and the priority accessories; Week 4 is easier on purpose.",
    coachNotes:
      "Nationals prep Weeks 1–4 (Nov 15 – Dec 12). Squat TM 235 kg / bench TM 150 kg (Sep 20 2026 meet; Nov 9 squat 192.8 × 4 @6 ≈ 245 e1RM, Nov 12 bench 115.7 × 4 @6 ≈ 147). Conventional deadlift TM: not on file; Jared switched back from sumo Nov 7 and his only conventional set since is 224.5 kg × 4 @10 (Nov 13, ≈ 252 e1RM). Set it after Saturday Nov 21's single @6 (about 95% of that single's e1RM, floored to 2.5 kg). Review all three after Week 4.",
    status: "Active",
    weeks: [1, 2, 3, 4],
  },
  {
    key: "block-4",
    blockId: "657a0dbd-747f-44a7-af94-037bee9c896f",
    templateBlockId: "bf538c45-3677-48a8-836b-f051fddd2972",
    name: "Block 4 — Nationals Strength",
    focus: "Strength",
    goal: "Triples at 77.5–82.5% with singles up to @8; the secondary squat becomes competition-stance paused; Week 8 reduces fatigue.",
    label: "Nationals strength",
    summary:
      "Weeks 5–8. Back-offs move to triples, singles climb to @8 in Week 7 (never @9), Thursday's squat becomes a competition-stance paused squat. Week 8 is easier, then the Training Maxes are reassessed for the peak.",
    coachNotes:
      "Nationals prep Weeks 5–8 (Dec 13 – Jan 9). Training Maxes as set after the Week 4 review. After Week 8: reassess squat / bench / conventional deadlift TMs from several exposures and the RPE trend; these are the peak's references.",
    status: "Draft",
    weeks: [5, 6, 7, 8],
  },
  {
    key: "block-5",
    blockId: "887f6705-82a0-45e7-92d6-0ab770c91318",
    templateBlockId: "aa0df8da-77a3-4a78-b91e-8921b79a9f51",
    name: "Block 5 — Nationals Peak",
    focus: "Peak",
    goal: "Specificity: competition lifts only, heavy doubles and singles, then the final heavy exposures ~14 / 11 / 9 days out.",
    label: "Nationals peak",
    summary:
      "Weeks 9–11. The block press, belt squat and deadlift variation are gone; heavy doubles at 82.5–85%, then the last heavy single for each lift in Week 11.",
    coachNotes:
      "Nationals prep Weeks 9–11 (Jan 10 – Jan 30). Week 11's sessions are counted back from Feb 8 and locked to their dates; when the lifting day is confirmed run pl_prep_set_meet_day to move them with it.",
    status: "Draft",
    weeks: [9, 10, 11],
  },
  {
    key: "block-6",
    blockId: "f4a16ece-9988-4ed5-8cec-0a44943f05ae",
    templateBlockId: "599c30d4-c720-4db6-929d-77e5d8070ddd",
    name: "Block 6 — Nationals Taper",
    focus: "Taper",
    goal: "Fast, light competition lifts and a primer two days out.",
    label: "Nationals taper",
    summary:
      "Week 12. Light, fast technique work and a primer two days before the lifting day (Feb 6 for a Feb 8 lift).",
    coachNotes:
      "Nationals prep Week 12 (Jan 31 – Feb 6), anchored on Feb 8. Locked to meet-relative dates; moves with the confirmed lifting day (pl_prep_set_meet_day). Keep a bench exposure close to the meet: Jared responds well to it.",
    status: "Draft",
    weeks: [12],
  },
];

/** The small, data-based changes from the coach's written program, and why. */
export const PREP_CHANGES: string[] = [
  "Week 1 Saturday deadlift back-offs read 77.5% of that day's single (≈ 70–72.5% of a Training Max) instead of % TM: there is no conventional Training Max yet (Jared switched back from sumo on Nov 7), so the single is the calibration and nothing is invented.",
  "Week 1 Tuesday paused deadlift is RPE-only for the same reason; from Week 2 it's ~60% of the deadlift TM once the coach sets it.",
  "High Bar Squat and 2ct Paused Bench carry a % of the competition Training Max (High Bar 65–72.5%, 2ct bench 67.5–80%) with the written RPE as the cap: matched to his own recent sets (High Bar 165.6 kg × 6 @4 on Nov 12, 2ct bench 106.6 kg × 6 @5 on Nov 13), per the hybrid system's 'percentage where reliable'.",
  "An optional 10-min Zone 2 on Thursday in Weeks 1–3 and 5–7 so cardio reaches the stated ~2 exposures a week (Weeks 2–7 only listed Tuesday).",
  "Primary bench uses the canonical Competition Bench (his Oct–Nov top sets were logged as Paused Bench Press).",
  "Week 9 Tuesday has no paused deadlift row (the default is none; add one only for a technical reason).",
  "Week 12 Tuesday is an optional session, and every Week 11–12 day is locked to its meet-relative date so an automatic re-plan can never slide the taper.",
];
