/**
 * A program someone builds (athlete_programs.plan): blocks, each a run of
 * weeks, each week its own training days, each day its exercises. Every week
 * is written out in full (never "week 1 repeated"), so any week can differ;
 * the builder keeps them in step on purpose instead: an edit applies to a
 * scope the person picks ("Week 3 only", "Weeks 3–4", "All of Block 1"), and
 * the same day and the same exercise are found in every week by a key they
 * share (`key`), never by their place, so a week whose order differs still
 * gets the right edit.
 *
 * Pure: the builder, the program page, the tests and (in spirit) the SQL
 * (athlete_program_clean_plan) all read it the same way.
 */

export type Effort = "rpe" | "rir";
export type LoadBasis = "1rm" | "top_set";
export type WeightUnit = "kg" | "lb";

export type PlanExercise = {
  key: string;
  exercise_id: string;
  sets: number;
  reps: string;
  rpe?: string | null;
  rir?: string | null;
  /** A fixed weight, in `unit`. Never with `pct`. */
  load?: number | null;
  unit?: WeightUnit | null;
  /** A percentage of a max (`pct_of` "1rm") or of today's top set above it ("top_set"). */
  pct?: number | null;
  pct_of?: LoadBasis | null;
  rest_seconds?: number | null;
  tempo?: string | null;
  notes?: string | null;
  /** read back from the library (never saved) */
  name?: string | null;
  muscle_group?: string | null;
  equipment?: string | null;
};
export type PlanDay = { key: string; title: string; focus?: string | null; exercises: PlanExercise[] };
export type PlanWeek = { key: string; days: PlanDay[] };
export type PlanBlock = { key: string; name: string; weeks: PlanWeek[] };
export type ProgramPlan = { v: 1; blocks: PlanBlock[] };

/** Where the builder is: a block, a week in it, a day in that week (indexes). */
export type Cursor = { b: number; w: number; d: number };
export type WeekRef = { b: number; w: number };
/** Which weeks an edit reaches. */
export type Scope = "week" | "following" | "block";

/** What the database takes (athlete_program_clean_plan). */
export const MAX_BLOCKS = 8;
export const MAX_WEEKS = 24;
export const MAX_DAYS = 7;
export const MAX_EXERCISES = 20;
export const MAX_SETS = 20;
export const DEFAULT_WEEKS = 12;

/* ------------------------------------------------------------------ */
/*  Keys                                                              */
/* ------------------------------------------------------------------ */

let seq = 0;
/** A short key that's unique in a program (time + counter + random). */
export function makeKey(): string {
  seq = (seq + 1) % 1679616;
  return (
    Date.now().toString(36).slice(-4) +
    seq.toString(36).padStart(4, "0") +
    Math.random().toString(36).slice(2, 6)
  );
}

const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
const keyOr = (k: unknown) => (typeof k === "string" && KEY_RE.test(k) ? k : makeKey());

/* ------------------------------------------------------------------ */
/*  Making and reading plans                                          */
/* ------------------------------------------------------------------ */

export function newPlanDay(index: number): PlanDay {
  return { key: makeKey(), title: `Day ${index + 1}`, focus: null, exercises: [] };
}

/** A library exercise as it lands in a day: 3 × 8-10, 2:00 rest, the person edits from there. */
export function newPlanExercise(ex: {
  id: string;
  name: string;
  muscle_group?: string | null;
  equipment?: string | null;
}): PlanExercise {
  return {
    key: makeKey(),
    exercise_id: ex.id,
    name: ex.name,
    muscle_group: ex.muscle_group ?? null,
    equipment: ex.equipment ?? null,
    sets: 3,
    reps: "8-10",
    rpe: null,
    rir: null,
    load: null,
    unit: null,
    pct: null,
    pct_of: null,
    rest_seconds: 120,
    tempo: null,
    notes: null,
  };
}

const cloneEx = (e: PlanExercise): PlanExercise => ({ ...e });
const cloneDay = (d: PlanDay): PlanDay => ({ ...d, exercises: d.exercises.map(cloneEx) });
/** A copy of a week with the same day and exercise keys (it stays linked to the original). */
const cloneWeek = (w: PlanWeek): PlanWeek => ({ key: makeKey(), days: w.days.map(cloneDay) });

/** A new program: one block of `weeks` weeks (12 by default), each with one empty day. */
export function newPlan(weeks = DEFAULT_WEEKS): ProgramPlan {
  const first: PlanWeek = { key: makeKey(), days: [newPlanDay(0)] };
  const n = clampInt(weeks, 1, MAX_WEEKS);
  return {
    v: 1,
    blocks: [{ key: makeKey(), name: "Block 1", weeks: [first, ...range(n - 1).map(() => cloneWeek(first))] }],
  };
}

type LegacyDay = {
  title: string;
  focus?: string | null;
  exercises: {
    exercise_id: string;
    sets: number;
    reps: string;
    rpe?: string | null;
    rest_seconds?: number | null;
    notes?: string | null;
    name?: string | null;
    muscle_group?: string | null;
    equipment?: string | null;
  }[];
};

/** A program saved before plans (one week repeated `weeks` times) as a plan: one block, every week linked. */
export function planFromDays(days: LegacyDay[], weeks: number, blockName = "Block 1"): ProgramPlan {
  const first: PlanWeek = {
    key: makeKey(),
    days: days.map((d, i) => ({
      key: makeKey(),
      title: d.title || `Day ${i + 1}`,
      focus: d.focus ?? null,
      exercises: d.exercises.map((e) => ({
        key: makeKey(),
        exercise_id: e.exercise_id,
        sets: Number(e.sets) || 1,
        reps: String(e.reps ?? ""),
        rpe: e.rpe ?? null,
        rir: null,
        load: null,
        unit: null,
        pct: null,
        pct_of: null,
        rest_seconds: e.rest_seconds ?? null,
        tempo: null,
        notes: e.notes ?? null,
        name: e.name ?? null,
        muscle_group: e.muscle_group ?? null,
        equipment: e.equipment ?? null,
      })),
    })),
  };
  if (!first.days.length) first.days = [newPlanDay(0)];
  const n = clampInt(weeks, 1, MAX_WEEKS);
  return {
    v: 1,
    blocks: [{ key: makeKey(), name: blockName, weeks: [first, ...range(n - 1).map(() => cloneWeek(first))] }],
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A plan read from anywhere (the database, the phone's kept draft) made safe
 * to edit: every block, week, day and exercise has a key and the fields the
 * builder reads. Library names are filled from `info` when given.
 */
export function normalizePlan(
  raw: unknown,
  info?: Record<string, { name?: string | null; muscle_group?: string | null; equipment?: string | null }>,
): ProgramPlan | null {
  const blocks = (raw as any)?.blocks;
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const out: PlanBlock[] = [];
  for (const [bi, b] of blocks.entries()) {
    if (!b || !Array.isArray(b.weeks) || !b.weeks.length) return null;
    const weeks: PlanWeek[] = [];
    for (const w of b.weeks) {
      if (!w || !Array.isArray(w.days)) return null;
      const days: PlanDay[] = [];
      for (const [di, d] of w.days.entries()) {
        if (!d || !Array.isArray(d.exercises)) return null;
        const exercises: PlanExercise[] = [];
        for (const e of d.exercises) {
          if (!e || typeof e.exercise_id !== "string") return null;
          const lib = info?.[e.exercise_id];
          exercises.push({
            key: keyOr(e.key),
            exercise_id: e.exercise_id,
            sets: Number(e.sets) || 1,
            reps: str(e.reps),
            rpe: e.rpe != null && e.rpe !== "" ? str(e.rpe) : null,
            rir: e.rir != null && e.rir !== "" ? str(e.rir) : null,
            load: numOrNull(e.load),
            unit: e.unit === "kg" || e.unit === "lb" ? e.unit : null,
            pct: numOrNull(e.pct),
            pct_of: e.pct_of === "top_set" ? "top_set" : e.pct != null ? "1rm" : null,
            rest_seconds: numOrNull(e.rest_seconds),
            tempo: e.tempo ? str(e.tempo) : null,
            notes: e.notes ? str(e.notes) : null,
            name: e.name ?? lib?.name ?? null,
            muscle_group: e.muscle_group ?? lib?.muscle_group ?? null,
            equipment: e.equipment ?? lib?.equipment ?? null,
          });
        }
        days.push({ key: keyOr(d.key), title: str(d.title) || `Day ${di + 1}`, focus: d.focus ? str(d.focus) : null, exercises });
      }
      weeks.push({ key: keyOr(w.key), days });
    }
    out.push({ key: keyOr(b.key), name: str(b.name) || `Block ${bi + 1}`, weeks });
  }
  return { v: 1, blocks: out };
}

/** Every week in order with its place: block, week in the block, program week (1-based). */
export function flatWeeks(plan: ProgramPlan): { b: number; w: number; g: number; week: PlanWeek; block: PlanBlock }[] {
  const out: { b: number; w: number; g: number; week: PlanWeek; block: PlanBlock }[] = [];
  let g = 0;
  plan.blocks.forEach((block, b) =>
    block.weeks.forEach((week, w) => out.push({ b, w, g: ++g, week, block })),
  );
  return out;
}

export const totalWeeks = (plan: ProgramPlan) => plan.blocks.reduce((n, b) => n + b.weeks.length, 0);

/** The program week (1-based) of a block's week. */
export function programWeek(plan: ProgramPlan, at: WeekRef): number {
  let g = 0;
  for (let b = 0; b < at.b; b++) g += plan.blocks[b]?.weeks.length ?? 0;
  return g + at.w + 1;
}

/** The block and week of a program week (1-based), kept inside the program. */
export function refOfWeek(plan: ProgramPlan, g: number): WeekRef {
  const all = flatWeeks(plan);
  const hit = all[Math.max(0, Math.min(all.length - 1, Math.round(g) - 1))];
  return { b: hit.b, w: hit.w };
}

export function weekAt(plan: ProgramPlan, at: WeekRef): PlanWeek | null {
  return plan.blocks[at.b]?.weeks[at.w] ?? null;
}

/** The cursor kept inside the plan as it is now (after a week or a day went). */
export function clampCursor(plan: ProgramPlan, c: Cursor): Cursor {
  const b = clampInt(c.b, 0, plan.blocks.length - 1);
  const w = clampInt(c.w, 0, plan.blocks[b].weeks.length - 1);
  const d = clampInt(c.d, 0, Math.max(0, plan.blocks[b].weeks[w].days.length - 1));
  return { b, w, d };
}

/** Days a week, at most (what training days a person needs). */
export const daysPerWeek = (plan: ProgramPlan) =>
  Math.max(0, ...flatWeeks(plan).map((x) => x.week.days.length));

export function planSummary(plan: ProgramPlan) {
  const first = plan.blocks[0]?.weeks[0];
  return {
    weeks: totalWeeks(plan),
    blocks: plan.blocks.length,
    daysPerWeek: daysPerWeek(plan),
    exercises: first ? first.days.reduce((n, d) => n + d.exercises.length, 0) : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  Scope: which weeks an edit reaches                                */
/* ------------------------------------------------------------------ */

export function scopeWeeks(plan: ProgramPlan, at: WeekRef, scope: Scope): WeekRef[] {
  const n = plan.blocks[at.b]?.weeks.length ?? 0;
  if (scope === "week") return [{ b: at.b, w: at.w }];
  const from = scope === "following" ? at.w : 0;
  return range(n - from).map((i) => ({ b: at.b, w: from + i }));
}

/** "Week 3 only" · "Weeks 3–4" · "All of Block 1 (weeks 1–4)" · "All 12 weeks". */
export function scopeLabel(plan: ProgramPlan, at: WeekRef, scope: Scope): string {
  const weeks = scopeWeeks(plan, at, scope).map((x) => programWeek(plan, x));
  const lo = weeks[0];
  const hi = weeks[weeks.length - 1];
  if (scope === "week" || weeks.length === 1) return `Week ${lo} only`;
  if (scope === "block") {
    if (plan.blocks.length === 1) return `All ${weeks.length} weeks`;
    return `All of ${plan.blocks[at.b].name} (weeks ${lo}–${hi})`;
  }
  return `Weeks ${lo}–${hi}`;
}

/** Weeks the same in every day, exercise and number (keys don't count). */
export function sameWeek(a: PlanWeek, b: PlanWeek): boolean {
  return weekSig(a) === weekSig(b);
}
const exSig = (e: PlanExercise) =>
  [e.exercise_id, e.sets, e.reps, e.rpe ?? "", e.rir ?? "", e.load ?? "", e.unit ?? "", e.pct ?? "", e.pct_of ?? "",
    e.rest_seconds ?? "", e.tempo ?? "", e.notes ?? ""].join("|");
const weekSig = (w: PlanWeek) =>
  w.days.map((d) => [d.title, d.focus ?? "", d.exercises.map(exSig).join(";")].join("#")).join("\n");

/**
 * Where an edit goes when the builder opens on a block: every week of it
 * while they're all the same (build once, it fills the block), else the week
 * on screen (they've started making weeks differ, so an edit stays put).
 */
export function defaultScope(plan: ProgramPlan, b: number): Scope {
  const weeks = plan.blocks[b]?.weeks ?? [];
  return weeks.every((w) => sameWeek(w, weeks[0])) ? "block" : "week";
}

/* ------------------------------------------------------------------ */
/*  Edits (each returns a new plan; the input is never changed)        */
/* ------------------------------------------------------------------ */

function mapWeeks(plan: ProgramPlan, targets: WeekRef[], fn: (w: PlanWeek, ref: WeekRef) => PlanWeek): ProgramPlan {
  const hit = new Set(targets.map((t) => `${t.b}:${t.w}`));
  return {
    ...plan,
    blocks: plan.blocks.map((block, b) =>
      block.weeks.some((_, w) => hit.has(`${b}:${w}`))
        ? { ...block, weeks: block.weeks.map((week, w) => (hit.has(`${b}:${w}`) ? fn(week, { b, w }) : week)) }
        : block,
    ),
  };
}

function mapDay(plan: ProgramPlan, targets: WeekRef[], dayKey: string, fn: (d: PlanDay) => PlanDay): ProgramPlan {
  return mapWeeks(plan, targets, (week) =>
    week.days.some((d) => d.key === dayKey)
      ? { ...week, days: week.days.map((d) => (d.key === dayKey ? fn(d) : d)) }
      : week,
  );
}

/** Change an exercise's numbers (or notes) in every week the scope reaches. */
export function setExercise(
  plan: ProgramPlan,
  targets: WeekRef[],
  dayKey: string,
  exKey: string,
  patch: Partial<PlanExercise>,
): ProgramPlan {
  const clean = { ...patch };
  delete clean.key;
  // a fixed weight and a percentage never sit together
  if (clean.load != null) Object.assign(clean, { pct: null, pct_of: null });
  if (clean.pct != null) Object.assign(clean, { load: null });
  // one effort scale at a time
  if (clean.rpe) clean.rir = null;
  if (clean.rir) clean.rpe = null;
  return mapDay(plan, targets, dayKey, (d) => ({
    ...d,
    exercises: d.exercises.map((e) => (e.key === exKey ? { ...e, ...clean } : e)),
  }));
}

/** Adds what fits in each week's day (at most MAX_EXERCISES), after `afterKey` or at the end. */
export function addExercises(
  plan: ProgramPlan,
  targets: WeekRef[],
  dayKey: string,
  items: PlanExercise[],
  afterKey?: string | null,
): { plan: ProgramPlan; added: number; skipped: number } {
  let added = Infinity;
  const next = mapDay(plan, targets, dayKey, (d) => {
    const room = Math.max(0, MAX_EXERCISES - d.exercises.length);
    const fit = items.slice(0, room).map(cloneEx);
    added = Math.min(added, fit.length);
    const at = afterKey ? d.exercises.findIndex((e) => e.key === afterKey) : -1;
    const exercises =
      at >= 0 ? [...d.exercises.slice(0, at + 1), ...fit, ...d.exercises.slice(at + 1)] : [...d.exercises, ...fit];
    return { ...d, exercises };
  });
  const n = added === Infinity ? 0 : added;
  return { plan: next, added: n, skipped: items.length - n };
}

export function removeExercise(plan: ProgramPlan, targets: WeekRef[], dayKey: string, exKey: string): ProgramPlan {
  return mapDay(plan, targets, dayKey, (d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== exKey) }));
}

export function moveExercise(plan: ProgramPlan, targets: WeekRef[], dayKey: string, exKey: string, dir: -1 | 1): ProgramPlan {
  return mapDay(plan, targets, dayKey, (d) => {
    const i = d.exercises.findIndex((e) => e.key === exKey);
    return i < 0 ? d : { ...d, exercises: moveItem(d.exercises, i, dir) };
  });
}

/** Another library exercise in the same spot, keeping its prescription. */
export function swapExercise(
  plan: ProgramPlan,
  targets: WeekRef[],
  dayKey: string,
  exKey: string,
  ex: { id: string; name: string; muscle_group?: string | null; equipment?: string | null },
): ProgramPlan {
  return setExercise(plan, targets, dayKey, exKey, {
    exercise_id: ex.id,
    name: ex.name,
    muscle_group: ex.muscle_group ?? null,
    equipment: ex.equipment ?? null,
  });
}

/**
 * Back-off sets under a top set: the same exercise again right after it, at
 * 90% of the top set they logged (the logger works the weight out), 2 sets,
 * the same reps and rest.
 */
export function addBackoff(plan: ProgramPlan, targets: WeekRef[], dayKey: string, exKey: string): ProgramPlan {
  const key = makeKey();
  return mapDay(plan, targets, dayKey, (d) => {
    const i = d.exercises.findIndex((e) => e.key === exKey);
    if (i < 0 || d.exercises.length >= MAX_EXERCISES) return d;
    const top = d.exercises[i];
    const backoff: PlanExercise = {
      ...top,
      key,
      sets: 2,
      rpe: null,
      rir: null,
      load: null,
      unit: null,
      pct: 90,
      pct_of: "top_set",
      notes: null,
    };
    return { ...d, exercises: [...d.exercises.slice(0, i + 1), backoff, ...d.exercises.slice(i + 1)] };
  });
}

export function setDay(plan: ProgramPlan, targets: WeekRef[], dayKey: string, patch: { title?: string; focus?: string | null }): ProgramPlan {
  return mapDay(plan, targets, dayKey, (d) => ({ ...d, ...patch }));
}

/** A new day at the end of each week the scope reaches (one key across them); skips a full week. */
export function addDay(plan: ProgramPlan, targets: WeekRef[], title?: string): { plan: ProgramPlan; key: string } {
  const key = makeKey();
  const next = mapWeeks(plan, targets, (week) =>
    week.days.length >= MAX_DAYS
      ? week
      : { ...week, days: [...week.days, { key, title: title || `Day ${week.days.length + 1}`, focus: null, exercises: [] }] },
  );
  return { plan: next, key };
}

export function removeDay(plan: ProgramPlan, targets: WeekRef[], dayKey: string): ProgramPlan {
  return mapWeeks(plan, targets, (week) =>
    week.days.length <= 1 ? week : { ...week, days: week.days.filter((d) => d.key !== dayKey) },
  );
}

export function moveDay(plan: ProgramPlan, targets: WeekRef[], dayKey: string, dir: -1 | 1): ProgramPlan {
  return mapWeeks(plan, targets, (week) => {
    const i = week.days.findIndex((d) => d.key === dayKey);
    return i < 0 ? week : { ...week, days: moveItem(week.days, i, dir) };
  });
}

/** A copy of the day right after it ("Upper (copy)"), its own day from then on. */
export function duplicateDay(plan: ProgramPlan, targets: WeekRef[], dayKey: string): { plan: ProgramPlan; key: string } {
  const key = makeKey();
  const exKeys = new Map<string, string>();
  const next = mapWeeks(plan, targets, (week) => {
    const i = week.days.findIndex((d) => d.key === dayKey);
    if (i < 0 || week.days.length >= MAX_DAYS) return week;
    const src = week.days[i];
    const copy: PlanDay = {
      ...cloneDay(src),
      key,
      title: `${src.title} (copy)`.slice(0, 40),
      exercises: src.exercises.map((e) => {
        if (!exKeys.has(e.key)) exKeys.set(e.key, makeKey());
        return { ...e, key: exKeys.get(e.key)! };
      }),
    };
    return { ...week, days: [...week.days.slice(0, i + 1), copy, ...week.days.slice(i + 1)] };
  });
  return { plan: next, key };
}

/** The day as it is in `from`, copied into each target week (replacing that day, or added when it isn't there). */
export function copyDayTo(plan: ProgramPlan, from: WeekRef, dayKey: string, to: WeekRef[]): ProgramPlan {
  const src = weekAt(plan, from)?.days.find((d) => d.key === dayKey);
  if (!src) return plan;
  const others = to.filter((t) => !(t.b === from.b && t.w === from.w));
  return mapWeeks(plan, others, (week) => {
    const i = week.days.findIndex((d) => d.key === dayKey);
    if (i >= 0) return { ...week, days: week.days.map((d, j) => (j === i ? cloneDay(src) : d)) };
    if (week.days.length >= MAX_DAYS) return week;
    return { ...week, days: [...week.days, cloneDay(src)] };
  });
}

/** Each target week made exactly like `from` (every day and number). */
export function copyWeekTo(plan: ProgramPlan, from: WeekRef, to: WeekRef[]): ProgramPlan {
  const src = weekAt(plan, from);
  if (!src) return plan;
  const others = to.filter((t) => !(t.b === from.b && t.w === from.w));
  return mapWeeks(plan, others, (week) => ({ ...week, days: src.days.map(cloneDay) }));
}

/** A copy of the week right after it, in the same block. */
export function duplicateWeek(plan: ProgramPlan, at: WeekRef): ProgramPlan {
  const src = weekAt(plan, at);
  if (!src || totalWeeks(plan) >= MAX_WEEKS) return plan;
  return {
    ...plan,
    blocks: plan.blocks.map((block, b) =>
      b === at.b ? { ...block, weeks: [...block.weeks.slice(0, at.w + 1), cloneWeek(src), ...block.weeks.slice(at.w + 1)] } : block,
    ),
  };
}

/** A week taken out (a block keeps at least one: delete the block for that). */
export function removeWeek(plan: ProgramPlan, at: WeekRef): ProgramPlan {
  const block = plan.blocks[at.b];
  if (!block || block.weeks.length <= 1) return plan;
  return {
    ...plan,
    blocks: plan.blocks.map((bl, b) => (b === at.b ? { ...bl, weeks: bl.weeks.filter((_, w) => w !== at.w) } : bl)),
  };
}

/**
 * A block made `n` weeks long: new weeks are copies of its last week (so a
 * block grows with the training it already has), and shrinking takes weeks
 * off its end.
 */
export function setBlockLength(plan: ProgramPlan, b: number, n: number): ProgramPlan {
  const block = plan.blocks[b];
  if (!block) return plan;
  const others = totalWeeks(plan) - block.weeks.length;
  const want = clampInt(n, 1, MAX_WEEKS - others);
  if (want === block.weeks.length) return plan;
  const weeks =
    want < block.weeks.length
      ? block.weeks.slice(0, want)
      : [...block.weeks, ...range(want - block.weeks.length).map(() => cloneWeek(block.weeks[block.weeks.length - 1]))];
  return { ...plan, blocks: plan.blocks.map((bl, i) => (i === b ? { ...bl, weeks } : bl)) };
}

/** A program's length in weeks: the last block grows or shrinks (never under one week a block). */
export function setProgramLength(plan: ProgramPlan, n: number): ProgramPlan {
  const last = plan.blocks.length - 1;
  const before = totalWeeks(plan) - plan.blocks[last].weeks.length;
  return setBlockLength(plan, last, Math.max(1, n - before));
}

/**
 * Another block after the last one, `weeks` long, starting from the last
 * week of the block before it (its days and exercises carry on, ready to
 * change), named "Block N".
 */
export function addBlock(plan: ProgramPlan, weeks = 4): ProgramPlan {
  const room = MAX_WEEKS - totalWeeks(plan);
  if (plan.blocks.length >= MAX_BLOCKS || room < 1) return plan;
  const prev = plan.blocks[plan.blocks.length - 1];
  const seed = prev.weeks[prev.weeks.length - 1];
  const n = Math.min(Math.max(1, weeks), room);
  return {
    ...plan,
    blocks: [
      ...plan.blocks,
      { key: makeKey(), name: `Block ${plan.blocks.length + 1}`, weeks: range(n).map(() => cloneWeek(seed)) },
    ],
  };
}

export function duplicateBlock(plan: ProgramPlan, b: number): ProgramPlan {
  const block = plan.blocks[b];
  if (!block || plan.blocks.length >= MAX_BLOCKS || totalWeeks(plan) + block.weeks.length > MAX_WEEKS) return plan;
  const copy: PlanBlock = { key: makeKey(), name: `${block.name} (copy)`.slice(0, 40), weeks: block.weeks.map(cloneWeek) };
  return { ...plan, blocks: [...plan.blocks.slice(0, b + 1), copy, ...plan.blocks.slice(b + 1)] };
}

export function removeBlock(plan: ProgramPlan, b: number): ProgramPlan {
  if (plan.blocks.length <= 1 || !plan.blocks[b]) return plan;
  return { ...plan, blocks: plan.blocks.filter((_, i) => i !== b) };
}

export function renameBlock(plan: ProgramPlan, b: number, name: string): ProgramPlan {
  return { ...plan, blocks: plan.blocks.map((bl, i) => (i === b ? { ...bl, name: name.slice(0, 40) } : bl)) };
}

/** One block cut into blocks of `size` weeks ("Block 1", "Block 2", …), every week kept as it is. */
export function splitIntoBlocks(plan: ProgramPlan, size = 4): ProgramPlan {
  if (plan.blocks.length !== 1) return plan;
  const weeks = plan.blocks[0].weeks;
  const n = Math.max(1, Math.round(size));
  if (weeks.length <= n) return plan;
  const blocks: PlanBlock[] = [];
  for (let i = 0; i < weeks.length && blocks.length < MAX_BLOCKS; i += n) {
    const last = blocks.length === MAX_BLOCKS - 1;
    blocks.push({ key: i === 0 ? plan.blocks[0].key : makeKey(), name: `Block ${blocks.length + 1}`, weeks: last ? weeks.slice(i) : weeks.slice(i, i + n) });
    if (last) break;
  }
  return { ...plan, blocks };
}

export function moveBlock(plan: ProgramPlan, b: number, dir: -1 | 1): ProgramPlan {
  return { ...plan, blocks: moveItem(plan.blocks, b, dir) };
}

/* ------------------------------------------------------------------ */
/*  Across weeks: what changes week to week                            */
/* ------------------------------------------------------------------ */

/** The same exercise in each of the weeks (null where that week doesn't have it). */
export function slotAcross(plan: ProgramPlan, weeks: WeekRef[], dayKey: string, exKey: string): (PlanExercise | null)[] {
  return weeks.map((ref) => weekAt(plan, ref)?.days.find((d) => d.key === dayKey)?.exercises.find((e) => e.key === exKey) ?? null);
}

/** Which of an exercise's numbers differ from the week before it in its block (what the builder dots). */
export function changedFromLastWeek(
  plan: ProgramPlan,
  at: WeekRef,
  dayKey: string,
  exKey: string,
): Set<ProgressField | "rest"> {
  const out = new Set<ProgressField | "rest">();
  if (at.w === 0) return out;
  const [prev, cur] = slotAcross(plan, [{ b: at.b, w: at.w - 1 }, at], dayKey, exKey);
  if (!prev || !cur) return out;
  if (prev.sets !== cur.sets) out.add("sets");
  if (prev.reps !== cur.reps) out.add("reps");
  if ((prev.rpe ?? "") !== (cur.rpe ?? "")) out.add("rpe");
  if ((prev.rir ?? "") !== (cur.rir ?? "")) out.add("rir");
  if ((prev.load ?? null) !== (cur.load ?? null)) out.add("load");
  if ((prev.pct ?? null) !== (cur.pct ?? null)) out.add("pct");
  if ((prev.rest_seconds ?? null) !== (cur.rest_seconds ?? null)) out.add("rest");
  return out;
}

export type ProgressField = "sets" | "reps" | "rpe" | "rir" | "load" | "pct";

export const PROGRESS_LIMITS: Record<ProgressField, { min: number; max: number; step: number }> = {
  sets: { min: 1, max: MAX_SETS, step: 1 },
  reps: { min: 1, max: 100, step: 1 },
  rpe: { min: 1, max: 10, step: 0.5 },
  rir: { min: 0, max: 10, step: 0.5 },
  load: { min: 0, max: 1500, step: 0.5 },
  pct: { min: 1, max: 150, step: 0.5 },
};

const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const fmtNum = (n: number) => String(Number(n.toFixed(2)));

/**
 * A straight line across weeks: `start`, then `step` more each week, kept in
 * range and to sensible steps (whole sets and reps, half points of RPE).
 * "RPE 7, +0.5 a week" over 4 weeks is 7, 7.5, 8, 8.5.
 */
export function progressionValues(field: ProgressField, start: number, step: number, count: number): number[] {
  const lim = PROGRESS_LIMITS[field];
  return range(count).map((i) => Math.min(lim.max, Math.max(lim.min, roundTo(start + step * i, lim.step))));
}

/** The progression written into each week's exercise, as the field it is. */
export function applyProgression(
  plan: ProgramPlan,
  weeks: WeekRef[],
  dayKey: string,
  exKey: string,
  field: ProgressField,
  values: (number | null)[],
): ProgramPlan {
  let next = plan;
  weeks.forEach((ref, i) => {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) return;
    const patch: Partial<PlanExercise> =
      field === "sets"
        ? { sets: Math.round(v) }
        : field === "reps"
          ? { reps: String(Math.round(v)) }
          : field === "rpe"
            ? { rpe: fmtNum(v) }
            : field === "rir"
              ? { rir: fmtNum(v) }
              : field === "load"
                ? { load: v }
                : { pct: v, pct_of: undefined };
    if (field === "pct") delete patch.pct_of;
    next = setExercise(next, [ref], dayKey, exKey, patch);
  });
  return next;
}

/** A number to start a progression from: the field as it is now, read as a number (the top of a range). */
export function fieldNumber(e: PlanExercise | null, field: ProgressField): number | null {
  if (!e) return null;
  const raw = field === "sets" ? e.sets : field === "reps" ? e.reps : field === "rpe" ? e.rpe : field === "rir" ? e.rir : field === "load" ? e.load : e.pct;
  if (raw == null || raw === "") return null;
  const m = /(\d+(?:\.\d+)?)\s*$/.exec(String(raw));
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/*  Reading and checking                                               */
/* ------------------------------------------------------------------ */

const RPE_RE = /^(10|[1-9](\.5)?)(-(10|[1-9](\.5)?))?$/;
const RIR_RE = /^(10|[0-9](\.5)?)(-(10|[0-9](\.5)?))?$/;

export type PlanIssue = { message: string; at: "title" | "plan" | Cursor };

/**
 * The first thing to fix before saving (the database checks the same), and
 * where it is, so the builder can take the person straight there.
 */
export function planIssue(title: string, plan: ProgramPlan): PlanIssue | null {
  if (title.trim().length < 2) return { message: "Give your program a name.", at: "title" };
  if (!plan.blocks.length) return { message: "Add a block.", at: "plan" };
  if (plan.blocks.length > MAX_BLOCKS) return { message: `A program has at most ${MAX_BLOCKS} blocks.`, at: "plan" };
  if (totalWeeks(plan) > MAX_WEEKS) return { message: `A program has at most ${MAX_WEEKS} weeks.`, at: "plan" };
  for (const { b, w, g, week } of flatWeeks(plan)) {
    if (!week.days.length) return { message: `Add a training day to week ${g}.`, at: { b, w, d: 0 } };
    if (week.days.length > MAX_DAYS) return { message: `Week ${g} has more than ${MAX_DAYS} days.`, at: { b, w, d: 0 } };
    for (const [d, day] of week.days.entries()) {
      const name = `${day.title.trim() || `Day ${d + 1}`}${totalWeeks(plan) > 1 ? ` (week ${g})` : ""}`;
      const at = (message: string): PlanIssue => ({ message, at: { b, w, d } });
      if (!day.exercises.length) return at(`Add an exercise to ${name}.`);
      if (day.exercises.length > MAX_EXERCISES) return at(`${name} has more than ${MAX_EXERCISES} exercises.`);
      for (const e of day.exercises) {
        const sets = Number(e.sets);
        if (!Number.isInteger(sets) || sets < 1 || sets > MAX_SETS) return at(`Sets must be 1 to ${MAX_SETS} (${name}).`);
        if (!String(e.reps ?? "").trim()) return at(`Every exercise needs reps (${name}).`);
        if (e.rpe && !RPE_RE.test(String(e.rpe).trim())) return at(`RPE is 1 to 10, like 8 or 7-8 (${name}).`);
        if (e.rir && !RIR_RE.test(String(e.rir).trim())) return at(`RIR is 0 to 10, like 2 or 1-2 (${name}).`);
        if (e.load != null && !(e.load > 0 && e.load <= 1500)) return at(`Check the weight (${name}).`);
        if (e.pct != null && !(e.pct > 0 && e.pct <= 150)) return at(`A percentage is 1 to 150 (${name}).`);
      }
    }
  }
  return null;
}

/** The plain form the save RPC takes (names and library details left out, numbers as numbers). */
export function planPayload(plan: ProgramPlan) {
  return {
    v: 1,
    blocks: plan.blocks.map((b, bi) => ({
      key: b.key,
      name: b.name.trim() || `Block ${bi + 1}`,
      weeks: b.weeks.map((w) => ({
        key: w.key,
        days: w.days.map((d, di) => ({
          key: d.key,
          title: d.title.trim() || `Day ${di + 1}`,
          focus: d.focus?.trim() || null,
          exercises: d.exercises.map((e) => ({
            key: e.key,
            exercise_id: e.exercise_id,
            sets: Number(e.sets),
            reps: String(e.reps ?? "").trim(),
            rpe: e.rpe ? String(e.rpe).trim() : null,
            rir: e.rir ? String(e.rir).trim() : null,
            load: e.load ?? null,
            unit: e.load != null ? (e.unit ?? "lb") : null,
            pct: e.pct ?? null,
            pct_of: e.pct != null ? (e.pct_of ?? "1rm") : null,
            rest_seconds: e.rest_seconds ?? null,
            tempo: e.tempo?.trim() || null,
            notes: e.notes?.trim() || null,
          })),
        })),
      })),
    })),
  };
}

/** Whether two plans would save the same program (keys and library names don't count). */
export function samePlan(a: ProgramPlan, b: ProgramPlan): boolean {
  const sig = (p: ProgramPlan) =>
    p.blocks.map((bl) => [bl.name, bl.weeks.map(weekSig).join("\n~\n")].join("@")).join("\n#\n");
  return sig(a) === sig(b);
}

/* ------------------------------------------------------------------ */
/*  Words                                                              */
/* ------------------------------------------------------------------ */

const restText = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
};

/** How an exercise's load reads: "100 lb", "75% of max", "90% of top set", or null for none. */
export function loadText(e: Pick<PlanExercise, "load" | "unit" | "pct" | "pct_of">): string | null {
  if (e.pct != null) return `${fmtNum(e.pct)}% of ${e.pct_of === "top_set" ? "top set" : "max"}`;
  if (e.load != null) return `${fmtNum(e.load)} ${e.unit ?? "lb"}`;
  return null;
}

/** "3 × 8-10 · RPE 8 · 100 lb · 2:00 rest": the program page and the builder read the same. */
export function prescriptionText(e: PlanExercise): string {
  const parts = [`${e.sets} × ${e.reps}`];
  if (e.rpe) parts.push(`RPE ${e.rpe}`);
  else if (e.rir) parts.push(`RIR ${e.rir}`);
  const load = loadText(e);
  if (load) parts.push(load);
  if (e.rest_seconds) parts.push(`${restText(e.rest_seconds)} rest`);
  return parts.join(" · ");
}

export const restLabel = (s: number | null | undefined) => (s ? restText(s) : "—");

/** "12 weeks · 3 blocks · 4 days a week" */
/** "12 weeks · 3 blocks · 4 days a week"; the builder's header leaves the
 * days out (its day tabs already show them) so it fits beside Save. */
export function planMeta(plan: ProgramPlan, opts: { days?: boolean } = {}): string {
  const s = planSummary(plan);
  return [
    `${s.weeks} ${s.weeks === 1 ? "week" : "weeks"}`,
    s.blocks > 1 ? `${s.blocks} blocks` : null,
    opts.days === false ? null : `${s.daysPerWeek} ${s.daysPerWeek === 1 ? "day" : "days"} a week`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function range(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i);
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
}
export function moveItem<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
