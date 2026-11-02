/**
 * Realistic athletes for Generate Next Program tests, built from a compact
 * spec: programs of blocks / weeks / days / exercises with every set logged
 * as a real athlete would (loads progressing, RPE where they log it, missed
 * days, check-outs, durations).
 *
 *  - homeGym(): modeled on the real home-gym client: three 4-week, 4-day
 *    programs, the last one "Home Gym 4-Day Strength + Hypertrophy" with
 *    station notes (rack, dumbbells + adjustable bench, high / low cable,
 *    landmine, bench leg attachment), RPE on every set (two logged at 4 and 5),
 *    sessions ~53 min, Goals & Setup still saying 3 days at a commercial gym.
 *  - powerlifter(): three blocks (accumulation → intensification →
 *    realization), 4 days, top sets + back-offs, variations, heavy singles,
 *    RPE on about half the sets, a meet 10 weeks out.
 *  - bodybuilder(): 5 days, glute priority in their goals, variable
 *    adherence, no check-outs.
 *  - sparse(): one block, two workouts, no RPE, no Goals & Setup.
 */
import type { IntelRecords, RawExercise, RawResult, RawRow } from "@/lib/program-intel/types";

export const TODAY = "2026-11-02";
const iso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type ExSpec = {
  id: string;
  sets: number;
  reps: string;
  rpe?: string;
  role?: string;
  notes?: string;
  rest?: number;
  /** load in kg for week w (block-relative, 1-based) */
  load?: (w: number) => number | null;
  /** reps logged in week w, set s */
  done?: (w: number, s: number) => number;
  /** logged RPE (null = not logged) */
  rpeLog?: (w: number, s: number) => number | null;
  /** sets actually done in week w (default all) */
  setsDone?: (w: number) => number;
};
export type BlockSpec = {
  id: string;
  name: string;
  start: string;
  weeks: number;
  prepId?: string | null;
  focus?: string | null;
  status?: string;
  /** day offsets inside a week (0 = Monday) */
  offsets: number[];
  days: Array<{ title: string; exercises: ExSpec[] }>;
  /** skip a workout (missed) */
  skip?: (w: number, d: number) => boolean;
  /** not marked finished though logged */
  unfinished?: (w: number, d: number) => boolean;
  duration?: (w: number, d: number) => number | null;
  feedback?: (w: number, d: number) => Partial<IntelRecords["feedback"][number]> | null;
};

export function ex(id: string, name: string, extra: Partial<RawExercise> = {}): RawExercise {
  return { id, name, primary_muscle_group: null, muscle_groups: [], secondary_muscle_groups: [], movement_family: "accessory", is_competition_lift: false, competition_lift_type: null, exercise_category: "compound", variation_type: null, counts_toward_volume: true, volume_multiplier: 1, equipment: null, ...extra };
}

export function buildRecords(x: { blocks: BlockSpec[]; exercises: RawExercise[]; over?: Partial<IntelRecords> }): IntelRecords {
  const weeks: IntelRecords["weeks"] = [];
  const days: IntelRecords["days"] = [];
  const rows: RawRow[] = [];
  const results: RawResult[] = [];
  const completions: IntelRecords["completions"] = [];
  const feedback: IntelRecords["feedback"] = [];
  let n = 0;
  for (const b of x.blocks) {
    for (let w = 1; w <= b.weeks; w++) {
      const weekId = `${b.id}-w${w}`;
      const wStart = iso(b.start, (w - 1) * 7);
      weeks.push({ id: weekId, block_id: b.id, week_index: w, start_date: wStart, end_date: iso(wStart, 6), phase: null, notes: null });
      b.days.forEach((d, di) => {
        const dayId = `${b.id}-w${w}-d${di + 1}`;
        const date = iso(wStart, b.offsets[di] ?? di);
        days.push({ id: dayId, week_id: weekId, day_index: di + 1, title: d.title, focus: null, notes: null, scheduled_date: date });
        const trained = date < TODAY && !(b.skip?.(w, di) ?? false);
        d.exercises.forEach((e, ei) => {
          const rowId = `${dayId}-r${ei}`;
          rows.push({ id: rowId, day_id: dayId, sort_order: ei, exercise_id: e.id, exercise_name_override: null, sets: e.sets, reps_text: e.reps, rpe: e.rpe ?? null, rir: null, percentage: null, percentage_basis: null, load_kg: null, load_lb: null, load_unit: null, tempo: null, rest_seconds: e.rest ?? null, notes: e.notes ?? null, purpose_label: e.role ?? null, measurement_type: null, duration_seconds: null, intensity_techniques: null, progression_method: null });
          if (!trained) return;
          const setsDone = e.setsDone?.(w) ?? e.sets;
          for (let s = 1; s <= setsDone; s++) {
            const kg = e.load ? e.load(w) : null;
            const reps = e.done ? e.done(w, s) : Number(String(e.reps).match(/\d+/)?.[0] ?? 8);
            const rpe = e.rpeLog ? e.rpeLog(w, s) : null;
            results.push({ id: `res-${++n}`, row_id: rowId, set_index: s, actual_load: kg, actual_load_unit: "kg", normalized_kg: kg, actual_load_kg: kg, actual_reps: reps, actual_rpe: rpe == null ? null : String(rpe), actual_rpe_num: rpe, actual_rir: null, is_working_set: null, is_bodyweight: kg == null, load_type: kg == null ? "bodyweight" : "external", completed_at: `${date}T18:${String(10 + ei).padStart(2, "0")}:00Z`, completed_duration_seconds: null, notes: null });
          }
        });
        if (trained && !(b.unfinished?.(w, di) ?? false)) completions.push({ id: `c-${dayId}`, day_id: dayId, completed_at: `${date}T19:00:00Z`, started_at: `${date}T18:00:00Z`, actual_duration_min: b.duration?.(w, di) ?? null, logging_percentage: 100, session_rating: 4, skipped_exercises_count: 0, client_notes: null });
        const fb = trained ? b.feedback?.(w, di) : null;
        if (fb) feedback.push({ id: `f-${dayId}`, day_id: dayId, completion_id: `c-${dayId}`, created_at: `${date}T19:05:00Z`, session_rpe: 7, overall_rating: 4, strength_feel: null, fatigue_feel: "normal", hit_target: null, recovery_today: null, sleep_bucket: "7-8", pain: false, pain_area: null, pain_level: null, pain_note: null, client_note: null, review_version: 2, ...fb });
      });
    }
  }
  return {
    client: { id: "client-1", full_name: "Test Athlete", preferred_weight_unit: "lb", timezone: "America/Winnipeg", sex: "male", coach_notes: null, goals: null, injuries: null, training_notes: null, lifestyle_notes: null, date_of_birth: "2001-06-17", height_cm: 165 },
    goals: null,
    preps: [],
    blocks: x.blocks.map((b, i) => ({ id: b.id, prep_id: b.prepId ?? null, name: b.name, status: b.status ?? (iso(b.start, b.weeks * 7) <= TODAY ? "Completed" : "Active"), start_date: b.start, end_date: iso(b.start, b.weeks * 7 - 1), weeks: b.weeks, training_focus: b.focus ?? null, goal: null, coach_notes: null, client_visible: true, archived: false, sort_order: i, created_at: `${b.start}T00:00:00Z` })),
    weeks,
    days,
    rows,
    setBlocks: [],
    results,
    warmups: [],
    completions,
    feedback,
    exerciseNotes: [],
    exercises: x.exercises,
    maxes: [],
    meets: [],
    bodyweight: [],
    roadmapNotes: [],
    fileNotes: [],
    observations: [],
    checkins: [],
    profile: null,
    settings: { e1rmFormula: "epley", workingRpeMin: 6, muscleTargets: {} },
    scope: { kind: "history", label: "Full athlete history", from: null, to: null, blockIds: x.blocks.map((b) => b.id) },
    today: TODAY,
    loadedAt: `${TODAY}T12:00:00Z`,
    unreadable: [],
    ...x.over,
  };
}

// ── The home-gym athlete ─────────────────────────────────────────────────────

export const HOME_EXERCISES: RawExercise[] = [
  ex("e-csq", "Competition Squat", { movement_family: "squat", is_competition_lift: true, competition_lift_type: "squat", primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], equipment: "Barbell, Rack" }),
  ex("e-bss", "Dumbbell Bulgarian Split Squat", { primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], equipment: "Dumbbell" }),
  ex("e-calf", "Dumbbell Standing Calf Raise", { primary_muscle_group: "Calves", muscle_groups: ["calves"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-hcurl", "Bench Hamstring Curl Attachment", { primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], equipment: "Bench", exercise_category: "isolation" }),
  ex("e-lext", "Bench Leg Extension Attachment", { primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Machine", exercise_category: "isolation" }),
  ex("e-idb", "Incline Bench Press - Dumbbell", { movement_family: "bench", primary_muscle_group: "Chest", muscle_groups: ["chest"], secondary_muscle_groups: ["triceps", "front_delts"], equipment: "Dumbbell" }),
  ex("e-sdp", "Seated Shoulder Press - Dumbbell", { primary_muscle_group: "Front Delts", muscle_groups: ["front_delts"], secondary_muscle_groups: ["triceps"], equipment: "Dumbbell" }),
  ex("e-hammer", "Dumbbell Hammer Curl", { primary_muscle_group: "Biceps", muscle_groups: ["biceps"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-pull", "Wide-Grip Lat Pulldown", { primary_muscle_group: "Lats", muscle_groups: ["lats"], secondary_muscle_groups: ["biceps"], equipment: "Cable" }),
  ex("e-row", "Cable Seated On Floor Row", { primary_muscle_group: "Upper Back", muscle_groups: ["upper_back"], secondary_muscle_groups: ["biceps"], equipment: "Cable" }),
  ex("e-push", "Cable Triceps Pushdown", { primary_muscle_group: "Triceps", muscle_groups: ["triceps"], equipment: "Cable", exercise_category: "isolation" }),
  ex("e-rdl", "Romanian Deadlift", { primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], secondary_muscle_groups: ["glutes"], equipment: "Barbell" }),
  ex("e-lbs", "Landmine Belt Squat", { movement_family: "squat", primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], equipment: "Barbell" }),
  ex("e-slcalf", "Dumbbell Standing Single Leg Calf Raise", { primary_muscle_group: "Calves", muscle_groups: ["calves"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-bbb", "Barbell Bench Press", { movement_family: "bench", primary_muscle_group: "Chest", muscle_groups: ["chest"], secondary_muscle_groups: ["triceps", "front_delts"], equipment: "Barbell" }),
  ex("e-bor", "Bent-Over Barbell Row", { primary_muscle_group: "Upper Back", muscle_groups: ["upper_back"], secondary_muscle_groups: ["lats"], equipment: "Barbell" }),
  ex("e-lat", "Lateral Raises Dumbbell", { primary_muscle_group: "Side Delts", muscle_groups: ["side_delts"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-rear", "Bent Over Rear Delt Fly Dumbbell", { primary_muscle_group: "Rear Delts", muscle_groups: ["rear_delts"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-supcurl", "Supinating Dumbbell Curl", { primary_muscle_group: "Biceps", muscle_groups: ["biceps"], equipment: "Dumbbell", exercise_category: "isolation" }),
  ex("e-legpress", "Leg Press", { primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Machine" }),
  ex("e-csw", "Cable Straight-Arm Pulldown", { primary_muscle_group: "Lats", muscle_groups: ["lats"], equipment: "Cable", exercise_category: "isolation" }),
];

const prog = (base: number, step: number) => (w: number) => base + step * (w - 1);
const rpe8 = () => 8;

export function homeGymDays(): BlockSpec["days"] {
  return [
    { title: "Lower A", exercises: [
      { id: "e-csq", sets: 3, reps: "5–8", rpe: "7–8", notes: "Station 1 — Power Rack / Barbell. Rest 2.5–3 min.", rest: 150, load: prog(100, 2.5), done: () => 6, rpeLog: (w, s) => (w === 1 && s === 3 ? 5 : 8) },
      { id: "e-bss", sets: 2, reps: "8–12 each leg", rpe: "8", notes: "Station 2 — Dumbbells + Adjustable Bench.", rest: 75, load: prog(16, 1), done: (w) => 9 + Math.min(w, 3), rpeLog: rpe8 },
      { id: "e-calf", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 2 — Dumbbells.", rest: 60, load: () => 22, done: () => 14, rpeLog: () => 9 },
      { id: "e-hcurl", sets: 3, reps: "10–15", rpe: "8–9", notes: "Station 3 — Bench leg attachment.", rest: 60, load: prog(20, 1), done: () => 12, rpeLog: () => 9 },
      { id: "e-lext", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 3 — Bench leg attachment (leg extension setup).", rest: 60, load: prog(25, 1), done: () => 12, rpeLog: () => 9 },
    ] },
    { title: "Upper A", exercises: [
      { id: "e-idb", sets: 3, reps: "6–10", rpe: "7–8", notes: "Station 1 — Dumbbells + Adjustable Bench (incline).", rest: 120, load: prog(24, 1), done: () => 8, rpeLog: (w, s) => (w === 2 && s === 3 ? 4 : 8) },
      { id: "e-sdp", sets: 2, reps: "8–12", rpe: "8", notes: "Station 1 — Dumbbells + Adjustable Bench (upright).", rest: 90, load: () => 18, done: () => 10, rpeLog: rpe8 },
      { id: "e-hammer", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 1 — Dumbbells.", rest: 60, load: () => 14, done: () => 12, rpeLog: () => 9 },
      { id: "e-pull", sets: 3, reps: "8–12", rpe: "8", notes: "Station 2 — High cable.", rest: 90, load: prog(45, 2.5), done: () => 10, rpeLog: rpe8 },
      { id: "e-row", sets: 3, reps: "8–12", rpe: "8", notes: "Station 2 — Low/floor cable. Sit on the floor.", rest: 90, load: prog(45, 2.5), done: () => 10, rpeLog: rpe8 },
      { id: "e-push", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 2 — High cable.", rest: 60, load: () => 25, done: () => 12, rpeLog: () => 9 },
    ] },
    { title: "Lower B", exercises: [
      { id: "e-rdl", sets: 3, reps: "6–10", rpe: "7–8", notes: "Station 1 — Barbell. Finish all RDL sets before converting the barbell into the landmine.", rest: 120, load: prog(90, 2.5), done: () => 8, rpeLog: rpe8 },
      { id: "e-lbs", sets: 3, reps: "8–12", rpe: "7–8", notes: "Station 2 — Landmine (same barbell).", rest: 90, load: prog(40, 2.5), done: () => 10, rpeLog: rpe8 },
      { id: "e-hcurl", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 3 — Bench leg attachment.", rest: 60, load: prog(20, 1), done: () => 12, rpeLog: () => 9 },
      { id: "e-lext", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 3 — Bench leg attachment.", rest: 60, load: prog(25, 1), done: () => 12, rpeLog: () => 9 },
      { id: "e-slcalf", sets: 2, reps: "12–20 each leg", rpe: "8–9", notes: "Bodyweight only.", rest: 45, done: () => 15, rpeLog: () => 9 },
    ] },
    { title: "Upper B", exercises: [
      { id: "e-bbb", sets: 4, reps: "5–8", rpe: "7–8", notes: "Station 1 — Power Rack / Barbell.", rest: 150, load: prog(80, 2.5), done: () => 6, rpeLog: rpe8 },
      { id: "e-bor", sets: 3, reps: "6–10", rpe: "7–8", notes: "Station 1 — Barbell.", rest: 90, load: prog(60, 2.5), done: () => 8, rpeLog: rpe8 },
      { id: "e-lat", sets: 2, reps: "12–20", rpe: "8–9", notes: "Station 2 — Dumbbells, standing.", rest: 60, load: () => 8, done: () => 15, rpeLog: () => 9 },
      { id: "e-rear", sets: 2, reps: "12–20", rpe: "8–9", notes: "Station 2 — Dumbbells.", rest: 60, load: () => 8, done: () => 15, rpeLog: () => 9 },
      { id: "e-supcurl", sets: 2, reps: "8–12", rpe: "8–9", notes: "Station 2 — Dumbbells, standing.", rest: 60, load: () => 12, done: () => 10, rpeLog: () => 9 },
      { id: "e-pull", sets: 2, reps: "8–12", rpe: "8", notes: "Station 3 — High cable.", rest: 90, load: prog(45, 2.5), done: () => 10, rpeLog: rpe8 },
      { id: "e-push", sets: 2, reps: "10–15", rpe: "8–9", notes: "Station 3 — High cable.", rest: 60, load: () => 25, done: () => 12, rpeLog: () => 9 },
    ] },
  ];
}

export function homeGym(over: Partial<IntelRecords> = {}): IntelRecords {
  const days = homeGymDays();
  const earlier = (id: string, name: string, start: string, base: number): BlockSpec => ({
    id,
    name,
    start,
    weeks: 4,
    offsets: [0, 1, 2, 4],
    focus: "Hypertrophy",
    days: days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, load: e.load ? (w: number) => (e.load!(w) as number) - base : undefined })) })),
    duration: () => 52,
  });
  const rec = buildRecords({
    exercises: HOME_EXERCISES,
    blocks: [
      earlier("b-found", "Block 1 — Foundation", "2026-08-10", 15),
      earlier("b-athome", "MARC — At-Home Upper / Lower — 4 Days/Week", "2026-09-07", 7.5),
      {
        id: "b-home",
        name: "Home Gym 4-Day Strength + Hypertrophy",
        start: "2026-10-05",
        weeks: 4,
        offsets: [0, 1, 2, 4],
        focus: "Hypertrophy",
        status: "Active",
        days,
        unfinished: (w, d) => w === 4 && d === 3,
        duration: (w, d) => [48, 55, 52, 58][d] + (w % 2),
        feedback: (w, d) => (d === 0 ? { session_rpe: 7 } : null),
      },
    ],
    over: {
      goals: { main_goal: "Lose body fat", main_goal_other: null, goal_target: null, training_days_per_week: 3, workout_length_minutes: 75, training_experience: "intermediate", training_styles: ["Coach can decide"], training_location: "Commercial gym", equipment: ["Barbell", "Squat rack", "Bench", "Dumbbells", "Adjustable dumbbells", "Machines", "Cable station", "Smith machine", "Leg press", "Not sure"], injuries_has: false, injuries_details: null, final_notes: null, available_weekdays: ["mon", "wed", "fri"], updated_at: "2026-05-20T00:00:00Z" },
      bodyweight: [0, 7, 14, 21, 28].map((d, i) => ({ date: iso("2026-10-05", d), kg: 84 - i * 0.4 })),
      ...over,
    },
  });
  rec.client = { ...rec.client, committed_training_days: ["Monday", "Tuesday", "Wednesday", "Friday"], committed_training_frequency: 4, schedule_updated_at: "2026-08-01T00:00:00Z" };
  return rec;
}

// ── The powerlifter ──────────────────────────────────────────────────────────

export const PL_EXERCISES: RawExercise[] = [
  ex("p-sq", "Competition Squat", { movement_family: "squat", is_competition_lift: true, competition_lift_type: "squat", primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], equipment: "Barbell, Rack" }),
  ex("p-bp", "Competition Bench Press", { movement_family: "bench", is_competition_lift: true, competition_lift_type: "bench", primary_muscle_group: "Chest", muscle_groups: ["chest"], secondary_muscle_groups: ["triceps"], equipment: "Barbell, Bench, Rack" }),
  ex("p-dl", "Competition Deadlift", { movement_family: "deadlift", is_competition_lift: true, competition_lift_type: "deadlift", primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings", "glutes"], secondary_muscle_groups: ["upper_back"], equipment: "Barbell" }),
  ex("p-psq", "Pause Squat", { movement_family: "squat", variation_type: "pause", primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Barbell, Rack" }),
  ex("p-cgb", "Close-Grip Bench Press", { movement_family: "bench", primary_muscle_group: "Triceps", muscle_groups: ["triceps"], secondary_muscle_groups: ["chest"], equipment: "Barbell, Bench, Rack" }),
  ex("p-ddl", "Deficit Deadlift", { movement_family: "deadlift", primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], equipment: "Barbell" }),
  ex("p-row", "Chest Supported Dumbbell Row", { primary_muscle_group: "Upper Back", muscle_groups: ["upper_back"], equipment: "Dumbbell" }),
  ex("p-lp", "Leg Press", { primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Machine" }),
];

export function powerlifter(): IntelRecords {
  // bench trained 2×/week in blocks 1 and 3 (progresses), 1×/week in block 2 (flat)
  const block = (id: string, name: string, start: string, phase: "acc" | "int" | "real", benchTwice: boolean, base: number): BlockSpec => {
    const heavy = phase === "real";
    const sqLoad = (w: number) => base + 2.5 * w + (heavy ? 15 : phase === "int" ? 7.5 : 0);
    const bpLoad = (w: number) => (benchTwice ? base * 0.62 + 2.5 * w : base * 0.62 + 2.5);
    const dlLoad = (w: number) => base * 1.15 + 2.5 * w + (heavy ? 15 : 0);
    const reps = heavy ? "1-2" : phase === "int" ? "3" : "5";
    const logEveryOther = (w: number, s: number) => ((w + s) % 2 === 0 ? 8 : null);
    const days: BlockSpec["days"] = [
      { title: "Squat / Bench", exercises: [
        { id: "p-sq", sets: 1, reps, rpe: "8", role: "Primary Squat", load: sqLoad, done: () => Number(reps[0]), rpeLog: logEveryOther },
        { id: "p-sq", sets: 3, reps: "5", rpe: "7", role: "Primary Squat Backoff", load: (w) => sqLoad(w) * 0.85, done: () => 5, rpeLog: logEveryOther },
        { id: "p-bp", sets: 4, reps: "5", rpe: "7", role: "Primary Bench", load: bpLoad, done: () => 5, rpeLog: logEveryOther },
        { id: "p-row", sets: 3, reps: "8-10", rpe: "8", load: () => 30, done: () => 10, rpeLog: () => 8 },
      ] },
      { title: "Deadlift", exercises: [
        { id: "p-dl", sets: 1, reps, rpe: "8", role: "Primary Deadlift", load: dlLoad, done: () => Number(reps[0]), rpeLog: logEveryOther },
        { id: "p-ddl", sets: 3, reps: "4", rpe: "7", role: "Secondary Deadlift", load: (w) => dlLoad(w) * 0.75, done: () => 4, rpeLog: logEveryOther },
        { id: "p-lp", sets: 3, reps: "10", rpe: "8", load: () => 160, done: () => 10, rpeLog: () => 8 },
      ] },
      { title: benchTwice ? "Bench" : "Upper accessories", exercises: benchTwice
        ? [{ id: "p-bp", sets: 4, reps: "6", rpe: "7", role: "Secondary Bench", load: (w) => bpLoad(w) * 0.9, done: () => 6, rpeLog: logEveryOther }, { id: "p-cgb", sets: 3, reps: "8", rpe: "7", load: (w) => bpLoad(w) * 0.8, done: () => 8, rpeLog: logEveryOther }]
        : [{ id: "p-cgb", sets: 3, reps: "8", rpe: "7", load: () => base * 0.5, done: () => 8, rpeLog: logEveryOther }, { id: "p-row", sets: 3, reps: "10", rpe: "8", load: () => 30, done: () => 10 }] },
      { title: "Squat volume", exercises: [
        { id: "p-psq", sets: 4, reps: "4", rpe: "7", role: "Secondary Squat", load: (w) => sqLoad(w) * 0.75, done: () => 4, rpeLog: logEveryOther },
        { id: "p-lp", sets: 3, reps: "12", rpe: "8", load: () => 150, done: () => 12 },
      ] },
    ];
    return { id, name, start, weeks: 4, offsets: [0, 1, 3, 5], prepId: "prep-1", days, duration: () => 85, feedback: (w, d) => (d === 1 && w === 2 ? { pain: true, pain_area: "Low back", pain_level: 3, pain_note: "tight after deficits" } : d === 1 && w === 3 ? { pain: true, pain_area: "Low back", pain_level: 2 } : { fatigue_feel: "normal" }) };
  };
  const rec = buildRecords({
    exercises: PL_EXERCISES,
    blocks: [block("pl-1", "Accumulation", "2026-08-10", "acc", true, 150), block("pl-2", "Intensification", "2026-09-07", "int", false, 160), block("pl-3", "Realization", "2026-10-05", "real", true, 165)],
    over: {
      goals: { main_goal: "Prepare for a competition", main_goal_other: null, goal_target: "Total 600 kg", training_days_per_week: 4, workout_length_minutes: 90, training_experience: "advanced", training_styles: ["Powerlifting"], training_location: "Powerlifting gym", equipment: ["Barbell", "Squat rack", "Bench", "Dumbbells", "Machines", "Cable station", "Leg press"], injuries_has: false, injuries_details: null, final_notes: null, available_weekdays: ["mon", "tue", "thu", "sat"] },
      preps: [{ id: "prep-1", title: "Nationals prep", goal_type: "meet", event_name: "Nationals", event_date: iso(TODAY, 70), federation: "CPU", weight_class: "93", division: "Open", status: "active", coach_notes: null }],
      meets: [{ meet_date: "2026-03-01", meet_name: "Provincials", bodyweight_kg: 91, squat_kg: 200, bench_kg: 130, deadlift_kg: 240, total_kg: 570, federation: "CPU", weight_class_kg: "93" }],
      bodyweight: [0, 10, 20, 30, 40, 50, 60, 70].map((d, i) => ({ date: iso("2026-08-10", d), kg: 91 + i * 0.2 })),
    },
  });
  rec.client = { ...rec.client, is_powerlifter: true, committed_training_days: ["Monday", "Tuesday", "Thursday", "Saturday"], committed_training_frequency: 4, preferred_weight_unit: "kg" };
  return rec;
}

// ── The bodybuilder ──────────────────────────────────────────────────────────

export const BB_EXERCISES: RawExercise[] = [
  ex("h-hip", "Barbell Hip Thrust", { primary_muscle_group: "Glutes", muscle_groups: ["glutes"], secondary_muscle_groups: ["hamstrings"], equipment: "Barbell" }),
  ex("h-hack", "Hack Squat", { primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], equipment: "Machine" }),
  ex("h-rdl", "Dumbbell Romanian Deadlift", { primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], secondary_muscle_groups: ["glutes"], equipment: "Dumbbell" }),
  ex("h-kick", "Cable Glute Kickback", { primary_muscle_group: "Glutes", muscle_groups: ["glutes"], equipment: "Cable", exercise_category: "isolation" }),
  ex("h-incl", "Incline Dumbbell Press", { primary_muscle_group: "Chest", muscle_groups: ["chest"], secondary_muscle_groups: ["triceps"], equipment: "Dumbbell" }),
  ex("h-pull", "Lat Pulldown", { primary_muscle_group: "Lats", muscle_groups: ["lats"], secondary_muscle_groups: ["biceps"], equipment: "Cable" }),
  ex("h-lat", "Cable Lateral Raise", { primary_muscle_group: "Side Delts", muscle_groups: ["side_delts"], equipment: "Cable", exercise_category: "isolation" }),
  ex("h-row", "Seated Cable Row", { primary_muscle_group: "Upper Back", muscle_groups: ["upper_back"], secondary_muscle_groups: ["biceps"], equipment: "Cable" }),
  ex("h-curl", "Leg Curl", { primary_muscle_group: "Hamstrings", muscle_groups: ["hamstrings"], equipment: "Machine", exercise_category: "isolation" }),
  ex("h-abd", "Hip Abduction Machine", { primary_muscle_group: "Glutes", muscle_groups: ["glutes"], equipment: "Machine", exercise_category: "isolation" }),
];

export function bodybuilder(): IntelRecords {
  const rec = buildRecords({
    exercises: BB_EXERCISES,
    blocks: [
      {
        id: "bb-1",
        name: "Glute Focus Hypertrophy",
        start: "2026-09-07",
        weeks: 6,
        offsets: [0, 1, 2, 3, 4],
        focus: "Hypertrophy",
        days: [
          { title: "Glutes A", exercises: [{ id: "h-hip", sets: 4, reps: "8-12", rpe: "8", load: prog(80, 5), done: () => 10, rpeLog: () => 8 }, { id: "h-kick", sets: 3, reps: "12-15", rpe: "9", load: () => 15, done: () => 13 }, { id: "h-abd", sets: 3, reps: "15-20", rpe: "9", load: () => 50, done: () => 18 }] },
          { title: "Upper A", exercises: [{ id: "h-incl", sets: 3, reps: "8-12", rpe: "8", load: () => 20, done: () => 9, rpeLog: () => 9 }, { id: "h-pull", sets: 3, reps: "10-12", rpe: "8", load: prog(40, 2.5), done: () => 11 }, { id: "h-lat", sets: 3, reps: "12-20", rpe: "9", load: () => 5, done: () => 15 }] },
          { title: "Legs", exercises: [{ id: "h-hack", sets: 3, reps: "8-12", rpe: "8", load: prog(60, 5), done: () => 10 }, { id: "h-rdl", sets: 3, reps: "8-12", rpe: "8", load: prog(24, 2), done: () => 10 }, { id: "h-curl", sets: 3, reps: "10-15", rpe: "9", load: () => 35, done: () => 12 }] },
          { title: "Upper B", exercises: [{ id: "h-row", sets: 3, reps: "10-12", rpe: "8", load: prog(45, 2.5), done: () => 11 }, { id: "h-incl", sets: 3, reps: "10-12", rpe: "8", load: () => 18, done: () => 10 }, { id: "h-lat", sets: 3, reps: "12-20", rpe: "9", load: () => 5, done: () => 15 }] },
          { title: "Glutes B", exercises: [{ id: "h-hip", sets: 3, reps: "12-15", rpe: "8", load: prog(70, 5), done: () => 13 }, { id: "h-abd", sets: 3, reps: "15-20", rpe: "9", load: () => 50, done: () => 18 }, { id: "h-kick", sets: 3, reps: "12-15", rpe: "9", load: () => 15, done: () => 13 }] },
        ],
        // misses most Fridays and two Thursdays
        skip: (w, d) => (d === 4 && w % 3 !== 0) || (d === 3 && (w === 2 || w === 5)),
        duration: (w, d) => (d === 1 ? 55 : 62),
      },
    ],
    over: {
      goals: { main_goal: "Build muscle", main_goal_other: "Bigger glutes", goal_target: "Grow glutes and shoulders", training_days_per_week: 5, workout_length_minutes: 60, training_experience: "intermediate", training_styles: ["Bodybuilding", "Glute-focused"], training_location: "Commercial gym", equipment: ["Barbell", "Squat rack", "Bench", "Dumbbells", "Machines", "Cable station", "Leg press", "Hack squat", "Leg curl", "Hip thrust or glute machine"], injuries_has: false, injuries_details: null, final_notes: null, available_weekdays: ["mon", "tue", "wed", "thu", "fri"] },
    },
  });
  rec.client = { ...rec.client, sex: "female", committed_training_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], committed_training_frequency: 5 };
  return rec;
}

// ── Sparse data ──────────────────────────────────────────────────────────────

export function sparse(): IntelRecords {
  return buildRecords({
    exercises: [ex("s-gs", "Goblet Squat", { primary_muscle_group: "Quads", muscle_groups: ["quads"], equipment: "Dumbbell" }), ex("s-pu", "Push-Up", { primary_muscle_group: "Chest", muscle_groups: ["chest"], equipment: "Bodyweight" })],
    blocks: [
      {
        id: "s-1",
        name: "Starter",
        start: "2026-10-19",
        weeks: 3,
        offsets: [0, 3],
        days: [{ title: "Full body A", exercises: [{ id: "s-gs", sets: 3, reps: "10", load: () => 16, done: () => 10 }, { id: "s-pu", sets: 3, reps: "AMRAP", done: () => 8 }] }, { title: "Full body B", exercises: [{ id: "s-gs", sets: 3, reps: "12", load: () => 16, done: () => 12 }] }],
        skip: (w) => w > 1,
      },
    ],
  });
}
